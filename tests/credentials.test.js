import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createCredentials } from '../server/credentials.js';
test('encrypted credentials survive database reopen, reject ciphertext transplant and fail closed without master key', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'shortlist-credentials-'));
  let db = openDb(directory);
  try {
    const vault = await createCredentials(db, directory);
    await vault.set('workspace-a', 'gemini', 'synthetic-secret-value');
    assert.equal((await readFile(path.join(directory, 'credentials.key'))).length, 32);
    assert(!(await readFile(path.join(directory, 'shortlist.sqlite'))).includes(Buffer.from('synthetic-secret-value')));
    db.close();
    db = openDb(directory);
    const reopened = await createCredentials(db, directory);
    assert.equal(await reopened.get('workspace-a', 'gemini'), 'synthetic-secret-value');
    db.prepare("INSERT INTO ai_credentials SELECT 'workspace-b',provider,secret FROM ai_credentials WHERE workspace_id='workspace-a'").run();
    await assert.rejects(() => reopened.get('workspace-b', 'gemini'));
    await unlink(path.join(directory, 'credentials.key'));
    await assert.rejects(() => reopened.get('workspace-a', 'gemini'), /storage is unavailable/);
  } finally {
    db.close();
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert(path.basename(directory).startsWith('shortlist-credentials-'));
    await rm(directory, {
      recursive: true,
      force: true
    });
  }
});
