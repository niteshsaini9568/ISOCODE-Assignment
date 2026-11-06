import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
export async function createCredentials(db, directory) {
  const file = path.join(directory, 'credentials.key');
  function master(create = false) {
    if(process.env.CREDENTIALS_ENCRYPTION_KEY){
      if(!/^[a-f0-9]{64}$/i.test(process.env.CREDENTIALS_ENCRYPTION_KEY))throw new Error('CREDENTIALS_ENCRYPTION_KEY must be 64 hexadecimal characters.');
      return Buffer.from(process.env.CREDENTIALS_ENCRYPTION_KEY,'hex');
    }
    if(db.kind==='postgres'||process.env.VERCEL)throw new Error('CREDENTIALS_ENCRYPTION_KEY is required for cloud credentials.');
    try {
      return readFileSync(file);
    } catch (error) {
      if (error.code !== 'ENOENT' || !create) throw new Error('Provider key storage is unavailable. Restore credentials.key before continuing.');
      const key = randomBytes(32);
      writeFileSync(file, key, {
        flag: 'wx',
        mode: 0o600
      });
      return key;
    }
  }
  return {
    has: async (workspace, provider) => Boolean(await db.prepare('SELECT 1 FROM ai_credentials WHERE workspace_id=? AND provider=?').get(workspace, provider)),
    async get(workspace, provider) {
      const row = await db.prepare('SELECT secret FROM ai_credentials WHERE workspace_id=? AND provider=?').get(workspace, provider);
      if (!row) return undefined;
      const [iv, tag, encrypted] = row.secret.split('.').map(s => Buffer.from(s, 'base64'));
      const decipher = createDecipheriv('aes-256-gcm', master(), iv);
      decipher.setAAD(Buffer.from(`${workspace}:${provider}`));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    },
    async set(workspace, provider, value) {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', master(true), iv);
      cipher.setAAD(Buffer.from(`${workspace}:${provider}`));
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      const secret = [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64')).join('.');
      await db.prepare('INSERT INTO ai_credentials VALUES(?,?,?) ON CONFLICT(workspace_id,provider) DO UPDATE SET secret=excluded.secret').run(workspace, provider, secret);
    }
  };
}
