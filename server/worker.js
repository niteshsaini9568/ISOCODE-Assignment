import { randomUUID } from 'node:crypto';
import { localFiles } from './files.js';
import { hash, identity, scoringLines, profileFromLines, now } from './domain.js';
import { parseCv } from './parser.js';
import { score, parseProfile, aiSelection, aiEnabled, allowsAi } from './ai.js';
import { decodeJob } from './db.js';
export async function createWorker(db, audit, getSelection = aiSelection, {serverless=false,files=localFiles}={}) {
  let running = false,
    stopped = false;
  if(!serverless)await db.prepare("UPDATE batch_items SET status='pending' WHERE status='processing'").run();
  const awaitingReview = async candidateId => Boolean(await db.prepare("SELECT 1 FROM batch_items WHERE candidate_id=? AND status='needs_review' LIMIT 1").get(candidateId));
  async function attach(candidateId, jobId) {
    const job = decodeJob(await db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId));
    const candidate = await db.prepare('SELECT * FROM candidates WHERE id=?').get(candidateId);
    if (!candidate || !job || candidate.workspace_id !== job.workspace_id || (await awaitingReview(candidateId))) return;
    const app = await db.prepare('SELECT * FROM applications WHERE job_id=? AND candidate_id=?').get(jobId, candidateId);
    if (!app) await db.prepare('INSERT INTO applications(id,job_id,candidate_id,created_at) VALUES(?,?,?,?)').run(randomUUID(), jobId, candidateId, now());
  }
  async function tick(workspace=null) {
    if ((!serverless&&running) || stopped) return false;
    running = true;
    try {
      const item = await db.prepare("SELECT i.*, b.job_id,b.consent,b.workspace_id FROM batch_items i JOIN batches b ON b.id=i.batch_id WHERE i.status='pending' AND (? IS NULL OR b.workspace_id=?) ORDER BY b.created_at,i.rowid LIMIT 1").get(workspace,workspace);
      if (item) {
        const selection = await getSelection(item.workspace_id);
        await db.prepare("UPDATE batch_items SET status='processing',error=NULL WHERE id=?").run(item.id);
        try {
          const consent = JSON.parse(item.consent);
          const buffer=await files.read(item.file_path);
          const fileHash = `${item.workspace_id}:${hash(buffer)}`;
          let duplicate = await db.prepare('SELECT * FROM candidates WHERE file_hash=?').get(fileHash);
          if (duplicate && (await awaitingReview(duplicate.id))) {
            await db.prepare("UPDATE batch_items SET status='needs_review',candidate_id=?,file_hash=?,error=? WHERE id=?").run(duplicate.id, fileHash, 'This existing scan still needs a verified transcript before scoring.', item.id);
          } else if (duplicate) {
            await attach(duplicate.id, item.job_id);
            if(!serverless&&duplicate.file_path!==item.file_path)await files.remove(item.file_path);
            await db.prepare("UPDATE batch_items SET status='duplicate',candidate_id=?,file_path=NULL,file_hash=NULL,error=? WHERE id=?").run(duplicate.id, 'Existing profile reused; no duplicate record created.', item.id);
          } else {
            const parsed = await parseCv(buffer, item.filename, allowsAi(consent, selection), selection);
            const person = identity(parsed.text),
              lines = scoringLines(parsed.text, person.name);
            const textHash = parsed.text ? `${item.workspace_id}:${hash(parsed.text.toLowerCase().replace(/\s+/g, ''))}` : null;
            duplicate = textHash && (await db.prepare('SELECT * FROM candidates WHERE text_hash=?').get(textHash)) || person.email && (await db.prepare('SELECT * FROM candidates WHERE email=? AND workspace_id=?').get(person.email, item.workspace_id));
            if (duplicate && (await awaitingReview(duplicate.id))) {
              await db.prepare("UPDATE batch_items SET status='needs_review',candidate_id=?,file_hash=?,error=? WHERE id=?").run(duplicate.id, fileHash, 'This existing profile still needs a verified transcript before scoring.', item.id);
            } else if (duplicate) {
              await attach(duplicate.id, item.job_id);
              if (!duplicate.file_path) await db.prepare('UPDATE candidates SET file_path=?,file_hash=? WHERE id=?').run(item.file_path, fileHash, duplicate.id);else if(!serverless&&duplicate.file_path!==item.file_path)await files.remove(item.file_path);
              await db.prepare("UPDATE batch_items SET status='duplicate',candidate_id=?,file_path=NULL,error=? WHERE id=?").run(duplicate.id, 'Matching text or email found. Existing profile reused.', item.id);
            } else {
              const id = `CND-${randomUUID().slice(0, 8).toUpperCase()}`;
              const profile = parsed.needsReview ? profileFromLines(lines) : await parseProfile(lines, profileFromLines(lines), consent, selection);
              await db.exec('BEGIN');try{
              await db.prepare('INSERT INTO candidates(id,name,email,text,profile,file_path,file_hash,text_hash,consent,created_at,workspace_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, person.name, person.email, parsed.text, JSON.stringify(profile), item.file_path, fileHash, textHash, JSON.stringify(consent), now(), item.workspace_id);
              if (!parsed.needsReview) await attach(id, item.job_id);
              await db.prepare('UPDATE batch_items SET status=?,candidate_id=?,file_hash=?,error=? WHERE id=?').run(parsed.needsReview ? 'needs_review' : 'done', id, fileHash, parsed.message || null, item.id);
              await audit(consent.recordedBy || 'worker', 'candidate.parsed', id, parsed.needsReview ? 'Verification required' : 'Ready for evidence scoring');
              await db.exec('COMMIT');}catch(error){await db.exec('ROLLBACK');throw error;}
            }
          }
        } catch (error) {
          await db.prepare("UPDATE batch_items SET status='failed',error=? WHERE id=?").run(error.status ? error.message : 'Could not parse this document. Check the file and retry.', item.id);
        }
      } else {
        const app = await db.prepare('SELECT a.*,c.text,c.name,c.consent,j.criteria,j.version,j.workspace_id FROM applications a JOIN candidates c ON c.id=a.candidate_id JOIN jobs j ON j.id=a.job_id WHERE a.score_version!=j.version AND a.score_error IS NULL AND (? IS NULL OR j.workspace_id=?) LIMIT 1').get(workspace,workspace);
        if (app) {
          const selection = await getSelection(app.workspace_id);
          try {
            const lines = scoringLines(app.text, app.name);
            // AI is never sent a candidate's data without recorded processing consent.
            if (aiEnabled(selection) && !allowsAi(JSON.parse(app.consent), selection)) throw Object.assign(new Error(`Consent for ${selection.provider} processing required. Record consent before retrying.`), {
              status: 422
            });
            const result = await score(JSON.parse(app.criteria), lines, selection);
            if (await db.prepare('SELECT id FROM applications WHERE id=?').get(app.id)) await db.prepare('UPDATE applications SET score=?,score_version=?,score_error=NULL WHERE id=?').run(JSON.stringify(result), app.version, app.id);
          } catch (error) {
            await db.prepare('UPDATE applications SET score_error=? WHERE id=?').run(error.status ? error.message : 'Scoring failed. Retry after checking the profile.', app.id);
          }
        } else return false;
      }
      return true;
    } catch (error) {
      if(serverless)throw error;
      console.error('Worker:', error.message);
    } finally {
      running = false;
    }
  }
  const timer = serverless?null:setInterval(()=>tick(), 150);
  timer?.unref();
  return {
    tick,
    attach,
    isRunning: () => running,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      while (running) await new Promise(r => setTimeout(r, 25));
    }
  };
}
