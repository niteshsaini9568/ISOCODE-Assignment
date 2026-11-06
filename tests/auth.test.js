import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
test('accounts, invitations, workspace isolation, reset and Google callback security', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'shortlist-auth-'));
  const envNames = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APP_URL'];
  const previous = Object.fromEntries(envNames.map(k => [k, process.env[k]]));
  for (const k of envNames) delete process.env[k];
  let identity;
  const runtime = await createApp({
    directory,
    demo: true,
    verifyGoogleToken: async () => identity
  });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const realFetch = globalThis.fetch;
  async function request(route, {
    cookie,
    body,
    method = 'GET'
  } = {}) {
    const res = await realFetch(base + '/api' + route, {
      method,
      redirect: 'manual',
      headers: {
        ...(cookie ? {
          cookie
        } : {}),
        ...(body ? {
          'Content-Type': 'application/json'
        } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return {
      status: res.status,
      data,
      headers: res.headers,
      cookie: res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    };
  }
  let owner, other, client, invite;
  const signup = (email, extra = {}) => request('/auth/signup', {
    method: 'POST',
    body: {
      name: 'New Recruiter',
      email,
      password: 'StrongPassword123!',
      workspaceName: 'Private Team',
      ...extra
    }
  });
  try {
    await t.test('signup cannot inject roles and creates a private empty workspace', async () => {
      assert.equal((await signup('owner@example.test', {
        role: 'client'
      })).status, 400);
      assert.equal((await signup('owner@example.test', {
        password: 'short'
      })).status, 400);
      owner = await signup('owner@example.test');
      other = await signup('other@example.test');
      assert.equal(owner.status, 201);
      assert.equal(owner.data.role, 'recruiter');
      assert.notEqual(owner.data.workspace_id, other.data.workspace_id);
      assert.deepEqual((await request('/jobs', {
        cookie: owner.cookie
      })).data, []);
      assert.deepEqual((await request('/privacy', {
        cookie: owner.cookie
      })).data.candidates, []);
      assert.equal((await request('/jobs/REQ-2401/candidates', {
        cookie: owner.cookie
      })).status, 404);
      assert.equal((await request('/candidates/CND-91022/consent', {
        cookie: owner.cookie,
        method: 'PUT',
        body: {
          source: 'Consent test',
          aiProcessing: false
        }
      })).status, 404);
      assert.equal((await signup('owner@example.test')).status, 409);
      assert.equal((await request('/auth/me', {
        cookie: 'shortlist_session=fake'
      })).status, 401);
    });
    await t.test('client grants are scoped, email bound and single use', async () => {
      const clients = (await request('/clients', {
        cookie: owner.cookie
      })).data;
      assert.equal(clients.length, 1);
      assert.equal((await request('/invitations', {
        cookie: other.cookie,
        method: 'POST',
        body: {
          email: 'client@example.test',
          clientId: clients[0].id
        }
      })).status, 404);
      const created = await request('/invitations', {
        cookie: owner.cookie,
        method: 'POST',
        body: {
          email: 'client@example.test',
          clientId: clients[0].id
        }
      });
      assert.equal(created.status, 201);
      invite = new URL(created.data.url).searchParams.get('invite');
      assert.equal((await request('/auth/invitation?token=' + invite)).data.client, clients[0].name);
      assert.equal((await signup('wrong@example.test', {
        invite
      })).status, 400);
      client = await signup('client@example.test', {
        invite
      });
      assert.equal(client.status, 201);
      assert.equal(client.data.role, 'client');
      assert.equal(client.data.workspace_id, owner.data.workspace_id);
      assert.equal(client.data.client_id, clients[0].id);
      assert.equal((await request('/auth/invitation?token=' + invite)).status, 400);
      assert.equal((await request('/clients', {
        cookie: client.cookie,
        method: 'POST',
        body: {
          name: 'Forbidden'
        }
      })).status, 403);
      assert.equal((await request('/settings/ai', {
        cookie: client.cookie
      })).status, 403);
      assert.equal((await request('/settings/ai', {
        cookie: owner.cookie,
        method: 'PUT',
        body: {
          provider: 'groq'
        }
      })).status, 200);
      assert.equal((await request('/settings/ai', {
        cookie: other.cookie
      })).data.selection.provider, 'gemini');
    });
    await t.test('password reset revokes sessions and cannot be replayed', async () => {
      const result = await request('/auth/forgot-password', {
        method: 'POST',
        body: {
          email: 'owner@example.test'
        }
      });
      const token = new URL(result.data.demoResetUrl, base).searchParams.get('token');
      assert.notEqual(runtime.db.prepare('SELECT token FROM reset_tokens').get().token, token);
      assert.equal((await request('/auth/reset-password', {
        method: 'POST',
        body: {
          token,
          password: 'ReplacementPassword456!'
        }
      })).status, 200);
      assert.equal((await request('/auth/me', {
        cookie: owner.cookie
      })).status, 401);
      assert.equal((await request('/auth/reset-password', {
        method: 'POST',
        body: {
          token,
          password: 'ReplacementPassword456!'
        }
      })).status, 400);
      assert.equal((await request('/auth/login', {
        method: 'POST',
        body: {
          email: 'owner@example.test',
          password: 'StrongPassword123!'
        }
      })).status, 401);
      assert.equal((await request('/auth/login', {
        method: 'POST',
        body: {
          email: 'owner@example.test',
          password: 'ReplacementPassword456!'
        }
      })).status, 200);
    });
    await t.test('Google uses PKCE, browser-bound state, verified identity and replay protection', async () => {
      assert.equal((await request('/auth/google')).headers.get('location'), '/login?error=google_not_configured');
      process.env.GOOGLE_CLIENT_ID = 'test-client';
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
      process.env.APP_URL = base;
      const start = await request('/auth/google'),
        url = new URL(start.headers.get('location')),
        state = url.searchParams.get('state');
      assert.equal(url.origin, 'https://accounts.google.com');
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(url.searchParams.get('redirect_uri'), base + '/api/auth/google/callback');
      assert.equal((await request('/auth/google/callback?state=' + state + '&code=test')).status, 400);
      identity = {
        sub: 'google-subject-1',
        email: 'google@example.test',
        name: 'Google User',
        email_verified: true,
        iss: 'https://accounts.google.com',
        nonce: url.searchParams.get('nonce')
      };
      globalThis.fetch = async (input, options) => {
        assert.equal(String(input), 'https://oauth2.googleapis.com/token');
        assert(options.body.get('code_verifier'));
        return new Response(JSON.stringify({
          id_token: 'mock-verified-token'
        }), {
          status: 200
        });
      };
      const callback = await request('/auth/google/callback?state=' + state + '&code=test', {
        cookie: start.cookie
      });
      assert.equal(callback.headers.get('location'), '/setup/provider');
      assert.equal((await request('/auth/me', {
        cookie: callback.cookie
      })).data.email, 'google@example.test');
      assert.equal((await request('/auth/google/callback?state=' + state + '&code=test', {
        cookie: start.cookie
      })).status, 400);
      const collision = await request('/auth/google'),
        collisionUrl = new URL(collision.headers.get('location'));
      identity = {
        ...identity,
        sub: 'another-subject',
        email: 'owner@example.test',
        nonce: collisionUrl.searchParams.get('nonce')
      };
      assert.equal((await request('/auth/google/callback?state=' + collisionUrl.searchParams.get('state') + '&code=test', {
        cookie: collision.cookie
      })).headers.get('location'), '/login?error=google_failed');
      assert.equal(runtime.db.prepare('SELECT COUNT(*) n FROM google_identities').get().n, 1);
    });
  } finally {
    globalThis.fetch = realFetch;
    await new Promise(r => server.close(r));
    await runtime.close();
    await rm(directory, {
      recursive: true,
      force: true
    });
    for (const k of envNames) if (previous[k] === undefined) delete process.env[k];else process.env[k] = previous[k];
  }
});
