import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { makePdf, makeDocx } from '../scripts/generate-samples.js';
import { parseCv } from '../server/parser.js';
import { samples, sampleText } from '../server/seed.js';
test('standalone assignment workflow, bulk parsing, permissions and erasure', async t => {
  const envNames = ['AI_PROVIDER', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY'];
  const previous = Object.fromEntries(envNames.map(k => [k, process.env[k]]));
  for (const k of envNames) delete process.env[k];
  const directory = await mkdtemp(path.join(os.tmpdir(), 'shortlist-test-'));
  const runtime = await createApp({
    directory,
    demo: true
  });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let recruiter, client, other, uploadedCandidate;
  async function request(route, {
    cookie,
    body,
    method = 'GET',
    headers = {}
  } = {}) {
    const response = await fetch(base + route, {
      method,
      headers: {
        ...(cookie ? {
          cookie
        } : {}),
        ...(body && !(body instanceof FormData) ? {
          'Content-Type': 'application/json'
        } : {}),
        ...headers
      },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return {
      status: response.status,
      data,
      headers: response.headers
    };
  }
  async function login(email) {
    const r = await request('/auth/login', {
      method: 'POST',
      body: {
        email,
        password: 'Demo@12345'
      }
    });
    assert.equal(r.status, 200);
    return r.headers.get('set-cookie').split(';')[0];
  }
  async function upload(files, {
    consent = true,
    source = 'Candidate opt-in email',
    ...rest
  } = {}) {
    const body = new FormData();
    for (const file of files) body.append('cvs', new Blob([file.data]), file.name);
    return request('/jobs/REQ-2401/upload', {
      method: 'POST',
      cookie: recruiter,
      body,
      headers: {
        'x-consent-source': source,
        'x-consent-granted': String(consent),
        'x-ai-consent': 'false',
        ...rest
      }
    });
  }
  async function drain() {
    for (let i = 0; i < 1100; i++) {
      await runtime.worker.tick();
      const pending = runtime.db.prepare("SELECT COUNT(*) n FROM batch_items WHERE status IN ('pending','processing')").get().n;
      const scoring = runtime.db.prepare('SELECT COUNT(*) n FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.score_version!=j.version AND a.score_error IS NULL').get().n;
      if (!pending && !scoring) return;
      await new Promise(r => setTimeout(r, 2));
    }
    throw new Error('Worker queue did not drain');
  }
  try {
    await t.test('non-demo operation refuses databases with shared demo credentials', async () => {
      await assert.rejects(async () => await createApp({
        directory,
        demo: false,
        production: true
      }), /Demo accounts found/);
    });
    await t.test('authentication and roles are enforced', async () => {
      assert.equal((await request('/jobs')).status, 401);
      assert.equal((await request('/auth/login', {
        method: 'POST',
        body: {
          email: 'recruiter@company-a.test',
          password: 'wrong'
        }
      })).status, 401);
      recruiter = await login('recruiter@company-a.test');
      client = await login('client@northstar.test');
      other = await login('client@meridian.test');
      assert.equal((await request('/jobs', {
        cookie: recruiter
      })).data.length, 3);
      assert.equal((await request('/privacy', {
        cookie: client
      })).status, 403);
      assert.equal((await request('/jobs/REQ-2401/candidates', {
        cookie: other
      })).status, 404);
      assert.equal((await request('/auth/logout', {
        method: 'POST',
        cookie: recruiter,
        body: {},
        headers: {
          origin: 'https://evil.example'
        }
      })).status, 403);
    });
    await t.test('provider settings are recruiter-only, validated and persist with defaults', async () => {
      assert.equal((await request('/settings/ai', {
        cookie: client
      })).status, 403);
      assert.equal((await request('/settings/ai', {
        cookie: client,
        method: 'PUT',
        body: {
          provider: 'groq'
        }
      })).status, 403);
      for (const [provider, model] of [['openai', 'gpt-4.1-mini'], ['gemini', 'gemini-2.5-flash'], ['groq', 'openai/gpt-oss-120b']]) {
        const result = await request('/settings/ai', {
          cookie: recruiter,
          method: 'PUT',
          body: {
            provider
          }
        });
        assert.equal(result.status, 200);
        assert.equal(result.data.selection.model, model);
        assert.equal(JSON.parse(runtime.db.prepare("SELECT value FROM settings WHERE key='demo:ai'").get().value).provider, provider);
        const config = (await request('/config')).data;
        assert.equal(config.ai.provider, provider);
        assert.equal(config.aiEnabled, false);
      }
      assert.equal((await request('/settings/ai', {
        cookie: recruiter,
        method: 'PUT',
        body: {
          provider: 'unknown'
        }
      })).status, 400);
      assert.equal((await request('/settings/ai', {
        cookie: recruiter,
        method: 'PUT',
        body: {
          provider: 'openai',
          apiKey: 'bad key'
        }
      })).status, 400);
      assert.equal((await request('/settings/ai', {
        cookie: recruiter,
        method: 'PUT',
        body: {
          provider: 'gemini'
        }
      })).status, 200);
      assert.equal((await request('/candidates/CND-91022/consent', {
        cookie: recruiter,
        method: 'PUT',
        body: {
          source: 'Candidate opt-in email',
          aiProcessing: true,
          aiProvider: 'groq'
        }
      })).status, 409);
      const settings = (await request('/settings/ai', {
        cookie: recruiter
      })).data;
      assert(settings.providers.every(p => !('apiKey' in p)));
    });
    await t.test('JD extraction and requisition creation preserve editable numeric requirements', async () => {
      const jd = 'Java Developer, 5-8 years, Java, Spring Boot, Noida, notice up to 60 days, CTC up to 25 LPA';
      const extracted = await request('/scorecard/extract', {
        cookie: recruiter,
        method: 'POST',
        body: {
          jd
        }
      });
      assert.equal(extracted.status, 200);
      assert.equal(extracted.data.mode, 'demo');
      assert.equal(extracted.data.criteria.find(c => c.kind === 'ctc').max, 25);
      assert.equal(extracted.data.criteria.find(c => c.kind === 'notice').max, 60);
      const result = await request('/jobs', {
        cookie: recruiter,
        method: 'POST',
        body: {
          title: 'Java Developer',
          clientId: 'meridian',
          location: 'Noida',
          jd,
          criteria: extracted.data.criteria
        }
      });
      assert.equal(result.status, 201);
      assert.equal((await request(`/jobs/${result.data.id}/candidates`, {
        cookie: client
      })).status, 404);
      assert.equal((await request('/jobs', {
        cookie: other
      })).data.some(j => j.id === result.data.id), true);
    });
    const appId = 'APP-REQ-2401-CND-91022';
    await t.test('a recruiter must open the CV before submission; client access is isolated and masked', async () => {
      assert.equal((await request(`/applications/${appId}/submit`, {
        method: 'POST',
        cookie: recruiter,
        body: {}
      })).status, 409);
      assert.equal((await request(`/applications/${appId}`, {
        cookie: client
      })).status, 404);
      assert.equal((await request(`/applications/${appId}/cv`, {
        cookie: recruiter
      })).status, 200);
      assert.equal((await request(`/applications/${appId}/submit`, {
        method: 'POST',
        cookie: recruiter,
        body: {}
      })).status, 200);
      const masked = await request(`/applications/${appId}`, {
        cookie: client
      });
      assert.equal(masked.status, 200);
      assert.equal(masked.data.name, 'CND-91022');
      assert(!JSON.stringify(masked.data).includes('Ritika'));
      assert(!('email' in masked.data));
      assert.equal((await request(`/applications/${appId}/cv`, {
        cookie: client
      })).status, 403);
      assert.equal((await request(`/applications/${appId}`, {
        cookie: other
      })).status, 404);
    });
    await t.test('client decisions require reasons and future slots and update the shared pipeline', async () => {
      assert.equal((await request(`/applications/${appId}/decision`, {
        method: 'POST',
        cookie: client,
        body: {
          action: 'reject'
        }
      })).status, 400);
      assert.equal((await request(`/applications/${appId}/decision`, {
        method: 'POST',
        cookie: client,
        body: {
          action: 'interview',
          interviewAt: '2020-01-01T12:00:00Z'
        }
      })).status, 400);
      assert.equal((await request(`/applications/${appId}/decision`, {
        method: 'POST',
        cookie: client,
        body: {
          action: 'shortlist'
        }
      })).status, 200);
      const slot = new Date(Date.now() + 86400000).toISOString();
      assert.equal((await request(`/applications/${appId}/decision`, {
        method: 'POST',
        cookie: client,
        body: {
          action: 'interview',
          interviewAt: slot
        }
      })).status, 200);
      const r = await request(`/applications/${appId}`, {
        cookie: recruiter
      });
      assert.equal(r.data.stage, 'Interview');
      assert.equal(r.data.interviewAt, slot);
    });
    await t.test('scorecard edits invalidate old scores and the original CV review', async () => {
      const job = (await request('/jobs', {
        cookie: recruiter
      })).data[0];
      const body = {
        title: job.title,
        clientId: job.client_id,
        location: job.location,
        jd: job.jd,
        criteria: job.criteria,
        version: job.version
      };
      assert.equal((await request(`/jobs/${job.id}/scorecard`, {
        method: 'PUT',
        cookie: recruiter,
        body
      })).status, 200);
      assert.equal((await request(`/jobs/${job.id}/scorecard`, {
        method: 'PUT',
        cookie: recruiter,
        body
      })).status, 409);
      await drain();
      assert.equal((await request(`/applications/${appId}/submit`, {
        method: 'POST',
        cookie: recruiter,
        body: {}
      })).status, 409);
    });
    await t.test('PDF and table-based DOCX layouts parse into job facts', async () => {
      const text = 'Neel Kapoor\nCurrent role: Senior Java Developer\nTotal experience: 6 years\nKey skills: Java, Spring Boot, microservices\nNotice period: 30 days\nLocation: Noida';
      const pdf = path.join(directory, 'parser.pdf'),
        docx = path.join(directory, 'parser.docx');
      await writeFile(pdf, makePdf(text));
      await writeFile(docx, await makeDocx(text, true));
      for (const [file, name] of [[pdf, 'cv.pdf'], [docx, 'cv.docx']]) {
        const parsed = await parseCv(file, name, false);
        assert(!parsed.needsReview);
        assert.match(parsed.text, /Spring Boot/);
        assert.match(parsed.text, /6 years/);
      }
      const result = await upload([{
        name: 'neel.pdf',
        data: makePdf(text)
      }]);
      assert.equal(result.status, 202);
      await drain();
      const candidate = runtime.db.prepare("SELECT * FROM candidates WHERE name='Neel Kapoor'").get();
      assert(candidate);
      uploadedCandidate = candidate;
      const app = runtime.db.prepare('SELECT * FROM applications WHERE candidate_id=?').get(candidate.id);
      assert.equal(JSON.parse(app.score).total, 100);
    });
    await t.test('consent, file signatures and the 500-file limit are validated', async () => {
      assert.equal((await upload([{
        name: 'cv.pdf',
        data: makePdf(sampleText(samples[0]))
      }], {
        consent: false
      })).status, 400);
      assert.equal((await upload([{
        name: 'cv.exe',
        data: Buffer.from('bad')
      }])).status, 400);
      const malformed = await upload([{
        name: 'fake.pdf',
        data: Buffer.from('not a PDF')
      }]);
      assert.equal(malformed.status, 202);
      await drain();
      assert.equal(runtime.db.prepare('SELECT status FROM batch_items WHERE batch_id=?').get(malformed.data.id).status, 'failed');
      const files = Array.from({
        length: 501
      }, (_, i) => ({
        name: `cv-${i}.pdf`,
        data: Buffer.from('%PDF-fake')
      }));
      assert.equal((await upload(files)).status, 400);
    });
    await t.test('500 actual CV files process without duplicate candidate records', async () => {
      const pdf = await readFile(uploadedCandidate.file_path),
        countBefore = runtime.db.prepare('SELECT COUNT(*) n FROM candidates').get().n;
      const result = await upload(Array.from({
        length: 500
      }, (_, i) => ({
        name: `cv-${i}.pdf`,
        data: pdf
      })));
      assert.equal(result.status, 202);
      assert.equal((await request(`/candidates/${uploadedCandidate.id}`, {
        method: 'DELETE',
        cookie: recruiter,
        body: {
          confirmation: uploadedCandidate.id
        }
      })).status, 409);
      await drain();
      assert.equal(runtime.db.prepare("SELECT COUNT(*) n FROM batch_items WHERE batch_id=? AND status='duplicate'").get(result.data.id).n, 500);
      assert.equal(runtime.db.prepare('SELECT COUNT(*) n FROM candidates').get().n, countBefore);
    });
    await t.test('same CV text in another format deduplicates against the assignment samples', async () => {
      const result = await upload([{
        name: 'ritika.docx',
        data: await makeDocx(sampleText(samples[0]), true)
      }, {
        name: 'ritika.pdf',
        data: makePdf(sampleText(samples[0]))
      }]);
      await drain();
      const items = runtime.db.prepare('SELECT * FROM batch_items WHERE batch_id=?').all(result.data.id);
      assert.equal(items.length, 2);
      for (const item of items) {
        assert.equal(item.status, 'duplicate');
        assert.equal(item.candidate_id, 'CND-91022');
      }
      assert(runtime.db.prepare('SELECT file_path FROM candidates WHERE id=?').get('CND-91022').file_path);
    });
    await t.test('scanned or empty PDFs wait for a verified transcript and do not get scored', async () => {
      const result = await upload([{
        name: 'scanned.pdf',
        data: makePdf(' ')
      }]);
      await drain();
      const item = runtime.db.prepare('SELECT * FROM batch_items WHERE batch_id=?').get(result.data.id);
      assert.equal(item.status, 'needs_review');
      assert(item.candidate_id);
      assert.equal(runtime.db.prepare('SELECT COUNT(*) n FROM applications WHERE candidate_id=?').get(item.candidate_id).n, 0);
      assert.equal((await request(`/batch-items/${item.id}/transcript`, {
        method: 'POST',
        cookie: recruiter,
        body: {
          text: 'Verified scan\nCurrent role: Java Developer\nTotal experience: 7 years\nKey skills: Java, Spring Boot\nNotice period: 45 days'
        }
      })).status, 200);
      await drain();
      assert(runtime.db.prepare('SELECT score FROM applications WHERE candidate_id=?').get(item.candidate_id).score);
    });
    await t.test('weekly samples compare ranks with recruiter choices and record review notes', async () => {
      const result = await request('/weekly-review', {
        cookie: recruiter
      });
      assert(result.data.sample.some(r => r.candidateId === 'CND-91022' && r.chosen));
      assert.equal((await request('/weekly-review', {
        method: 'POST',
        cookie: recruiter,
        body: {
          notes: 'Verify lower ranks with missing location. No automatic rejections.'
        }
      })).status, 200);
    });
    await t.test('deletion removes original files, profiles, application access and copied metadata', async () => {
      const id = uploadedCandidate.id;
      assert.equal((await request(`/candidates/${id}`, {
        method: 'DELETE',
        cookie: client,
        body: {
          confirmation: id
        }
      })).status, 403);
      assert.equal((await request(`/candidates/${id}`, {
        method: 'DELETE',
        cookie: recruiter,
        body: {
          confirmation: 'wrong'
        }
      })).status, 400);
      assert.equal((await request(`/candidates/${id}`, {
        method: 'DELETE',
        cookie: recruiter,
        body: {
          confirmation: id
        }
      })).status, 200);
      await assert.rejects(access(uploadedCandidate.file_path));
      assert.equal(runtime.db.prepare('SELECT COUNT(*) n FROM candidates WHERE id=?').get(id).n, 0);
      assert.equal(runtime.db.prepare('SELECT COUNT(*) n FROM applications WHERE candidate_id=?').get(id).n, 0);
      assert.equal(runtime.db.prepare("SELECT COUNT(*) n FROM batch_items WHERE filename='Deleted CV'").get().n, 501);
      assert.equal(runtime.db.prepare('SELECT COUNT(*) n FROM weekly_reviews').get().n, 0);
    });
  } finally {
    await runtime.close();
    await new Promise(resolve => server.close(resolve));
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('shortlist-test-')) throw new Error('Unexpected test directory');
    await rm(directory, {
      recursive: true,
      force: true
    });
    for (const k of envNames) if (previous[k] === undefined) delete process.env[k];else process.env[k] = previous[k];
  }
});
