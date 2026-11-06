import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync, createWriteStream } from 'node:fs';
import { unlink, readFile } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { z } from 'zod';
import { openDb, decodeJob } from './db.js';
import { seed } from './seed.js';
import { createAuth, sessionUser, googleConfigured, appOrigin } from './auth.js';
import { hash, now, fail, scorecardSchema, stages, scoringLines, profileFromLines, identity } from './domain.js';
import { extractScorecard, aiEnabled, aiSelection, providers, generate } from './ai.js';
import { createCredentials } from './credentials.js';
import { createWorker } from './worker.js';
import { localFiles } from './files.js';
export async function createApp({
  directory = path.resolve(process.env.DATA_DIR || 'data'),
  demo = process.env.DEMO_MODE !== 'false',
  production = false,
  verifyGoogleToken,database,fileStore=localFiles,serverless=false,cloudUploads
} = {}) {
  const db = database||openDb(directory),
    files = path.join(directory, 'uploads');
  if (!demo && (await db.prepare("SELECT 1 FROM users WHERE id IN ('recruiter','client','client2') AND email LIKE '%.test' LIMIT 1").get())) {
    await db.close();
    throw new Error('Demo accounts found. Use a fresh DATA_DIR for non-demo operation, or explicitly set DEMO_MODE=true for a local demonstration.');
  }
  if(!serverless)mkdirSync(files, {
    recursive: true
  });
  if (demo) {if(serverless)throw new Error('Cloud mode requires DEMO_MODE=false');seed(db);}
  const app = express();
  if(serverless)app.set('trust proxy',1);
  if(db.context)app.use((req,res,next)=>{req.dbFinished=db.context(()=>new Promise(resolve=>{res.once('finish',resolve);res.once('close',resolve);next();}));req.dbFinished.catch(next);});
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: production ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'",...(serverless?['https://*.blob.vercel-storage.com','https://blob.vercel-storage.com']:[])],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"]
      }
    } : false,
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: production
  }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(['/api/jobs/:id/upload-session','/api/batch-items/:id/transcript'],express.json({limit:'1mb'}));
  app.use('/api', express.json({
    limit: '200kb'
  }));
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('sec-fetch-site') === 'cross-site') return next(Object.assign(new Error('Cross-site request blocked'), {
        status: 403
      }));
      if (req.get('origin')) {
        try {
          if (new URL(req.get('origin')).host !== req.get('host')) fail(403, 'Cross-site request blocked');
        } catch {
          return next(Object.assign(new Error('Cross-site request blocked'), {
            status: 403
          }));
        }
      }
    }
    next();
  });
  const audit = async (actor, action, subject = null, detail = null) => await db.prepare('INSERT INTO audit(actor,action,subject,detail,created_at,workspace_id) VALUES(?,?,?,?,?,?)').run(actor, action, subject, detail, now(), (await db.prepare('SELECT workspace_id FROM users WHERE id=?').get(actor))?.workspace_id || 'demo');
  const credentials = await createCredentials(db, directory);
  const getSelection = async (workspaceId = 'demo') => {
    const selected = aiSelection(JSON.parse((await db.prepare("SELECT value FROM settings WHERE key=?").get(`${workspaceId}:ai`))?.value || 'null'));
    return {
      ...selected,
      apiKey: await credentials.get(workspaceId, selected.provider)
    };
  };
  const publicAi = async workspaceId => {
    const {
      provider,
      model
    } = await getSelection(workspaceId);
    return {
      provider,
      model,
      name: providers[provider].name,
      pdf: providers[provider].pdf
    };
  };
  const worker = await createWorker(db, audit, getSelection,{serverless,files:fileStore});
  const requestWork=async workspace=>{if(serverless)await db.prepare('INSERT INTO workflow_outbox(workspace_id,requested_at) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET requested_at=excluded.requested_at,dispatched_at=NULL').run(workspace,now());};
  const activeUploads = new Map();
  const wrap = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res,next)).catch(next);
  const validate = (schema, value) => {
    const result = schema.safeParse(value);
    if (!result.success) fail(400, result.error.issues.map(e => e.message).join('; '));
    return result.data;
  };
  const getJob = async (id, user) => {
    const job = decodeJob(await db.prepare('SELECT * FROM jobs WHERE id=?').get(id));
    if (!job || job.workspace_id !== user.workspace_id || user.role === 'client' && job.client_id !== user.client_id) fail(404, 'Requisition not found');
    return job;
  };
  const getApplication = async (id, user) => {
    const row = await db.prepare('SELECT a.*,c.name,c.text,c.profile,c.consent,c.file_path,c.id AS candidate_id,j.title,j.criteria,j.version,j.client_id,j.workspace_id FROM applications a JOIN candidates c ON c.id=a.candidate_id JOIN jobs j ON j.id=a.job_id WHERE a.id=?').get(id);
    if (!row || row.workspace_id !== user.workspace_id || user.role === 'client' && (row.client_id !== user.client_id || !row.submitted_at)) fail(404, 'Candidate not found');
    return row;
  };
  const applicationDto = async (row, user) => ({
    id: row.id,
    jobId: row.job_id,
    candidateId: row.candidate_id,
    name: user.role === 'recruiter' ? row.name : row.candidate_id,
    profile: JSON.parse(row.profile),
    stage: row.stage,
    score: row.score_version === row.version && row.score ? JSON.parse(row.score) : null,
    scoreError: row.score_error,
    scorePending: row.score_version !== row.version,
    reason: row.reason,
    interviewAt: row.interview_at,
    submittedAt: row.submitted_at,
    submissionStale: Boolean(row.submitted_at && row.submitted_version !== row.version),
    opened: row.viewed_version!==undefined?row.viewed_version===row.version:Boolean(await db.prepare('SELECT 1 FROM views WHERE user_id=? AND application_id=? AND version=?').get(user.id, row.id, row.version)),
    createdAt: row.created_at
  });
  app.get('/api/health',wrap(async(_req,res)=>{await db.prepare('SELECT 1').get();res.json({ok:true});}));
  const auth = createAuth(db, audit, {
    demo,
    verifyGoogleToken
  });
  app.get('/api/config', wrap(async (req, res) => {
    const workspaceId = (await sessionUser(db, req))?.workspace_id || 'demo';
    res.json({
      demo,
      uploads:serverless?'blob':'multipart',
      googleEnabled: googleConfigured(),
      aiEnabled: aiEnabled(await getSelection(workspaceId)),
      ai: await publicAi(workspaceId),
      stages
    });
  }));
  app.use('/api/auth', auth.router);
  if(cloudUploads)cloudUploads.registerTokenRoute(app,{db,auth,audit});
  app.use('/api', auth.requireUser);
  if(db.lock)app.use('/api',wrap(async(req,_res,next)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method)||req.path.endsWith('/cv'))await db.lock(req.user.workspace_id);next();}));
  app.get('/api/clients', wrap(async (req, res) => res.json(await db.prepare('SELECT id,name FROM clients WHERE workspace_id=? AND (? IS NULL OR id=?) ORDER BY name').all(req.user.workspace_id, req.user.role === 'client' ? req.user.client_id : null, req.user.client_id))));
  app.get('/api/jobs', wrap(async (req, res) => {
    const offset=validate(z.coerce.number().int().min(0).max(10000000),req.query.offset||0);
    const rows = req.user.role === 'client' ? await db.prepare('SELECT * FROM jobs WHERE client_id=? AND workspace_id=? ORDER BY created_at,id LIMIT 25 OFFSET ?').all(req.user.client_id, req.user.workspace_id,offset) : await db.prepare('SELECT * FROM jobs WHERE workspace_id=? ORDER BY created_at,id LIMIT 25 OFFSET ?').all(req.user.workspace_id,offset);
    res.json(await Promise.all(rows.map(async row => {
      const job = decodeJob(row);
      const counts=await db.prepare("SELECT COUNT(*) AS count,SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted,SUM(CASE WHEN stage='Joined' THEN 1 ELSE 0 END) AS joined FROM applications WHERE job_id=? AND (?='recruiter' OR submitted_at IS NOT NULL)").get(job.id,req.user.role);
      return {
        ...job,
        count: counts.count,
        submitted: Number(counts.submitted||0),
        joined: Number(counts.joined||0)
      };
    })));
  }));
  app.get('/api/jobs/:id/candidates', wrap(async (req, res) => {
    await getJob(req.params.id, req.user);
    const offset=validate(z.coerce.number().int().min(0).max(10000000),req.query.offset||0);
    const rows = await db.prepare("SELECT a.*,c.name,c.profile,j.version,v.version AS viewed_version FROM applications a JOIN candidates c ON c.id=a.candidate_id JOIN jobs j ON j.id=a.job_id LEFT JOIN views v ON v.application_id=a.id AND v.user_id=? WHERE a.job_id=? AND (?='recruiter' OR a.submitted_at IS NOT NULL) ORDER BY a.created_at,a.id LIMIT 100 OFFSET ?").all(req.user.id,req.params.id,req.user.role,offset);
    if (req.user.role === 'client') await audit(req.user.id, 'shortlist.viewed', req.params.id);
    res.json((await Promise.all(rows.map(async row => {const dto=await applicationDto(row,req.user);if(serverless&&dto.score)dto.score={...dto.score,criteria:dto.score.criteria.map(({id,status})=>({id,status}))};return dto;}))).sort((a, b) => (b.score?.total ?? -1) - (a.score?.total ?? -1)));
  }));
  app.get('/api/applications/:id', wrap(async (req, res) => {
    const row = await getApplication(req.params.id, req.user);
    await audit(req.user.id, 'candidate.viewed', row.candidate_id, req.user.role === 'client' ? 'Masked profile' : 'Profile and evidence');
    res.json({
      ...(await applicationDto(row, req.user)),
      criteria: JSON.parse(row.criteria),
      lines: scoringLines(row.text, row.name)
    });
  }));
  app.post('/api/applications/:id/decision', wrap(async (req, res) => {
    const body = validate(z.object({
      action: z.enum(['shortlist', 'reject', 'interview']),
      reason: z.string().trim().max(1000).optional(),
      interviewAt: z.string().datetime({
        offset: true
      }).optional()
    }), req.body);
    const row = await getApplication(req.params.id, req.user);
    if (req.user.role !== 'client') fail(403, 'Client hiring manager access required');
    if (row.submitted_version !== row.version || row.score_version !== row.version || row.score_error) fail(409, 'The scorecard changed. Your recruiter must review and resubmit this candidate before another decision.');
    if (['Joined', 'Offered'].includes(row.stage)) fail(409, 'The recruiter has already advanced this candidate.');
    if (body.action === 'reject' && !body.reason) fail(400, 'Give a job-related reason for rejection');
    if (body.action === 'interview' && (!body.interviewAt || new Date(body.interviewAt) <= new Date())) fail(400, 'Choose a future interview time');
    const stage = {
      shortlist: 'Shortlisted',
      reject: 'Rejected',
      interview: 'Interview'
    }[body.action];
    await db.prepare('UPDATE applications SET stage=?,reason=?,interview_at=? WHERE id=?').run(stage, body.reason || null, body.action === 'interview' ? body.interviewAt : null, row.id);
    await audit(req.user.id, `client.${body.action}`, row.candidate_id, 'Human decision recorded');
    res.json({
      ok: true
    });
  }));
  const recruiter = (req, _res, next) => req.user.role === 'recruiter' ? next() : next(Object.assign(new Error('Recruiter access required'), {
    status: 403
  }));
  app.use('/api', recruiter);
  if(cloudUploads)cloudUploads.registerRoutes(app,{db,getJob,getSelection,requestWork,audit});
  const hasUpload=async workspace=>cloudUploads?cloudUploads.hasActive(db,workspace):false;
  app.post('/api/clients', wrap(async (req, res) => {
    const {
        name
      } = validate(z.object({
        name: z.string().trim().min(2).max(100)
      }), req.body),
      id = randomUUID();
    await db.prepare('INSERT INTO clients VALUES(?,?,?)').run(id, req.user.workspace_id, name);
    await audit(req.user.id, 'client.created', id);
    res.status(201).json({
      id,
      name
    });
  }));
  app.post('/api/invitations', wrap(async (req, res) => {
    const b = validate(z.object({
      email: z.string().trim().toLowerCase().email().max(150),
      clientId: z.string().min(1).max(100)
    }), req.body);
    if (!(await db.prepare('SELECT 1 FROM clients WHERE id=? AND workspace_id=?').get(b.clientId, req.user.workspace_id))) fail(404, 'Client not found');
    const token = randomBytes(32).toString('hex');
    await db.prepare('INSERT INTO invitations VALUES(?,?,?,?,?,NULL)').run(hash(token), req.user.workspace_id, b.clientId, b.email, new Date(Date.now() + 7 * 86400000).toISOString());
    await audit(req.user.id, 'client.invited', b.clientId);
    res.status(201).json({
      url: `${appOrigin()}/signup?invite=${token}`,
      expiresInDays: 7
    });
  }));
  const aiSettings = async workspaceId => ({
    selection: aiSelection(await getSelection(workspaceId)),
    providers: await Promise.all(Object.entries(providers).map(async ([id, p]) => ({
      id,
      ...p,
      configured: (await credentials.has(workspaceId, id)) || Boolean(process.env[p.keyEnv]?.trim()),
      ownKey: await credentials.has(workspaceId, id)
    }))),
    enabled: aiEnabled(await getSelection(workspaceId))
  });
  app.get('/api/settings/ai', wrap(async (req, res) => res.json(await aiSettings(req.user.workspace_id))));
  app.put('/api/settings/ai', wrap(async (req, res) => {
    const body = validate(z.object({
      provider: z.enum(['openai', 'gemini', 'groq']),
      model: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/).optional(),
      apiKey: z.string().trim().min(10).max(512).regex(/^[\x21-\x7e]+$/).optional()
    }).strict(), req.body);
    const assertIdle = async () => {
      if (await hasUpload(req.user.workspace_id)||activeUploads.get(req.user.workspace_id) || (await db.prepare("SELECT 1 FROM batch_items i JOIN batches b ON b.id=i.batch_id WHERE b.workspace_id=? AND i.status IN ('pending','processing') LIMIT 1").get(req.user.workspace_id)) || (await db.prepare('SELECT 1 FROM applications a JOIN jobs j ON j.id=a.job_id WHERE j.workspace_id=? AND a.score_version!=j.version AND a.score_error IS NULL LIMIT 1').get(req.user.workspace_id))) fail(409, 'Wait for current parsing and scoring to finish before changing providers.');
    };
    await assertIdle();
    const selection = aiSelection(body);
    if (body.apiKey) {
      await generate('Return {"ok":true}. This checks API key and model access; no candidate data is included.', {}, undefined, {
        ...selection,
        apiKey: body.apiKey
      });
      await assertIdle();
    }
    await db.exec('BEGIN');
    try {
      if (body.apiKey) await credentials.set(req.user.workspace_id, selection.provider, body.apiKey);
      await db.prepare("INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(`${req.user.workspace_id}:ai`, JSON.stringify(selection));
      await audit(req.user.id, 'ai.settings.updated', null, `${selection.provider} / ${selection.model}; applies to new work and explicit retries`);
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
    res.json(await aiSettings(req.user.workspace_id));
  }));
  app.post('/api/scorecard/extract', wrap(async (req, res) => {
    const {
      jd
    } = validate(z.object({
      jd: z.string().trim().min(20).max(20000)
    }), req.body);
    res.json(await extractScorecard(jd, await getSelection(req.user.workspace_id)));
  }));
  const jobInput = z.object({
    title: z.string().trim().min(3).max(120),
    clientId: z.string().min(1).max(100),
    location: z.string().trim().min(1).max(100),
    jd: z.string().min(20).max(20000),
    criteria: scorecardSchema
  });
  app.post('/api/jobs', wrap(async (req, res) => {
    const b = validate(jobInput, req.body),
      client = await db.prepare('SELECT * FROM clients WHERE id=? AND workspace_id=?').get(b.clientId, req.user.workspace_id);
    if (!client) fail(400, 'Choose a client in your workspace');
    const id = `REQ-${randomUUID().slice(0, 8).toUpperCase()}`;
    await db.prepare('INSERT INTO jobs(id,title,client_id,client_name,location,jd,criteria,version,mode,created_at,workspace_id) VALUES(?,?,?,?,?,?,?,1,?,?,?)').run(id, b.title, b.clientId, client.name, b.location, b.jd, JSON.stringify(b.criteria), aiEnabled(await getSelection(req.user.workspace_id)) ? 'ai' : 'demo', now(), req.user.workspace_id);
    await audit(req.user.id, 'requisition.created', id);
    res.status(201).json({
      id
    });
  }));
  app.put('/api/jobs/:id/scorecard', wrap(async (req, res) => {
    const job = await getJob(req.params.id, req.user);
    const b = validate(jobInput.extend({
      version: z.number().int().positive()
    }), req.body);
    if (job.version !== b.version) fail(409, 'Scorecard changed. Reload before editing.');
    await db.prepare('UPDATE jobs SET title=?,client_id=?,client_name=?,location=?,jd=?,criteria=?,version=version+1,mode=? WHERE id=?').run(b.title, job.client_id, job.client_name, b.location, b.jd, JSON.stringify(b.criteria), aiEnabled(await getSelection(req.user.workspace_id)) ? 'ai' : 'demo', job.id);
    await db.prepare('UPDATE applications SET score_error=NULL WHERE job_id=?').run(job.id);
    await audit(req.user.id, 'scorecard.updated', job.id, 'New version; all evidence scores and CV views must be refreshed');
    await requestWork(req.user.workspace_id);
    res.json({
      ok: true
    });
  }));
  app.get('/api/applications/:id/cv', wrap(async (req, res) => {
    const row = await getApplication(req.params.id, req.user);
    const content = row.file_path&&!fileStore.download ? await fileStore.read(row.file_path) : null;
    await db.prepare('INSERT INTO views VALUES(?,?,?,?) ON CONFLICT(user_id,application_id) DO UPDATE SET version=excluded.version,viewed_at=excluded.viewed_at').run(req.user.id, row.id, row.version, now());
    if (row.stage === 'Sourced') await db.prepare("UPDATE applications SET stage='Reviewed' WHERE id=?").run(row.id);
    await audit(req.user.id, 'cv.opened', row.candidate_id, 'Original CV opened before submission');
    if(row.file_path&&fileStore.download){const downloadUrl=await fileStore.download(row.file_path);return req.get('accept')?.includes('application/json')?res.json({downloadUrl}):res.redirect(downloadUrl);}
    if (content) {
      res.type(row.file_path.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.set('Content-Disposition', `inline; filename="${row.candidate_id}${path.extname(row.file_path)}"`);
      res.send(content);
    } else res.type('text/plain').send(row.text);
  }));
  app.post('/api/applications/:id/submit', wrap(async (req, res) => {
    const row = await getApplication(req.params.id, req.user);
    if (await db.prepare("SELECT 1 FROM batch_items WHERE candidate_id=? AND status='needs_review' LIMIT 1").get(row.candidate_id)) fail(409, 'Verify the CV transcript before submitting this candidate');
    if (!(await db.prepare('SELECT 1 FROM views WHERE user_id=? AND application_id=? AND version=?').get(req.user.id, row.id, row.version))) fail(409, 'Open the original CV for this scorecard version before submitting');
    if (row.score_version !== row.version || !row.score || row.score_error) fail(409, 'Resolve scoring before submitting');
    if (row.submitted_at && row.submitted_version === row.version) return res.json({
      ok: true
    });
    if (['Offered', 'Joined'].includes(row.stage)) fail(409, 'This candidate has already advanced. Keep the recorded hiring outcome.');
    await db.prepare("UPDATE applications SET stage='Submitted',submitted_at=?,submitted_version=?,reason=NULL,interview_at=NULL WHERE id=?").run(now(), row.version, row.id);
    await audit(req.user.id, 'candidate.submitted', row.candidate_id, row.job_id);
    res.json({
      ok: true
    });
  }));
  app.patch('/api/applications/:id/stage', wrap(async (req, res) => {
    const {
        stage,
        reason
      } = validate(z.object({
        stage: z.enum(stages),
        reason: z.string().trim().max(1000).optional()
      }), req.body),
      row = await getApplication(req.params.id, req.user);
    if (stage === 'Submitted') fail(400, 'Use submit after CV review');
    if (stage === 'Reviewed' && !(await db.prepare('SELECT 1 FROM views WHERE user_id=? AND application_id=? AND version=?').get(req.user.id, row.id, row.version))) fail(409, 'Open the CV before marking reviewed');
    if (['Shortlisted', 'Interview', 'Offered', 'Joined'].includes(stage) && !row.submitted_at) fail(409, 'Submit to the client first');
    if (['Shortlisted', 'Interview', 'Offered', 'Joined'].includes(stage) && (row.submitted_version !== row.version || row.score_version !== row.version || row.score_error)) fail(409, 'Review and resubmit this candidate against the current scorecard before advancing the pipeline');
    if (stage === 'Rejected' && !reason) fail(400, 'A human rejection requires a reason');
    await db.prepare('UPDATE applications SET stage=?,reason=? WHERE id=?').run(stage, reason || null, row.id);
    await audit(req.user.id, 'pipeline.updated', row.candidate_id, stage);
    res.json({
      ok: true
    });
  }));
  app.post('/api/applications/:id/retry', wrap(async (req, res) => {
    const row = await getApplication(req.params.id, req.user);
    await db.prepare('UPDATE applications SET score_version=0,score_error=NULL WHERE id=?').run(row.id);
    await requestWork(req.user.workspace_id);
    res.json({
      ok: true
    });
  }));
  const storage = {
    _handleFile(req, file, callback) {
      const destination = path.join(files, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
      const count = new Transform({
        transform(chunk, _encoding, done) {
          req.uploadBytes = (req.uploadBytes || 0) + chunk.length;
          if (req.uploadBytes > 100 * 1024 * 1024) return done(Object.assign(new Error('Batch exceeds 100 MB. Split into smaller batches.'), {
            status: 413
          }));
          done(null, chunk);
        }
      });
      pipeline(file.stream, count, createWriteStream(destination, {
        flags: 'wx'
      })).then(() => callback(null, {
        path: destination
      })).catch(async err => {
        await unlink(destination).catch(() => {});
        callback(err);
      });
    },
    _removeFile(_req, file, callback) {
      unlink(file.path).then(() => callback(null)).catch(callback);
    }
  };
  const upload = multer({
    storage,
    limits: {
      files: 500,
      fileSize: 8 * 1024 * 1024,
      fields: 0,
      parts: 500
    },
    fileFilter(_req, file, cb) {
      if (!/\.(pdf|docx)$/i.test(file.originalname)) return cb(Object.assign(new Error('Only PDF and DOCX files are accepted'), {
        status: 400
      }));
      cb(null, true);
    }
  }).array('cvs', 500);
  app.post('/api/jobs/:id/upload', wrap(async (req, res) => {
    if(serverless)fail(400,'Use direct private uploads for this deployment. Refresh the application.');
    await getJob(req.params.id, req.user);
    const source = validate(z.string().trim().min(5).max(500), req.get('x-consent-source'));
    if (req.get('x-consent-granted') !== 'true') fail(400, 'Candidate consent is required for hiring evaluation');
    if (req.get('x-ai-consent') === 'true' && req.get('x-ai-provider') !== (await getSelection(req.user.workspace_id)).provider) fail(409, 'AI provider changed. Refresh and confirm consent for the selected provider.');
    const consent = {
      purpose: 'Hiring evaluation only',
      source,
      grantedAt: now(),
      recordedBy: req.user.id,
      aiProcessing: req.get('x-ai-consent') === 'true',
      aiProvider: (await getSelection(req.user.workspace_id)).provider
    };
    activeUploads.set(req.user.workspace_id, (activeUploads.get(req.user.workspace_id) || 0) + 1);
    try {
      await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
    } finally {
      activeUploads.set(req.user.workspace_id, activeUploads.get(req.user.workspace_id) - 1);
    }
    if (!req.files?.length) fail(400, 'Choose at least one CV');
    const id = randomUUID();
    await db.exec('BEGIN');
    try {
      await db.prepare('INSERT INTO batches(id,job_id,consent,created_at,workspace_id) VALUES(?,?,?,?,?)').run(id, req.params.id, JSON.stringify(consent), now(), req.user.workspace_id);
      for (const file of req.files) await db.prepare('INSERT INTO batch_items(id,batch_id,filename,file_path,status) VALUES(?,?,?,?,?)').run(randomUUID(), id, path.basename(file.originalname).slice(0, 180), file.path, 'pending');
      await audit(req.user.id, 'batch.uploaded', id, `${req.files.length} files; consent recorded`);
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      await Promise.all(req.files.map(f => unlink(f.path).catch(() => {})));
      throw error;
    }
    res.status(202).json({
      id
    });
  }));
  app.get('/api/jobs/:id/batches', wrap(async (req, res) => {
    await getJob(req.params.id, req.user);
    const offset=validate(z.coerce.number().int().min(0).max(10000000),req.query.offset||0);
    const batches = await db.prepare('SELECT id,job_id,created_at FROM batches WHERE job_id=? ORDER BY created_at DESC,id LIMIT 5 OFFSET ?').all(req.params.id,offset);
    res.json(await Promise.all(batches.map(async b => ({
      ...b,
      items: await db.prepare('SELECT id,filename,status,error,candidate_id FROM batch_items WHERE batch_id=?').all(b.id)
    }))));
  }));
  app.post('/api/batch-items/:id/retry', wrap(async (req, res) => {
    const item = await db.prepare('SELECT i.* FROM batch_items i JOIN batches b ON b.id=i.batch_id WHERE i.id=? AND b.workspace_id=?').get(req.params.id, req.user.workspace_id);
    if (!item || !['failed'].includes(item.status)) fail(404, 'Failed upload not found');
    await db.prepare("UPDATE batch_items SET status='pending',error=NULL WHERE id=?").run(item.id);
    await requestWork(req.user.workspace_id);
    res.json({
      ok: true
    });
  }));
  app.post('/api/batch-items/:id/transcript', wrap(async (req, res) => {
    const {
      text
    } = validate(z.object({
      text: z.string().trim().min(30).max(100000)
    }), req.body);
    const item = await db.prepare("SELECT i.*,b.job_id FROM batch_items i JOIN batches b ON b.id=i.batch_id WHERE i.id=? AND i.status='needs_review' AND b.workspace_id=?").get(req.params.id, req.user.workspace_id);
    if (!item) fail(404, 'Review item not found');
    const candidate = await db.prepare('SELECT * FROM candidates WHERE id=?').get(item.candidate_id);
    if (!candidate) fail(404, 'Candidate not found');
    const person = identity(text),
      lines = scoringLines(text, person.name),
      textHash = `${req.user.workspace_id}:${hash(text.toLowerCase().replace(/\s+/g, ''))}`;
    const duplicate = await db.prepare('SELECT id FROM candidates WHERE workspace_id=? AND id!=? AND (text_hash=? OR (email IS NOT NULL AND email=?))').get(req.user.workspace_id, candidate.id, textHash, person.email);
    if (duplicate) fail(409, 'This transcript matches an existing candidate. Delete the duplicate upload and use the original profile.');
    const waiting = await db.prepare("SELECT DISTINCT b.job_id FROM batch_items i JOIN batches b ON b.id=i.batch_id WHERE i.candidate_id=? AND i.status='needs_review'").all(candidate.id);
    await db.exec('BEGIN');
    try {
      await db.prepare('UPDATE candidates SET name=?,email=?,text=?,profile=?,text_hash=? WHERE id=?').run(person.name, person.email, text, JSON.stringify(profileFromLines(lines)), textHash, candidate.id);
      await db.prepare('DELETE FROM views WHERE application_id IN (SELECT id FROM applications WHERE candidate_id=?)').run(candidate.id);
      await db.prepare('UPDATE applications SET score=NULL,score_version=0,score_error=NULL,submitted_version=0 WHERE candidate_id=?').run(candidate.id);
      await db.prepare("UPDATE batch_items SET status='done',error=NULL WHERE candidate_id=? AND status='needs_review'").run(candidate.id);
      for (const waitingJob of waiting) await worker.attach(candidate.id, waitingJob.job_id);
      await audit(req.user.id, 'transcript.verified', candidate.id);
      await requestWork(req.user.workspace_id);
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
    res.json({
      ok: true
    });
  }));
  app.get('/api/batch-items/:id/review', wrap(async (req, res) => {
    const item = await db.prepare('SELECT i.id,c.id AS candidate_id,c.text FROM batch_items i JOIN candidates c ON c.id=i.candidate_id WHERE i.id=? AND c.workspace_id=?').get(req.params.id, req.user.workspace_id);
    if (!item) fail(404, 'Review item not found');
    await audit(req.user.id, 'transcript.viewed', item.candidate_id);
    res.json(item);
  }));
  app.get('/api/batch-items/:id/cv', wrap(async (req, res) => {
    const item = await db.prepare('SELECT i.* FROM batch_items i JOIN batches b ON b.id=i.batch_id WHERE i.id=? AND b.workspace_id=?').get(req.params.id, req.user.workspace_id);
    if (!item?.file_path) fail(404, 'CV file not found');
    if(fileStore.download){await audit(req.user.id,'cv.opened',item.candidate_id,'Parsing review');return res.redirect(await fileStore.download(item.file_path));}
    const content = await fileStore.read(item.file_path);
    await audit(req.user.id, 'cv.opened', item.candidate_id, 'Parsing review');
    res.type(item.file_path.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `inline; filename="review${path.extname(item.file_path)}"`);
    res.send(content);
  }));
  app.get('/api/privacy', wrap(async (req, res) => {
    const offset=validate(z.coerce.number().int().min(0).max(10000000),req.query.offset||0);
    res.json({
      candidates: (await db.prepare('SELECT id,name,consent,created_at FROM candidates WHERE workspace_id=? ORDER BY created_at,id LIMIT 500 OFFSET ?').all(req.user.workspace_id,offset)).map(c => ({
        ...c,
        consent: JSON.parse(c.consent)
      })),
      audit: await db.prepare('SELECT * FROM audit WHERE workspace_id=? ORDER BY id DESC LIMIT 200').all(req.user.workspace_id)
    });
  }));
  app.put('/api/candidates/:id/consent', wrap(async (req, res) => {
    const body = validate(z.object({
      source: z.string().trim().min(5).max(500),
      aiProcessing: z.boolean(),
      aiProvider: z.enum(['openai', 'gemini', 'groq']).optional()
    }), req.body);
    if (body.aiProcessing && body.aiProvider !== (await getSelection(req.user.workspace_id)).provider) fail(409, 'AI provider changed. Refresh and confirm consent for the selected provider.');
    if (!(await db.prepare('SELECT id FROM candidates WHERE id=? AND workspace_id=?').get(req.params.id, req.user.workspace_id))) fail(404, 'Candidate not found');
    await db.prepare('UPDATE candidates SET consent=? WHERE id=?').run(JSON.stringify({
      ...body,
      aiProvider: (await getSelection(req.user.workspace_id)).provider,
      purpose: 'Hiring evaluation only',
      grantedAt: now(),
      recordedBy: req.user.id
    }), req.params.id);
    await audit(req.user.id, 'consent.recorded', req.params.id);
    res.json({
      ok: true
    });
  }));
  app.delete('/api/candidates/:id', wrap(async (req, res) => {
    const candidate = await db.prepare('SELECT * FROM candidates WHERE id=? AND workspace_id=?').get(req.params.id, req.user.workspace_id);
    if (!candidate) fail(404, 'Candidate not found');
    const {
      confirmation
    } = validate(z.object({
      confirmation: z.string()
    }), req.body);
    if (confirmation !== candidate.id) fail(400, 'Type the candidate ID to confirm deletion');
    // Finish imports first so a queued copy cannot recreate an erased profile.
    if (await hasUpload(req.user.workspace_id)||activeUploads.get(req.user.workspace_id) || (await db.prepare("SELECT 1 FROM batch_items i JOIN batches b ON b.id=i.batch_id WHERE b.workspace_id=? AND i.status IN ('pending','processing') LIMIT 1").get(req.user.workspace_id))) fail(409, 'Wait for active CV imports to finish before deleting candidate data.');
    const items = await db.prepare('SELECT * FROM batch_items WHERE candidate_id=?').all(candidate.id);
    for (const location of new Set([candidate.file_path, ...items.map(i => i.file_path)].filter(Boolean))) await fileStore.remove(location).catch(err => {
      if (err.code !== 'ENOENT') throw err;
    });
    await db.exec('BEGIN');
    try {
      for (const item of items) await db.prepare("UPDATE batch_items SET filename='Deleted CV',file_path=NULL,file_hash=NULL,error=NULL,status='deleted' WHERE id=?").run(item.id);
      if(serverless)for(const item of items)await db.prepare('DELETE FROM upload_files WHERE id=?').run(item.id);
      const appIds = (await db.prepare('SELECT id FROM applications WHERE candidate_id=?').all(candidate.id)).map(a => a.id);
      await db.prepare('DELETE FROM candidates WHERE id=?').run(candidate.id);
      await db.prepare('DELETE FROM audit WHERE subject=? OR subject IN (SELECT value FROM json_each(?))').run(candidate.id, JSON.stringify(appIds));
      // Saved weekly samples may include an erased candidate; remove those snapshots too.
      for (const review of await db.prepare('SELECT week,snapshot FROM weekly_reviews').all()) if (JSON.parse(review.snapshot).some(row => row.candidateId === candidate.id)) await db.prepare('DELETE FROM weekly_reviews WHERE week=?').run(review.week);
      await db.prepare("UPDATE batches SET consent=? WHERE workspace_id=? AND id NOT IN (SELECT batch_id FROM batch_items WHERE status!='deleted')").run(JSON.stringify({
        erased: true
      }), req.user.workspace_id);
      if(serverless)await db.prepare("UPDATE upload_sessions SET consent=? WHERE workspace_id=? AND id IN (SELECT id FROM batches WHERE consent=?)").run(JSON.stringify({erased:true}),req.user.workspace_id,JSON.stringify({erased:true}));
      await audit(req.user.id, 'candidate.deleted', null, 'Candidate files, profile, decisions, consent and linked view history erased');
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
    await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    res.json({
      ok: true
    });
  }));
  async function weeklySample(workspaceId) {
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    const rows = await db.prepare('SELECT a.*,c.name,c.profile,j.version,j.title FROM applications a JOIN candidates c ON c.id=a.candidate_id JOIN jobs j ON j.id=a.job_id WHERE j.workspace_id=? AND (a.created_at>=? OR a.submitted_at>=?) ORDER BY a.job_id,a.created_at').all(workspaceId, cutoff, cutoff);
    const sample = [];
    for (const jobId of new Set(rows.map(r => r.job_id))) {
      const ranked = rows.filter(r => r.job_id === jobId).sort((a, b) => (b.score_version === b.version && b.score ? JSON.parse(b.score).total : -1) - (a.score_version === a.version && a.score ? JSON.parse(a.score).total : -1));
      ranked.forEach((r, i) => sample.push({
        candidateId: r.candidate_id,
        jobId,
        job: r.title,
        rank: i + 1,
        score: r.score_version === r.version && r.score ? JSON.parse(r.score).total : null,
        stage: r.stage,
        chosen: Boolean(r.submitted_at)
      }));
    }
    return sample.slice(0, 30);
  }
  app.get('/api/weekly-review', wrap(async (req, res) => {const offset=validate(z.coerce.number().int().min(0).max(10000000),req.query.offset||0);return res.json({
    sample: await weeklySample(req.user.workspace_id),
    reviews: (await db.prepare('SELECT * FROM weekly_reviews WHERE workspace_id=? ORDER BY week DESC LIMIT 25 OFFSET ?').all(req.user.workspace_id,offset)).map(r => ({
      ...r,
      snapshot: JSON.parse(r.snapshot)
    }))
  });}));
  app.post('/api/weekly-review', wrap(async (req, res) => {
    const {
      notes
    } = validate(z.object({
      notes: z.string().trim().min(10).max(3000)
    }), req.body);
    const week = `${req.user.workspace_id}:${now().slice(0, 10)}`;
    await db.prepare('INSERT INTO weekly_reviews(week,actor,notes,snapshot,created_at,workspace_id) VALUES(?,?,?,?,?,?) ON CONFLICT(week) DO UPDATE SET actor=excluded.actor,notes=excluded.notes,snapshot=excluded.snapshot,created_at=excluded.created_at').run(week, req.user.id, notes, JSON.stringify(await weeklySample(req.user.workspace_id)), now(), req.user.workspace_id);
    await audit(req.user.id, 'weekly_review.recorded');
    res.json({
      ok: true
    });
  }));
  app.use(['/dashboard', '/setup/provider'], wrap(async (req, res, next) => {
    const user = await auth.sessionUser(req);
    if (!user) return res.redirect('/login');
    res.set('Cache-Control', 'private, no-store');
    if (req.baseUrl === '/setup/provider' && user.role === 'client') return res.redirect('/dashboard');
    if (req.baseUrl === '/dashboard' && user.role === 'recruiter' && !aiEnabled(await getSelection(user.workspace_id))) return res.redirect('/setup/provider');
    next();
  }));
  app.use('/api', (_req, res) => res.status(404).json({
    error: 'API route not found'
  }));
  app.use((error, req, res, _next) => {
    if (req.files && error instanceof multer.MulterError) for (const file of req.files) unlink(file.path).catch(() => {});
    const status = error instanceof multer.MulterError ? 400 : error.status || 500;
    if (status === 500) console.error(error.message);
    res.status(status).json({
      error: error instanceof multer.MulterError ? `Upload limit: ${error.message}` : status === 500 ? 'Unexpected error. Please retry.' : error.message
    });
  });
  return {
    app,
    db,
    worker,
    audit,
    sessionUser: auth.sessionUser,
    providerReady: async user => aiEnabled(await getSelection(user.workspace_id)),
    close: async () => {
      await worker.stop();
      await db.close();
    }
  };
}
