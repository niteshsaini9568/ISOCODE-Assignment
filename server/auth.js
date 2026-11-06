import express from 'express';
import rateLimit from 'express-rate-limit';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { hash, now, fail, passwordHash, passwordMatches } from './domain.js';
import { rateStore } from './rate-store.js';
import { mailConfigured,sendPasswordReset } from './mail.js';
export const appOrigin = () => new URL(process.env.APP_URL || 'http://127.0.0.1:5173').origin;
export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const cookie = (req, name) => req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith(`${name}=`))?.slice(name.length + 1);
export async function sessionUser(db, req) {
  const token = cookie(req, 'shortlist_session');
  return token ? await db.prepare('SELECT u.id,u.name,u.email,u.role,u.client_id,u.workspace_id,w.name AS workspace_name FROM sessions s JOIN users u ON u.id=s.user_id JOIN workspaces w ON w.id=u.workspace_id WHERE s.token=? AND s.expires>?').get(hash(token), now()) : null;
}
const publicUser = u => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  workspace_id: u.workspace_id,
  client_id: u.client_id
});
export function createAuth(db, audit, {
  demo = false,
  verifyGoogleToken
} = {}) {
  const router = express.Router(),
    secure = () => appOrigin().startsWith('https:');
  const wrap = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res,next)).catch(next);
  const read = (schema, value) => {
    const r = schema.safeParse(value);
    if (!r.success) fail(400, r.error.issues.map(i => i.message).join('; '));
    return r.data;
  };
  const email = z.string().trim().toLowerCase().email().max(150);
  const password = z.string().min(12, 'Use at least 12 characters').max(128);
  const issueSession = async (res, user) => {
    const token = randomBytes(32).toString('hex');
    await db.prepare('DELETE FROM sessions WHERE expires<?').run(now());
    await db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token), user.id, new Date(Date.now() + 8 * 3600000).toISOString());
    res.cookie('shortlist_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secure(),
      maxAge: 8 * 3600000,
      path: '/'
    });
  };
  async function invitation(token) {
    const row = token && (await db.prepare('SELECT i.*,c.name AS client_name,w.name AS workspace_name FROM invitations i JOIN clients c ON c.id=i.client_id JOIN workspaces w ON w.id=i.workspace_id WHERE i.token=? AND i.used_at IS NULL AND i.expires>?').get(hash(token), now()));
    if (!row) fail(400, 'This invitation is invalid or expired');
    return row;
  }
  async function provision({
    name,
    email,
    password: encoded,
    workspaceName,
    invite
  }) {
    if(db.lock)await db.lock(invite?`invitation:${hash(invite)}`:`signup:${email}`);
    if (await db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) fail(409, 'An account already exists. Sign in with your existing method.');
    const grant = invite ? await invitation(invite) : null;
    if (grant && grant.email !== email) fail(400, 'Use the email address this invitation was sent to');
    const id = randomUUID(),
      workspaceId = grant?.workspace_id || randomUUID();
    await db.exec('BEGIN');
    try {
      if (!grant) {
        await db.prepare('INSERT INTO workspaces VALUES(?,?,?)').run(workspaceId, workspaceName || `${name}'s workspace`, now());
        await db.prepare('INSERT INTO clients VALUES(?,?,?)').run(randomUUID(), workspaceId, 'My first client');
      }
      await db.prepare('INSERT INTO users(id,email,name,password,role,client_id,workspace_id) VALUES(?,?,?,?,?,?,?)').run(id, email, name, encoded, grant ? 'client' : 'recruiter', grant?.client_id || null, workspaceId);
      if (grant) await db.prepare('UPDATE invitations SET used_at=? WHERE token=?').run(now(), grant.token);
      await db.exec('COMMIT');
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
    return await db.prepare('SELECT * FROM users WHERE id=?').get(id);
  }
  const limiter = rateLimit({
    ...(db.kind==='postgres'?{store:rateStore(db)}:{}),
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false
  });
  router.post('/login', limiter, wrap(async (req, res) => {
    const b = read(z.object({
        email,
        password: z.string().min(1).max(128)
      }), req.body),
      user = await db.prepare('SELECT * FROM users WHERE email=?').get(b.email);
    if (!user || !passwordMatches(b.password, user.password)) fail(401, 'Email or password is incorrect');
    await issueSession(res, user);
    await audit(user.id, 'auth.login');
    res.json(publicUser(user));
  }));
  router.post('/signup', limiter, wrap(async (req, res) => {
    const b = read(z.object({
      name: z.string().trim().min(2).max(80),
      email,
      password,
      workspaceName: z.string().trim().min(2).max(100).optional(),
      invite: z.string().max(128).optional()
    }).strict(), req.body);
    const user = await provision({
      ...b,
      password: passwordHash(b.password)
    });
    await issueSession(res, user);
    await audit(user.id, 'auth.signup');
    res.status(201).json(publicUser(user));
  }));
  router.get('/me', wrap(async (req, res) => {
    const user = await sessionUser(db, req);
    if (!user) fail(401, 'Sign in to continue');
    res.json(user);
  }));
  router.post('/logout', wrap(async (req, res) => {
    const token = cookie(req, 'shortlist_session');
    if (token) await db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));
    res.clearCookie('shortlist_session', {
      path: '/'
    });
    res.json({
      ok: true
    });
  }));
  router.get('/invitation', wrap(async (req, res) => {
    const row = await invitation(read(z.string().min(20).max(128), req.query.token));
    res.json({
      email: row.email,
      client: row.client_name,
      workspace: row.workspace_name
    });
  }));
  router.post('/forgot-password', limiter, wrap(async (req, res) => {
    if (!demo&&!mailConfigured()) fail(503, 'Password recovery email is not configured. Contact your workspace administrator.');
    const b = read(z.object({
        email
      }), req.body),
      user = await db.prepare('SELECT * FROM users WHERE email=?').get(b.email);
    let demoResetUrl;
    if (user) {
      const token = randomBytes(32).toString('hex');
      await db.prepare('DELETE FROM reset_tokens WHERE user_id=? OR expires<?').run(user.id, now());
      await db.prepare('INSERT INTO reset_tokens VALUES(?,?,?)').run(hash(token), user.id, new Date(Date.now() + 30 * 60000).toISOString());
      if (demo) demoResetUrl = `/reset-password?token=${token}`;
      else await sendPasswordReset(user.email,`${appOrigin()}/reset-password?token=${token}`);
      await audit(user.id, 'auth.reset.requested');
    }
    res.json({
      message: 'If an account exists, a password reset has been requested.',
      ...(demoResetUrl ? {
        demoResetUrl
      } : {})
    });
  }));
  router.post('/reset-password', limiter, wrap(async (req, res) => {
    const b = read(z.object({
        token: z.string().min(20).max(128),
        password
      }), req.body);
    if(db.lock)await db.lock(`reset:${hash(b.token)}`);
    const grant = await db.prepare('SELECT * FROM reset_tokens WHERE token=? AND expires>?').get(hash(b.token), now());
    if (!grant) fail(400, 'This reset link is invalid or expired');
    await db.exec('BEGIN');
    try {
      await db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(b.password), grant.user_id);
      await db.prepare('DELETE FROM reset_tokens WHERE user_id=?').run(grant.user_id);
      await db.prepare('DELETE FROM sessions WHERE user_id=?').run(grant.user_id);
      await db.exec('COMMIT');
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
    res.clearCookie('shortlist_session', {
      path: '/'
    });
    await audit(grant.user_id, 'auth.password.reset');
    res.json({
      ok: true
    });
  }));
  router.get('/google', limiter, wrap(async (req, res) => {
    if (!googleConfigured()) return res.redirect('/login?error=google_not_configured');
    if (req.query.invite) await invitation(read(z.string().max(128), req.query.invite));
    const state = randomBytes(32).toString('hex'),
      browser = randomBytes(32).toString('hex'),
      verifier = randomBytes(48).toString('base64url'),
      nonce = randomBytes(32).toString('hex');
    await db.prepare('DELETE FROM oauth_requests WHERE expires<?').run(now());
    await db.prepare('INSERT INTO oauth_requests VALUES(?,?,?,?,?,?)').run(hash(state), hash(browser), verifier, nonce, req.query.invite || null, new Date(Date.now() + 10 * 60000).toISOString());
    res.cookie('shortlist_oauth', browser, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secure(),
      maxAge: 10 * 60000,
      path: '/api/auth/google'
    });
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: `${appOrigin()}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account'
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }));
  router.get('/google/callback', limiter, wrap(async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '',
      browser = cookie(req, 'shortlist_oauth');
    if(db.lock)await db.lock(`oauth:${hash(state)}`);
    const grant = await db.prepare('SELECT * FROM oauth_requests WHERE state=? AND expires>?').get(hash(state), now());
    if (!grant || !browser || grant.browser_hash !== hash(browser)) fail(400, 'Google sign-in session is invalid or expired');
    await db.prepare('DELETE FROM oauth_requests WHERE state=?').run(hash(state));
    res.clearCookie('shortlist_oauth', {
      path: '/api/auth/google'
    });
    if (req.query.error) return res.redirect('/login?error=google_cancelled');
    if (typeof req.query.code !== 'string' || !googleConfigured()) fail(400, 'Invalid Google authorization response');
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          code: req.query.code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: `${appOrigin()}/api/auth/google/callback`,
          grant_type: 'authorization_code',
          code_verifier: grant.verifier
        }),
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error('Token exchange failed');
      const tokens = await response.json();
      const payload = verifyGoogleToken ? await verifyGoogleToken(tokens.id_token) : await new OAuth2Client(process.env.GOOGLE_CLIENT_ID).verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID
      }).then(t => t.getPayload());
      if (!payload?.sub || payload.nonce !== grant.nonce || payload.email_verified !== true || !['https://accounts.google.com', 'accounts.google.com'].includes(payload.iss)) throw new Error('Invalid identity');
      const verifiedEmail = email.parse(payload.email),
        linked = await db.prepare('SELECT u.* FROM google_identities g JOIN users u ON u.id=g.user_id WHERE g.subject=?').get(payload.sub);
      if (linked && grant.invite) throw new Error('Sign in normally to an existing account');
      const user = linked || (await provision({
        name: String(payload.name || verifiedEmail.split('@')[0]).slice(0, 80),
        email: verifiedEmail,
        password: passwordHash(randomBytes(48).toString('hex')),
        invite: grant.invite
      }));
      if (!linked) await db.prepare('INSERT INTO google_identities VALUES(?,?)').run(payload.sub, user.id);
      await issueSession(res, user);
      await audit(user.id, 'auth.google.login');
      return res.redirect(user.role === 'recruiter' ? '/setup/provider' : '/dashboard');
    } catch {
      return res.redirect('/login?error=google_failed');
    }
  }));
  return {
    router,
    requireUser: wrap(async (req, _res, next) => {
      req.user = await sessionUser(db, req);
      if (!req.user) return next(Object.assign(new Error('Sign in to continue'), {
        status: 401
      }));
      next();
    }),
    sessionUser: async req => await sessionUser(db, req)
  };
}
