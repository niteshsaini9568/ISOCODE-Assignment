import { openPostgres } from '../server/postgres.js';
const required=['APP_URL','BLOB_READ_WRITE_TOKEN','CREDENTIALS_ENCRYPTION_KEY','CRON_SECRET'];
if(!process.env.DATABASE_URL&&!process.env.DATABASE_URL_UNPOOLED)throw Error('Configure a direct PostgreSQL DATABASE_URL or DATABASE_URL_UNPOOLED.');
const missing=required.filter(name=>!process.env[name]);if(missing.length)throw Error(`Missing server configuration: ${missing.join(', ')}`);
if(!/^https:\/\//.test(process.env.APP_URL))throw Error('APP_URL must use HTTPS for deployment.');
if(!/^[a-f0-9]{64}$/i.test(process.env.CREDENTIALS_ENCRYPTION_KEY))throw Error('CREDENTIALS_ENCRYPTION_KEY must contain 64 hexadecimal characters.');
if(process.env.CRON_SECRET.length<32)throw Error('Use at least 32 characters for CRON_SECRET.');
if(process.env.DEMO_MODE!=='false')throw Error('Set DEMO_MODE=false for production.');
if(Boolean(process.env.GOOGLE_CLIENT_ID)!==Boolean(process.env.GOOGLE_CLIENT_SECRET))throw Error('Configure both Google OAuth variables, or leave both blank.');
const db=openPostgres();try{
  await db.prepare('SELECT workspace_id,provider,secret FROM ai_credentials LIMIT 0').all();
  await db.prepare('SELECT workspace_id,run_id FROM workflow_outbox LIMIT 0').all();
  await db.prepare('SELECT pathname,session_id FROM upload_files LIMIT 0').all();
  console.log('Cloud environment and PostgreSQL schema checks passed. Live Blob, OAuth, provider keys and email delivery still require deployment verification.');
}finally{await db.close();}
