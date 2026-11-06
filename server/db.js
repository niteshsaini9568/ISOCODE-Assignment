import { mkdirSync } from 'node:fs';
import path from 'node:path';
export function openDb(directory) {
  const sqlite=process.getBuiltinModule('node:sqlite');
  if(!sqlite?.DatabaseSync)throw new Error('Local SQLite requires a Node.js build with SQLite support. Configure PostgreSQL for hosted operation.');
  const { DatabaseSync }=sqlite;
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'shortlist.sqlite'));
  db.exec('CREATE TABLE IF NOT EXISTS ai_credentials(workspace_id TEXT NOT NULL,provider TEXT NOT NULL,secret TEXT NOT NULL,PRIMARY KEY(workspace_id,provider))');
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,client_id TEXT);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,title TEXT NOT NULL,client_id TEXT NOT NULL,client_name TEXT NOT NULL,location TEXT NOT NULL,jd TEXT NOT NULL,criteria TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,mode TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT,text TEXT NOT NULL,profile TEXT NOT NULL,file_path TEXT,file_hash TEXT UNIQUE,text_hash TEXT UNIQUE,consent TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,stage TEXT NOT NULL DEFAULT 'Sourced',score TEXT,score_version INTEGER NOT NULL DEFAULT 0,score_error TEXT,submitted_at TEXT,reason TEXT,interview_at TEXT,created_at TEXT NOT NULL,UNIQUE(job_id,candidate_id));
    CREATE TABLE IF NOT EXISTS views(user_id TEXT REFERENCES users(id),application_id TEXT REFERENCES applications(id) ON DELETE CASCADE,version INTEGER NOT NULL,viewed_at TEXT NOT NULL,PRIMARY KEY(user_id,application_id));
    CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,job_id TEXT REFERENCES jobs(id),consent TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS batch_items(id TEXT PRIMARY KEY,batch_id TEXT REFERENCES batches(id),filename TEXT NOT NULL,file_path TEXT,file_hash TEXT,status TEXT NOT NULL,error TEXT,candidate_id TEXT REFERENCES candidates(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,subject TEXT,detail TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS weekly_reviews(week TEXT PRIMARY KEY,actor TEXT NOT NULL,notes TEXT NOT NULL,snapshot TEXT NOT NULL,created_at TEXT NOT NULL);`);
  db.exec(`CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS google_identities(subject TEXT PRIMARY KEY,user_id TEXT UNIQUE REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS invitations(token TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,client_id TEXT NOT NULL,email TEXT NOT NULL,expires TEXT NOT NULL,used_at TEXT);
    CREATE TABLE IF NOT EXISTS oauth_requests(state TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,verifier TEXT NOT NULL,nonce TEXT NOT NULL,invite TEXT,expires TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reset_tokens(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires TEXT NOT NULL);`);
  for(const table of ['users','jobs','candidates','batches','audit','weekly_reviews']) {
    if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='workspace_id'))db.exec(`ALTER TABLE ${table} ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'demo'`);
  }
  if(!db.prepare('PRAGMA table_info(applications)').all().some(c=>c.name==='submitted_version')){
    // Existing submissions have no version proof; require renewed approval after migration.
    db.exec('ALTER TABLE applications ADD COLUMN submitted_version INTEGER NOT NULL DEFAULT 0');
  }
  if(!db.prepare("SELECT 1 FROM settings WHERE key='tenancy_v1'").get()){
    db.exec(`BEGIN;
      UPDATE candidates SET file_hash='demo:'||file_hash WHERE file_hash IS NOT NULL;
      UPDATE candidates SET text_hash='demo:'||text_hash WHERE text_hash IS NOT NULL;
      UPDATE settings SET key='demo:ai' WHERE key='ai';
      INSERT INTO settings VALUES('tenancy_v1','1');
      COMMIT;`);
  }
  db.prepare('INSERT OR IGNORE INTO workspaces VALUES(?,?,?)').run('demo','Company A',new Date().toISOString());
  db.prepare('INSERT OR IGNORE INTO clients VALUES(?,?,?)').run('northstar','demo','Northstar Technologies');
  db.prepare('INSERT OR IGNORE INTO clients VALUES(?,?,?)').run('meridian','demo','Meridian Banking Services');
  return db;
}
export const decodeJob = row => row && ({ ...row, criteria: JSON.parse(row.criteria) });
