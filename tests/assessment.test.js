import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { makePdf, makeDocx } from '../scripts/generate-samples.js';
import { samples, sampleText } from '../server/seed.js';
import { demoScore } from '../server/domain.js';
import { createCredentials } from '../server/credentials.js';
import { collectPages } from '../src/api-pages.js';
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'shortlist-assessment-'));
  const keys = ['AI_PROVIDER', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY'];
  const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  const runtime = await createApp({
      directory,
      demo: true,
      production: true
    }),
    server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(route, {
    cookie,
    body,
    method = 'GET',
    headers = {}
  } = {}) {
    const response = await fetch(base + route, {
      method,
      redirect: 'manual',
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
      headers: response.headers,
      cookie: response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    };
  }
  const login = async email => {
    const result = await request('/auth/login', {
      method: 'POST',
      body: {
        email,
        password: 'Demo@12345'
      }
    });
    assert.equal(result.status, 200);
    return result.cookie;
  };
  const drain = async () => {
    for (let i = 0; i < 5000; i++) {
      await runtime.worker.tick();
      const queued = runtime.db.prepare("SELECT 1 FROM batch_items WHERE status IN ('pending','processing') LIMIT 1").get();
      const scoring = runtime.db.prepare('SELECT 1 FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.score_version!=j.version AND a.score_error IS NULL LIMIT 1').get();
      if (!queued && !scoring) return;
      await new Promise(r => setTimeout(r, 1));
    }
    throw Error('Queue did not finish');
  };
  t.after(async () => {
    await new Promise(r => server.close(r));
    await runtime.close();
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert(path.basename(directory).startsWith('shortlist-assessment-'));
    await rm(directory, {
      recursive: true,
      force: true
    });
    for (const k of keys) if (previous[k] === undefined) delete process.env[k];else process.env[k] = previous[k];
  });
  return {
    directory,
    runtime,
    request,
    login,
    drain
  };
}
test('services: production headers, request boundaries, roles and expired sessions', async t => {
  const {
      runtime,
      request,
      login
    } = await fixture(t),
    cookie = await login('recruiter@company-a.test'),
    client = await login('client@northstar.test');
  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert(health.headers.get('content-security-policy'));
  assert(health.headers.get('strict-transport-security'));
  assert.equal(health.headers.get('x-powered-by'), null);
  const session = await request('/auth/login', {
    method: 'POST',
    body: {
      email: 'recruiter@company-a.test',
      password: 'Demo@12345'
    }
  });
  assert.match(session.headers.get('set-cookie'), /HttpOnly/);
  assert.match(session.headers.get('set-cookie'), /SameSite=Lax/);
  for (const headers of [{
    origin: 'https://untrusted.example'
  }, {
    'sec-fetch-site': 'cross-site'
  }, {
    origin: 'invalid-url'
  }]) assert.equal((await request('/clients', {
    method: 'POST',
    cookie,
    body: {
      name: 'Blocked client'
    },
    headers
  })).status, 403);
  for (const route of ['/settings/ai', '/privacy', '/weekly-review']) assert.equal((await request(route, {
    cookie: client
  })).status, 403);
  assert.equal((await request('/clients', {
    cookie: client,
    method: 'POST',
    body: {
      name: 'Blocked'
    }
  })).status, 403);
  assert.equal((await request('/unknown-service', {
    cookie
  })).status, 404);
  assert.equal((await request('/jobs', {
    cookie: 'shortlist_session=forged'
  })).status, 401);
  assert.equal((await request('/clients', {
    cookie,
    method: 'POST',
    body: {
      name: 'x'.repeat(220000)
    }
  })).status, 413);
  runtime.db.prepare("UPDATE sessions SET expires='2000-01-01T00:00:00.000Z'").run();
  assert.equal((await request('/jobs', {
    cookie
  })).status, 401);
});
test('provider setup: workspace keys are validated, encrypted, isolated and never returned', async t => {
  const {
      directory,
      runtime,
      request,
      login,
      drain
    } = await fixture(t),
    cookie = await login('recruiter@company-a.test'),
    client = await login('client@northstar.test');
  await drain();
  runtime.app.get(['/setup/provider', '/dashboard'], (_req, res) => res.send('page'));
  assert.equal((await request('/../setup/provider')).headers.get('location'), '/login');
  assert.equal((await request('/../dashboard', {
    cookie
  })).headers.get('location'), '/setup/provider');
  assert.equal((await request('/../setup/provider', {
    cookie: client
  })).headers.get('location'), '/dashboard');
  assert.equal(await runtime.providerReady(await runtime.sessionUser({
    headers: {
      cookie
    }
  })), false);
  const originalFetch = globalThis.fetch,
    calls = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options);
    calls.push({
      url,
      options
    });
    if (JSON.stringify(options.headers).includes('invalid-fixture-key')) return new Response('Private provider error', {
      status: 401
    });
    const body = JSON.parse(options.body),
      instruction = body.messages?.[0].content || body.systemInstruction.parts[0].text;
    const data = JSON.parse(body.messages?.[1].content || body.contents[0].parts[0].text);
    const result = instruction.startsWith('Extract {"criteria"') ? {
      criteria: JSON.parse(runtime.db.prepare("SELECT criteria FROM jobs WHERE id='REQ-2401'").get().criteria)
    } : instruction.startsWith('Evaluate each criterion') ? {
      criteria: demoScore(data.criteria, data.lines).criteria
    } : {
      ok: true
    };
    const content = JSON.stringify(result);
    return Response.json(String(url).includes('googleapis') ? {
      candidates: [{
        content: {
          parts: [{
            text: content
          }]
        }
      }]
    } : {
      choices: [{
        message: {
          content
        }
      }]
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  for (const provider of ['openai', 'gemini', 'groq']) {
    const key = `synthetic-${provider}-workspace-key`,
      result = await request('/settings/ai', {
        cookie,
        method: 'PUT',
        body: {
          provider,
          apiKey: key
        }
      });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.enabled, true);
    assert.equal(result.data.selection.provider, provider);
    assert.equal(result.data.providers.find(p => p.id === provider).ownKey, true);
    assert(!JSON.stringify(result.data).includes(key));
    assert(!JSON.stringify((await request('/config', {
      cookie
    })).data).includes(key));
    const stored = runtime.db.prepare('SELECT secret FROM ai_credentials WHERE workspace_id=? AND provider=?').get('demo', provider).secret;
    assert(!stored.includes(key));
    assert.equal(await (await createCredentials(runtime.db, directory)).get('demo', provider), key);
    assert.equal(await (await createCredentials(runtime.db, directory)).get('unrelated', provider), undefined);
    assert(!JSON.stringify(runtime.db.prepare('SELECT * FROM audit').all()).includes(key));
    assert(!JSON.stringify(runtime.db.prepare('SELECT * FROM settings').all()).includes(key));
  }
  assert.equal(calls.length, 3);
  assert(calls.every(c => !c.options.body.includes('Ritika')));
  const extraction = await request('/scorecard/extract', {
    cookie,
    method: 'POST',
    body: {
      jd: 'Senior Java Developer, Java, Spring Boot, 5-8 years, Noida'
    }
  });
  assert.equal(extraction.status, 200);
  assert.equal(extraction.data.mode, 'ai');
  assert(!JSON.stringify(extraction.data).includes('workspace-key'));
  assert.equal((await request('/candidates/CND-91022/consent', {
    cookie,
    method: 'PUT',
    body: {
      source: 'Synthetic Groq processing consent',
      aiProcessing: true,
      aiProvider: 'groq'
    }
  })).status, 200);
  await request('/applications/APP-REQ-2401-CND-91022/retry', {
    cookie,
    method: 'POST',
    body: {}
  });
  await drain();
  const scored = runtime.db.prepare("SELECT score FROM applications WHERE id='APP-REQ-2401-CND-91022'").get().score;
  assert.equal(JSON.parse(scored).mode, 'ai');
  assert(!scored.includes('workspace-key'));
  assert(!scored.includes('apiKey'));
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer synthetic-groq-workspace-key');
  assert.equal(await runtime.providerReady(await runtime.sessionUser({
    headers: {
      cookie
    }
  })), true);
  assert.equal((await request('/../dashboard', {
    cookie
  })).status, 200);
  const other = await request('/auth/signup', {
    method: 'POST',
    body: {
      name: 'Other Recruiter',
      email: 'key-isolation@fixture.test',
      password: 'IsolatedPassword123!',
      workspaceName: 'Separate workspace'
    }
  });
  assert.equal(other.status, 201);
  assert.equal((await request('/settings/ai', {
    cookie: other.cookie
  })).data.enabled, false);
  assert.equal((await request('/../dashboard', {
    cookie: other.cookie
  })).headers.get('location'), '/setup/provider');
  assert.equal((await request('/settings/ai', {
    cookie,
    method: 'PUT',
    body: {
      provider: 'openai',
      apiKey: 'invalid-fixture-key'
    }
  })).status, 502);
  assert.equal((await request('/settings/ai', {
    cookie
  })).data.selection.provider, 'groq');
  assert.equal(await (await createCredentials(runtime.db, directory)).get('demo', 'openai'), 'synthetic-openai-workspace-key');
  assert.equal((await request('/settings/ai', {
    cookie: client,
    method: 'PUT',
    body: {
      provider: 'openai',
      apiKey: 'synthetic-client-key'
    }
  })).status, 403);
});
test('services: authentication rate limit blocks repeated failed login attempts', async t => {
  const {
    request
  } = await fixture(t);
  for (let i = 0; i < 30; i++) assert.equal((await request('/auth/login', {
    method: 'POST',
    body: {
      email: 'missing@fixture.test',
      password: 'incorrect'
    }
  })).status, 401);
  const blocked = await request('/auth/login', {
    method: 'POST',
    body: {
      email: 'missing@fixture.test',
      password: 'incorrect'
    }
  });
  assert.equal(blocked.status, 429);
  assert(Number(blocked.headers.get('retry-after')) > 0);
});
test('services: a failed parsing item can be retried after its recoverable file problem is repaired', async t => {
  const {
      runtime,
      request,
      login,
      drain
    } = await fixture(t),
    cookie = await login('recruiter@company-a.test'),
    body = new FormData();
  body.append('cvs', new Blob(['broken PDF']), 'recoverable.pdf');
  const uploaded = await request('/jobs/REQ-2401/upload', {
    cookie,
    method: 'POST',
    body,
    headers: {
      'x-consent-source': 'Synthetic retry consent',
      'x-consent-granted': 'true'
    }
  });
  assert.equal(uploaded.status, 202);
  await drain();
  const item = runtime.db.prepare('SELECT * FROM batch_items WHERE batch_id=?').get(uploaded.data.id);
  assert.equal(item.status, 'failed');
  await writeFile(item.file_path, makePdf('Name: Parsing Recovery Person\nCurrent role: Java Developer\nExperience: 6 years\nSkills: Java, Spring Boot\nNotice: 30 days'));
  assert.equal((await request(`/batch-items/${item.id}/retry`, {
    cookie,
    method: 'POST',
    body: {}
  })).status, 200);
  await drain();
  const done = runtime.db.prepare('SELECT * FROM batch_items WHERE id=?').get(item.id);
  assert.equal(done.status, 'done');
  assert.equal(done.error, null);
  assert(runtime.db.prepare('SELECT score FROM applications WHERE candidate_id=?').get(done.candidate_id).score);
  assert.equal((await request(`/batch-items/${item.id}/retry`, {
    cookie,
    method: 'POST',
    body: {}
  })).status, 404);
});
test('services: oversized file and aggregate batch rejection leave no orphan files or queued work', async t => {
  const {
      directory,
      runtime,
      request,
      login
    } = await fixture(t),
    cookie = await login('recruiter@company-a.test');
  const before = await readdir(path.join(directory, 'uploads')),
    batches = runtime.db.prepare('SELECT COUNT(*) n FROM batches').get().n;
  for (const [count, size, expected] of [[1, 8 * 1024 * 1024 + 1, 400], [13, 8 * 1024 * 1024 - 1024, 413]]) {
    const data = new Blob([Buffer.alloc(size, 32)]),
      body = new FormData();
    for (let i = 0; i < count; i++) body.append('cvs', data, `oversized-${i}.pdf`);
    const result = await request('/jobs/REQ-2401/upload', {
      cookie,
      method: 'POST',
      body,
      headers: {
        'x-consent-source': 'Synthetic size limit test',
        'x-consent-granted': 'true'
      }
    });
    assert.equal(result.status, expected, JSON.stringify(result.data));
    assert.deepEqual(await readdir(path.join(directory, 'uploads')), before);
    assert.equal(runtime.db.prepare('SELECT COUNT(*) n FROM batches').get().n, batches);
  }
});
test('assessment: repeated submissions preserve decisions and edited scorecards need renewed approval', async t => {
  const {
      runtime,
      request,
      login,
      drain
    } = await fixture(t),
    recruiter = await login('recruiter@company-a.test'),
    client = await login('client@northstar.test');
  const first = 'APP-REQ-2401-CND-91022',
    second = 'APP-REQ-2401-CND-91088';
  await t.test('resubmitting an existing candidate is idempotent and cannot undo a joined hire', async () => {
    assert.equal((await request(`/applications/${first}/cv`, {
      cookie: recruiter
    })).status, 200);
    assert.equal((await request(`/applications/${first}/submit`, {
      cookie: recruiter,
      method: 'POST',
      body: {}
    })).status, 200);
    assert.equal((await request(`/applications/${first}/stage`, {
      cookie: recruiter,
      method: 'PATCH',
      body: {
        stage: 'Joined'
      }
    })).status, 200);
    assert.equal((await request(`/applications/${first}/submit`, {
      cookie: recruiter,
      method: 'POST',
      body: {}
    })).status, 200);
    assert.equal((await request(`/applications/${first}`, {
      cookie: client
    })).data.stage, 'Joined');
  });
  await t.test('a refreshed AI score alone cannot authorize decisions after scorecard changes', async () => {
    await request(`/applications/${second}/cv`, {
      cookie: recruiter
    });
    await request(`/applications/${second}/submit`, {
      cookie: recruiter,
      method: 'POST',
      body: {}
    });
    const job = (await request('/jobs', {
      cookie: recruiter
    })).data.find(j => j.id === 'REQ-2401');
    assert.equal((await request('/jobs/REQ-2401/scorecard', {
      cookie: recruiter,
      method: 'PUT',
      body: {
        title: job.title,
        clientId: job.client_id,
        location: job.location,
        jd: job.jd,
        criteria: job.criteria,
        version: job.version
      }
    })).status, 200);
    await drain();
    assert.equal((await request(`/applications/${second}/decision`, {
      cookie: client,
      method: 'POST',
      body: {
        action: 'shortlist'
      }
    })).status, 409);
    assert.equal((await request(`/applications/${second}`, {
      cookie: client
    })).data.submissionStale, true);
    assert.equal((await request(`/applications/${second}/submit`, {
      cookie: recruiter,
      method: 'POST',
      body: {}
    })).status, 409);
    await request(`/applications/${second}/cv`, {
      cookie: recruiter
    });
    assert.equal((await request(`/applications/${second}/submit`, {
      cookie: recruiter,
      method: 'POST',
      body: {}
    })).status, 200);
    assert.equal((await request(`/applications/${second}/decision`, {
      cookie: client,
      method: 'POST',
      body: {
        action: 'shortlist'
      }
    })).status, 200);
    assert.equal((await request(`/applications/${second}`, {
      cookie: client
    })).data.submissionStale, false);
    assert(runtime.db.prepare("SELECT COUNT(*) n FROM audit WHERE action='cv.opened'").get().n >= 3);
  });
});
test('assessment: 500 distinct mixed PDF/DOCX CVs parse, deduplicate and score without automatic decisions', async t => {
  const {
      directory,
      runtime,
      request,
      login,
      drain
    } = await fixture(t),
    recruiter = await login('recruiter@company-a.test');
  const body = new FormData();
  const cv = i => [`Name: Test Person ${i}`, `person${i}@cv-fixture.test`, i % 3 === 0 ? 'Current role: Java Developer' : 'Current role: Senior Java Developer', `Total experience: ${i === 0 ? 0 : 4 + i % 5} years`, i % 3 === 1 ? 'Key skills: Java, Hibernate, REST APIs' : 'Key skills: Java, Spring Boot, microservices', `Notice period: ${[0, 30, 60, 90][i % 4]} days`, `Current CTC: ${10 + i % 20} LPA`, 'Location: Noida', 'Gender: Female | Marital status: Single | Age: 28', `Project: Built REST APIs for portfolio project ${i}`].join(i % 3 === 2 ? '\r\n' : '\n');
  for (let i = 0; i < 500; i++) {
    const docx = i % 2 === 1;
    body.append('cvs', new Blob([docx ? await makeDocx(cv(i), i % 4 === 1) : makePdf(cv(i))]), `candidate-${i}.${docx ? 'docx' : 'pdf'}`);
  }
  const response = await request('/jobs/REQ-2401/upload', {
    cookie: recruiter,
    method: 'POST',
    body,
    headers: {
      'x-consent-granted': 'true',
      'x-consent-source': 'Synthetic 500-format regression fixture',
      'x-ai-consent': 'false'
    }
  });
  assert.equal(response.status, 202);
  await drain();
  const batch = (await request('/jobs/REQ-2401/batches', {
    cookie: recruiter
  })).data.find(b => b.id === response.data.id);
  assert.equal(batch.items.length, 500);
  assert(batch.items.every(i => i.status === 'done'), JSON.stringify(batch.items.filter(i => i.status !== 'done').slice(0, 3)));
  const ids = batch.items.map(i => i.candidate_id);
  assert.equal(new Set(ids).size, 500);
  const rows = (await collectPages(async offset=>(await request(`/jobs/REQ-2401/candidates?offset=${offset}`,{cookie:recruiter})).data,100)).filter(r=>ids.includes(r.candidateId));
  assert.equal(rows.length, 500);
  assert(rows.every(r => r.score && r.stage === 'Sourced' && !r.submittedAt));
  assert(rows.some(r => r.score.total < 45));
  const zero = rows.find(r => r.name === 'Test Person 0');
  assert.equal(zero.profile.experience, 0);
  assert.equal(Number(zero.profile.notice), 0);
  for (const row of rows.slice(0, 5)) {
    const detail = (await request(`/applications/${row.id}`, {
      cookie: recruiter
    })).data;
    assert(!JSON.stringify(detail.lines).match(/@|Gender|Marital|Age:|Test Person/i));
    for (const criterion of detail.score.criteria) for (const e of criterion.evidence) assert(detail.lines.some(l => l.line === e.line && l.quote.includes(e.quote)));
  }
  const duplicate = new FormData();
  duplicate.append('cvs', new Blob([await makeDocx(cv(0), true)]), 'same-candidate.docx');
  assert.equal((await request('/jobs/REQ-2401/upload', {
    cookie: recruiter,
    method: 'POST',
    body: duplicate,
    headers: {
      'x-consent-granted': 'true',
      'x-consent-source': 'Duplicate test consent'
    }
  })).status, 202);
  await drain();
  assert.equal(runtime.db.prepare('SELECT COUNT(*) n FROM candidates').get().n, 503);
  assert.equal(runtime.db.prepare("SELECT COUNT(*) n FROM batch_items WHERE status='duplicate'").get().n, 1);
  const invalid = new FormData();
  invalid.append('cvs', new Blob(['Not a PDF document']), 'corrupt.pdf');
  invalid.append('cvs', new Blob(['PK Not a real Word ZIP']), 'corrupt.docx');
  assert.equal((await request('/jobs/REQ-2401/upload', {
    cookie: recruiter,
    method: 'POST',
    body: invalid,
    headers: {
      'x-consent-granted': 'true',
      'x-consent-source': 'Corrupt file regression fixture'
    }
  })).status, 202);
  await drain();
  assert.equal(runtime.db.prepare("SELECT COUNT(*) n FROM batch_items WHERE status='failed'").get().n, 2);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) n FROM candidates').get().n, 503);
  assert((await readdir(path.join(directory, 'uploads'))).length >= 500);
});
test('assessment: identical CVs in different workspaces remain private and processing does not block other teams', async t => {
  const {
      runtime,
      request,
      login,
      drain
    } = await fixture(t),
    recruiter = await login('recruiter@company-a.test');
  const signup = await request('/auth/signup', {
    method: 'POST',
    body: {
      name: 'Isolated Recruiter',
      email: 'isolated@team.test',
      password: 'IsolationPassword123!',
      workspaceName: 'Isolated Team'
    }
  });
  assert.equal(signup.status, 201);
  const other = signup.cookie;
  const client = (await request('/clients', {
    cookie: other
  })).data[0];
  const criteria = JSON.parse(runtime.db.prepare("SELECT criteria FROM jobs WHERE id='REQ-2401'").get().criteria);
  const created = await request('/jobs', {
    cookie: other,
    method: 'POST',
    body: {
      title: 'Senior Java Developer',
      clientId: client.id,
      location: 'Noida',
      jd: 'Senior Java Developer, 5-8 years, Spring Boot, Noida, notice up to 60 days',
      criteria
    }
  });
  assert.equal(created.status, 201);
  const form = new FormData();
  form.append('cvs', new Blob([makePdf(sampleText(samples[0]))]), 'private-copy.pdf');
  const uploaded = await request(`/jobs/${created.data.id}/upload`, {
    cookie: other,
    method: 'POST',
    body: form,
    headers: {
      'x-consent-source': 'Isolated workspace consent',
      'x-consent-granted': 'true'
    }
  });
  assert.equal(uploaded.status, 202);
  assert.equal((await request('/settings/ai', {
    cookie: recruiter,
    method: 'PUT',
    body: {
      provider: 'groq'
    }
  })).status, 200);
  await drain();
  const item = (await request(`/jobs/${created.data.id}/batches`, {
    cookie: other
  })).data[0].items[0];
  assert.equal(item.status, 'done');
  assert.notEqual(item.candidate_id, 'CND-91022');
  const row = (await request(`/jobs/${created.data.id}/candidates`, {
    cookie: other
  })).data[0];
  assert.equal(row.name, 'Ritika Bansal');
  for (const route of [`/jobs/${created.data.id}/candidates`, `/jobs/${created.data.id}/batches`, `/applications/${row.id}`, `/applications/${row.id}/cv`, `/batch-items/${item.id}/cv`, `/batch-items/${item.id}/review`]) assert.equal((await request(route, {
    cookie: recruiter
  })).status, 404, route);
  assert.equal((await request(`/candidates/${item.candidate_id}`, {
    cookie: recruiter,
    method: 'DELETE',
    body: {
      confirmation: item.candidate_id
    }
  })).status, 404);
  assert.equal((await request('/privacy', {
    cookie: other
  })).data.candidates.length, 1);
  assert(!(await request('/privacy', {
    cookie: recruiter
  })).data.candidates.some(c => c.id === item.candidate_id));
  runtime.db.prepare("UPDATE batch_items SET status='processing' WHERE id=?").run(item.id);
  assert.equal((await request('/candidates/CND-91047', {
    cookie: recruiter,
    method: 'DELETE',
    body: {
      confirmation: 'CND-91047'
    }
  })).status, 200);
  runtime.db.prepare("UPDATE batch_items SET status='done' WHERE id=?").run(item.id);
  assert.equal((await request(`/candidates/${item.candidate_id}`, {
    cookie: other,
    method: 'DELETE',
    body: {
      confirmation: item.candidate_id
    }
  })).status, 200);
  assert.equal((await request('/privacy', {
    cookie: other
  })).data.candidates.length, 0);
  assert(runtime.db.prepare("SELECT id FROM candidates WHERE id='CND-91022'").get());
});
test('assessment: AI-backed intake, parsing and scoring enforce consent, evidence and recoverable failures', async t => {
  const {
      runtime,
      request,
      login,
      drain
    } = await fixture(t),
    recruiter = await login('recruiter@company-a.test');
  const originalFetch = globalThis.fetch,
    calls = [];
  let invalidEvidence = true;
  process.env.OPENAI_API_KEY = 'synthetic-test-key';
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options);
    assert.equal(String(url), 'https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(options.body),
      instruction = body.messages[0].content,
      data = JSON.parse(body.messages[1].content);
    calls.push({
      instruction,
      data
    });
    let result;
    if (instruction.startsWith('Extract {"criteria"')) result = {
      criteria: JSON.parse(runtime.db.prepare("SELECT criteria FROM jobs WHERE id='REQ-2401'").get().criteria)
    };else if (instruction.startsWith('Extract only explicit')) result = {
      role: 'Senior Java Developer',
      experience: 6,
      notice: 30,
      ctc: null,
      skills: ['Java', 'Spring Boot', 'microservices']
    };else {
      result = {
        criteria: demoScore(data.criteria, data.lines).criteria
      };
      if (invalidEvidence) result.criteria[0] = {
        ...result.criteria[0],
        status: 'met',
        evidence: [{
          line: 1,
          quote: 'Invented experience that is absent from the CV'
        }]
      };
    }
    return Response.json({
      choices: [{
        message: {
          content: JSON.stringify(result)
        }
      }]
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  assert.equal((await request('/settings/ai', {
    cookie: recruiter,
    method: 'PUT',
    body: {
      provider: 'openai'
    }
  })).status, 200);
  const extraction = await request('/scorecard/extract', {
    cookie: recruiter,
    method: 'POST',
    body: {
      jd: 'Senior Java Developer, 5-8 years, Java and Spring Boot, Noida, notice up to 60 days'
    }
  });
  assert.equal(extraction.status, 200);
  assert.equal(extraction.data.mode, 'ai');
  const text = 'Name: Synthetic Private Person\nprivate-person@fixture.test\nCurrent role: Senior Java Developer\nTotal experience: 6 years\nKey skills: Java, Spring Boot, microservices\nNotice period: 30 days\nLocation: Noida\nGender: Female\nMarital status: Single\nAge: 28';
  const form = new FormData();
  form.append('cvs', new Blob([await makeDocx(text, true)]), 'ai-fixture.docx');
  const batch = await request('/jobs/REQ-2401/upload', {
    cookie: recruiter,
    method: 'POST',
    body: form,
    headers: {
      'x-consent-source': 'Explicit synthetic AI consent',
      'x-consent-granted': 'true',
      'x-ai-consent': 'true',
      'x-ai-provider': 'openai'
    }
  });
  assert.equal(batch.status, 202);
  await drain();
  const candidateId = runtime.db.prepare('SELECT candidate_id FROM batch_items WHERE batch_id=?').get(batch.data.id).candidate_id;
  const app = runtime.db.prepare('SELECT * FROM applications WHERE candidate_id=?').get(candidateId);
  assert.match(app.score_error, /evidence could not be verified/);
  assert.equal(app.stage, 'Sourced');
  await request(`/applications/${app.id}/cv`, {
    cookie: recruiter
  });
  assert.equal((await request(`/applications/${app.id}/submit`, {
    cookie: recruiter,
    method: 'POST',
    body: {}
  })).status, 409);
  invalidEvidence = false;
  assert.equal((await request(`/applications/${app.id}/retry`, {
    cookie: recruiter,
    method: 'POST',
    body: {}
  })).status, 200);
  await drain();
  const detail = (await request(`/applications/${app.id}`, {
    cookie: recruiter
  })).data;
  assert.equal(detail.score.mode, 'ai');
  assert.equal(detail.score.provider, 'openai');
  assert.equal(detail.scoreError, null);
  assert(detail.score.total >= 75);
  assert.equal((await request(`/applications/${app.id}/submit`, {
    cookie: recruiter,
    method: 'POST',
    body: {}
  })).status, 200);
  assert(calls.some(c => c.instruction.startsWith('Extract only explicit')));
  assert(calls.some(c => c.instruction.startsWith('Evaluate each criterion')));
  for (const call of calls.filter(c => c.data.lines)) assert(!JSON.stringify(call.data).match(/Private Person|private-person@|Gender|Marital|Age:/i));
  const before = calls.length,
    withoutConsent = new FormData();
  withoutConsent.append('cvs', new Blob([makePdf(text.replaceAll('Private Person', 'Other Person').replaceAll('private-person@', 'other-person@'))]), 'without-ai-consent.pdf');
  const denied = await request('/jobs/REQ-2401/upload', {
    cookie: recruiter,
    method: 'POST',
    body: withoutConsent,
    headers: {
      'x-consent-source': 'Hiring use only, no AI permission',
      'x-consent-granted': 'true',
      'x-ai-consent': 'false'
    }
  });
  assert.equal(denied.status, 202);
  await drain();
  assert.equal(calls.length, before);
  const blocked = runtime.db.prepare('SELECT a.* FROM applications a JOIN batch_items i ON i.candidate_id=a.candidate_id WHERE i.batch_id=?').get(denied.data.id);
  assert.match(blocked.score_error, /Consent for openai/);
  assert.equal(blocked.stage, 'Sourced');
  assert.equal((await request(`/candidates/${blocked.candidate_id}/consent`, {
    cookie: recruiter,
    method: 'PUT',
    body: {
      source: 'Explicit opt-in for OpenAI processing',
      aiProcessing: true,
      aiProvider: 'openai'
    }
  })).status, 200);
  await request(`/applications/${blocked.id}/retry`, {
    cookie: recruiter,
    method: 'POST',
    body: {}
  });
  await drain();
  assert.equal(runtime.db.prepare('SELECT score_error FROM applications WHERE id=?').get(blocked.id).score_error, null);
});
test('assessment: interrupted parsing resumes after a database reopen', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'shortlist-restart-'));
  let runtime = await createApp({
      directory,
      demo: true
    }),
    server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try {
    await runtime.worker.stop();
    const base = `http://127.0.0.1:${server.address().port}/api`,
      login = await fetch(base + '/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: 'recruiter@company-a.test',
          password: 'Demo@12345'
        })
      }),
      cookie = login.headers.get('set-cookie').split(';')[0];
    const text = 'Name: Recovery Fixture\nCurrent role: Java Developer\nExperience: 6 years\nSkills: Java, Spring Boot\nNotice: 30 days\nLocation: Noida',
      body = new FormData();
    body.append('cvs', new Blob([makePdf(text)]), 'recover.pdf');
    const response = await fetch(base + '/jobs/REQ-2401/upload', {
      method: 'POST',
      headers: {
        cookie,
        'x-consent-source': 'Synthetic recovery consent',
        'x-consent-granted': 'true'
      },
      body
    });
    assert.equal(response.status, 202);
    runtime.db.prepare("UPDATE batch_items SET status='processing'").run();
    await new Promise(r => server.close(r));
    await runtime.close();
    runtime = await createApp({
      directory,
      demo: true
    });
    assert.equal(runtime.db.prepare('SELECT status FROM batch_items').get().status, 'pending');
    await runtime.worker.tick();
    await runtime.worker.tick();
    const item = runtime.db.prepare('SELECT * FROM batch_items').get();
    assert.equal(item.status, 'done');
    assert(runtime.db.prepare('SELECT score FROM applications WHERE candidate_id=?').get(item.candidate_id).score);
    assert.equal(runtime.db.prepare('SELECT COUNT(*) n FROM users').get().n, 3);
  } finally {
    if (server.listening) await new Promise(r => server.close(r));
    await runtime.close();
    await rm(directory, {
      recursive: true,
      force: true
    });
  }
});
test('assessment: duplicate scans cannot bypass transcript verification, including another requisition', async t => {
  const {
      runtime,
      request,
      login,
      drain
    } = await fixture(t),
    cookie = await login('recruiter@company-a.test');
  async function uploadScan(job) {
    const body = new FormData();
    body.append('cvs', new Blob([makePdf(' ')]), 'scan.pdf');
    const r = await request(`/jobs/${job}/upload`, {
      cookie,
      method: 'POST',
      body,
      headers: {
        'x-consent-source': 'Synthetic scan consent',
        'x-consent-granted': 'true'
      }
    });
    assert.equal(r.status, 202);
    await drain();
    return runtime.db.prepare('SELECT * FROM batch_items WHERE batch_id=?').get(r.data.id);
  }
  const first = await uploadScan('REQ-2401'),
    second = await uploadScan('REQ-2401'),
    third = await uploadScan('REQ-2403');
  assert.equal(first.status, 'needs_review');
  assert.equal(second.status, 'needs_review');
  assert.equal(third.status, 'needs_review');
  assert.equal(first.candidate_id, second.candidate_id);
  assert.equal(first.candidate_id, third.candidate_id);
  assert.equal(runtime.db.prepare('SELECT COUNT(*) n FROM applications WHERE candidate_id=?').get(first.candidate_id).n, 0);
  for (const item of [first, second, third]) assert.equal((await request(`/batch-items/${item.id}/cv`, {
    cookie
  })).status, 200);
  const text = 'Name: Reviewed Scan Person\nreviewed-scan@fixture.test\nCurrent role: Java Developer\nTotal experience: 6 years\nKey skills: Java, Spring Boot\nNotice period: 30 days\nLocation: Noida';
  const verified = await request(`/batch-items/${second.id}/transcript`, {
    cookie,
    method: 'POST',
    body: {
      text
    }
  });
  assert.equal(verified.status, 200);
  await drain();
  const candidate = runtime.db.prepare('SELECT * FROM candidates WHERE id=?').get(first.candidate_id);
  assert.equal(candidate.name, 'Reviewed Scan Person');
  assert.equal(candidate.email, 'reviewed-scan@fixture.test');
  assert(runtime.db.prepare('SELECT * FROM batch_items WHERE candidate_id=?').all(first.candidate_id).every(i => i.status === 'done'));
  const apps = runtime.db.prepare('SELECT * FROM applications WHERE candidate_id=?').all(first.candidate_id);
  assert.equal(apps.length, 2);
  assert(apps.every(a => a.score && a.stage === 'Sourced'));
  assert.equal((await request(`/batch-items/${first.id}/transcript`, {
    cookie,
    method: 'POST',
    body: {
      text
    }
  })).status, 404);
});
test('assessment: pipeline advancement requires renewed submission after scorecard edits', async t => {
  const {
      request,
      login,
      drain
    } = await fixture(t),
    cookie = await login('recruiter@company-a.test'),
    id = 'APP-REQ-2401-CND-91022';
  await request(`/applications/${id}/cv`, {
    cookie
  });
  await request(`/applications/${id}/submit`, {
    cookie,
    method: 'POST',
    body: {}
  });
  const job = (await request('/jobs', {
    cookie
  })).data.find(j => j.id === 'REQ-2401');
  await request('/jobs/REQ-2401/scorecard', {
    cookie,
    method: 'PUT',
    body: {
      title: job.title,
      clientId: job.client_id,
      location: job.location,
      jd: job.jd,
      criteria: job.criteria,
      version: job.version
    }
  });
  await drain();
  for (const stage of ['Shortlisted', 'Interview', 'Offered', 'Joined']) assert.equal((await request(`/applications/${id}/stage`, {
    cookie,
    method: 'PATCH',
    body: {
      stage
    }
  })).status, 409, stage);
  await request(`/applications/${id}/cv`, {
    cookie
  });
  await request(`/applications/${id}/submit`, {
    cookie,
    method: 'POST',
    body: {}
  });
  assert.equal((await request(`/applications/${id}/stage`, {
    cookie,
    method: 'PATCH',
    body: {
      stage: 'Joined'
    }
  })).status, 200);
});
