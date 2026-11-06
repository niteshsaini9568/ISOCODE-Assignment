import next from 'next';
import { createApp } from './app.js';
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const demo = process.env.DEMO_MODE === 'true' || !production && process.env.DEMO_MODE !== 'false';
const port = Number(process.env.PORT || 5173),
  host = process.env.HOST || '127.0.0.1';
const frontend = next({
  dev: !production,
  hostname: host,
  port
});
await frontend.prepare();
const runtime = await createApp({
  production,
  demo
});
globalThis.__shortlistRuntime=Promise.resolve(runtime);
runtime.app.use('/dashboard', async (req, res, next) => {
  const user = await runtime.sessionUser(req);
  if (!user) return res.redirect('/login');
  const parts = req.path.split('/').filter(Boolean),
    section = parts[0] || 'overview';
  const allowed = user.role === 'client' ? ['overview', 'portal', 'pipeline'] : ['overview', 'scorecard', 'upload', 'ranked', 'pipeline', 'governance'];
  if (parts.length > 1 || !allowed.includes(section)) return res.redirect('/dashboard');
  res.set('Cache-Control', 'private, no-store');
  next();
});
runtime.app.get(['/login', '/signup'], async (req, res, next) => {
  const user = await runtime.sessionUser(req);
  if (user) return res.redirect(user.role === 'recruiter' ? '/setup/provider' : '/dashboard');
  next();
});
runtime.app.all('*', (req, res) => frontend.getRequestHandler()(req, res));
const server = runtime.app.listen(port, host, () => console.log(`Shortlist · Next.js + Node.js: http://${host}:${port} · ${demo ? 'demo accounts enabled' : 'demo accounts disabled'}`));
async function stop() {
  server.close();
  await runtime.close();
  await frontend.close();
  process.exit(0);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
