import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openPostgres } from '../server/postgres.js';
import { migrate } from './migrate-postgres.js';
import { createCredentials } from '../server/credentials.js';

if(!process.env.TEST_DATABASE_URL)throw Error('Set TEST_DATABASE_URL to an isolated PostgreSQL test database.');
const schema=`shortlist_test_${randomUUID().replaceAll('-','')}`,admin=openPostgres(process.env.TEST_DATABASE_URL),checks=[];
const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-c search_path=${schema}`);
await admin.exec(`CREATE SCHEMA ${schema}`);const db=openPostgres(url.toString());await migrate(db);
const port=Number(process.env.TEST_APP_PORT||5176),base=`http://127.0.0.1:${port}`;
const workflowDir=path.resolve('.next/workflow-data');await mkdir(workflowDir,{recursive:true});
process.env.CREDENTIALS_ENCRYPTION_KEY='34'.repeat(32);process.env.WORKFLOW_LOCAL_DATA_DIR=workflowDir;process.env.WORKFLOW_LOCAL_BASE_URL=base;
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{windowsHide:true,env:{...process.env,VERCEL:'',DATABASE_URL:url.toString(),DATABASE_URL_UNPOOLED:url.toString(),BLOB_READ_WRITE_TOKEN:'vercel_blob_rw_synthetic_test_token',APP_URL:base,DEMO_MODE:'false',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',OPENAI_API_KEY:'',GEMINI_API_KEY:'',GROQ_API_KEY:'',RESEND_API_KEY:'',MAIL_FROM:'',CRON_SECRET:'synthetic-native-cron-secret'}});
let logs='';child.stdout.on('data',chunk=>{logs+=chunk;});child.stderr.on('data',chunk=>{logs+=chunk;});
async function check(route,status,options={}){const r=await fetch(base+route,{...options,redirect:'manual'});assert.equal(r.status,status,route+': '+await r.clone().text());checks.push({route,status});return r;}
try{
  let ready=false;for(let i=0;i<120;i++){try{ready=(await fetch(base+'/api/health')).ok;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,250));}assert(ready,'Native Next server did not become ready');
  await check('/',200);await check('/login',200);await check('/api/cron/workflows',401);
  await check('/api/cron/workflows',200,{headers:{authorization:'Bearer synthetic-native-cron-secret'}});
  assert.equal((await check('/dashboard',307)).headers.get('location'),'/login');
  assert.equal((await check('/setup/provider',307)).headers.get('location'),'/login');
  const signup=await check('/api/auth/signup',201,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Native QA Recruiter',email:'native-qa@example.com',workspaceName:'Native QA Workspace',password:'SyntheticPassword123!'})});
  const cookie=signup.headers.get('set-cookie').split(';')[0],user=await signup.json(),headers={cookie};
  assert.equal((await check('/dashboard',307,{headers})).headers.get('location'),'/setup/provider');
  assert((await (await check('/setup/provider',200,{headers})).text()).includes('Connect AI to start screening'));
  assert.equal((await check('/login',307,{headers})).headers.get('location'),'/setup/provider');
  const vault=await createCredentials(db,'unused');await vault.set(user.workspace_id,'gemini','synthetic-qa-key-not-used-for-live-requests');
  const settings=await check('/api/settings/ai',200,{headers});assert(!(await settings.text()).includes('synthetic-qa-key'));
  await check('/dashboard',200,{headers});await check('/dashboard/scorecard',200,{headers});
  const body={name:'Native QA Client'};await check('/api/clients',201,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
  await db.prepare('INSERT INTO workflow_outbox(workspace_id,requested_at) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET dispatched_at=NULL,requested_at=excluded.requested_at').run(user.workspace_id,new Date().toISOString());
  await check('/api/clients',201,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({name:'Workflow dispatch QA'})});
  let runId;for(let i=0;i<120;i++){runId=(await db.prepare('SELECT run_id FROM workflow_outbox WHERE workspace_id=?').get(user.workspace_id))?.run_id;if(runId)break;await new Promise(r=>setTimeout(r,250));}assert(runId,'Workflow outbox was not dispatched');
  const { getRun }=await import('workflow/api');let status;
  for(let i=0;i<120;i++){status=await getRun(runId).status;if(['completed','failed','cancelled'].includes(status))break;await new Promise(r=>setTimeout(r,250));}assert.equal(status,'completed','Compiled durable workflow failed');checks.push({workflow:'compiled processHiring empty-queue smoke',status});
  await check('/api/auth/logout',200,{method:'POST',headers});await check('/api/jobs',401,{headers});
  await writeFile('data/vercel-native-checks.json',JSON.stringify({checks,externalBlobVerified:false,liveAiVerified:false},null,2));console.log(JSON.stringify({checks:checks.length,workflow:status}));
}finally{
  child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});
  await writeFile('data/vercel-native-server.log',logs);
  await db.close();assert.match(schema,/^shortlist_test_[a-f0-9]{32}$/);await admin.exec(`DROP SCHEMA ${schema} CASCADE`);await admin.close();
}
