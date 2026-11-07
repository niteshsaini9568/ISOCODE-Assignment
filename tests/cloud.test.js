import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPostgres } from '../server/postgres.js';
import { migrate } from '../scripts/migrate-postgres.js';
import { createApp } from '../server/app.js';
import { createCloudUploads } from '../server/cloud-uploads.js';
import { demoScorecard } from '../server/domain.js';
import { makePdf,makeDocx } from '../scripts/generate-samples.js';
import { handleUpload } from '@vercel/blob/client';
import { processNext } from '../workflows/hiring.js';
import { collectPages,collectRecordPages } from '../src/api-pages.js';

async function fixture(t){
  const admin=openPostgres(process.env.TEST_DATABASE_URL),schema=`shortlist_test_${randomUUID().replaceAll('-','')}`;
  assert.match(schema,/^shortlist_test_[a-f0-9]{32}$/);await admin.exec(`CREATE SCHEMA ${schema}`);
  const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-c search_path=${schema}`);
  const db=openPostgres(url.toString());await migrate(db);
  const names=['AI_PROVIDER','GEMINI_API_KEY','OPENAI_API_KEY','GROQ_API_KEY','CREDENTIALS_ENCRYPTION_KEY'];
  const previous=Object.fromEntries(names.map(n=>[n,process.env[n]]));for(const n of names)delete process.env[n];process.env.CREDENTIALS_ENCRYPTION_KEY='12'.repeat(32);
  const blobs=new Map(),store={
    async read(path){const blob=blobs.get(path);if(!blob)throw Error('Missing synthetic blob');return blob.buffer;},
    async remove(path){blobs.delete(path);},
    async head(path){const blob=blobs.get(path);if(!blob)throw Error('Not uploaded');return {pathname:path,size:blob.buffer.length,contentType:blob.contentType};},
    async download(path){return `https://download.fixture.invalid/${encodeURIComponent(path)}`;}
  };
  const authorize=async options=>options.onBeforeGenerateToken(options.body.pathname);
  const runtime=await createApp({database:db,demo:false,production:true,serverless:true,fileStore:store,cloudUploads:createCloudUploads(store,authorize)});
  const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  async function request(route,{body,cookie,method='GET',headers={}}={}){
    const r=await fetch(base+route,{method,redirect:'manual',headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
    const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0],headers:r.headers};
  }
  const signup=async(email='recruiter@example.com')=>{const r=await request('/auth/signup',{method:'POST',body:{name:'Cloud Recruiter',workspaceName:'Cloud Test Workspace',email,password:'SyntheticPassword123!'}});assert.equal(r.status,201,JSON.stringify(r.data));return r;};
  async function drain(workspace){for(let i=0;i<1200;i++){const more=await db.context(async()=>{await db.lock(workspace);return runtime.worker.tick(workspace);});if(!more)return;}throw Error('Cloud queue did not drain');}
  t.after(async()=>{await new Promise(r=>server.close(r));await runtime.close();await admin.exec(`DROP SCHEMA ${schema} CASCADE`);await admin.close();for(const n of names)if(previous[n]===undefined)delete process.env[n];else process.env[n]=previous[n];});
  return {runtime,db,request,signup,drain,blobs,store,url:url.toString()};
}

test('cloud: PostgreSQL transactions, private upload manifest, scoring, client review and deletion', {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const {db,request,signup,drain,blobs}=await fixture(t),owner=await signup(),cookie=owner.cookie,workspace=owner.data.workspace_id;
  assert.equal((await request('/config',{cookie})).data.uploads,'blob');
  const clientId=(await request('/clients',{cookie})).data[0].id;
  const jd='Senior Java Developer, Java, Spring Boot, 5-8 years, Noida, notice up to 60 days',criteria=demoScorecard(jd);
  const created=await request('/jobs',{method:'POST',cookie,body:{title:'Senior Java Developer',clientId,location:'Noida',jd,criteria}});assert.equal(created.status,201,JSON.stringify(created.data));const jobId=created.data.id;
  const text='Name: Cloud Fixture Person\nCurrent role: Senior Java Developer\nTotal experience: 6 years\nSkills: Java, Spring Boot\nNotice: 30 days\nLocation: Noida';
  const contents=[makePdf(text),await makeDocx(text+'\nProject: Built Java services'),makePdf(' ')];
  const manifest={source:'Explicit synthetic hiring consent',consent:true,aiProcessing:false,aiProvider:'gemini',files:contents.map((b,i)=>({name:`cloud-${i}.${i===1?'docx':'pdf'}`,size:b.length}))};
  assert.equal((await request(`/jobs/${jobId}/upload-session`,{cookie,method:'POST',body:{...manifest,consent:false}})).status,400);
  const session=await request(`/jobs/${jobId}/upload-session`,{cookie,method:'POST',body:manifest});assert.equal(session.status,201,JSON.stringify(session.data));
  assert.equal((await request('/blob/upload',{method:'POST',body:{pathname:session.data.files[0].pathname}})).status,401);
  const other=await signup('other@example.com');assert.equal((await request('/blob/upload',{cookie:other.cookie,method:'POST',body:{pathname:session.data.files[0].pathname}})).status,404);
  assert.equal((await request(`/upload-sessions/${session.data.id}/complete`,{cookie,method:'POST',body:{}})).status,409);
  for(let i=0;i<contents.length;i++){
    const f=session.data.files[i],token=await request('/blob/upload',{cookie,method:'POST',body:{pathname:f.pathname}});assert.equal(token.status,200,JSON.stringify(token.data));assert.equal(token.data.maximumSizeInBytes,contents[i].length);assert.equal(token.data.allowOverwrite,false);
    blobs.set(f.pathname,{buffer:contents[i],contentType:f.contentType});
  }
  const completed=await Promise.all([1,2].map(()=>request(`/upload-sessions/${session.data.id}/complete`,{cookie,method:'POST',body:{}})));assert(completed.every(r=>r.status===202),JSON.stringify(completed));
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM batches').get()).n,1);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM batch_items').get()).n,3);
  assert.equal((await db.prepare('SELECT * FROM workflow_outbox WHERE workspace_id=?').get(workspace)).dispatched_at,null);
  await drain(workspace);
  let rows=(await request(`/jobs/${jobId}/candidates`,{cookie})).data;assert.equal(rows.length,2);assert(rows.every(r=>r.stage==='Sourced'&&r.score));
  const scan=await db.prepare("SELECT * FROM batch_items WHERE status='needs_review'").get();assert(scan);
  assert.equal((await request(`/batch-items/${scan.id}/transcript`,{cookie,method:'POST',body:{text:text+'\nProject: Verified scan transcript\n'+'履'.repeat(80000)}})).status,200);await drain(workspace);
  rows=(await request(`/jobs/${jobId}/candidates`,{cookie})).data;assert.equal(rows.length,3);
  const id=rows[0].id;
  assert.equal((await request(`/applications/${id}/submit`,{cookie,method:'POST',body:{}})).status,409);
  const cv=await request(`/applications/${id}/cv`,{cookie,headers:{accept:'application/json'}});assert.equal(cv.status,200);assert.match(cv.data.downloadUrl,/download.fixture.invalid/);
  assert.equal((await request(`/applications/${id}/submit`,{cookie,method:'POST',body:{}})).status,200);
  const invite=await request('/invitations',{cookie,method:'POST',body:{email:'client@example.com',clientId}});assert.equal(invite.status,201);
  const manager=await request('/auth/signup',{method:'POST',body:{name:'Client Manager',email:'client@example.com',password:'SyntheticPassword123!',invite:new URL(invite.data.url).searchParams.get('invite')}});assert.equal(manager.status,201);
  const visible=(await request(`/jobs/${jobId}/candidates`,{cookie:manager.cookie})).data;assert.equal(visible.length,1);assert(!JSON.stringify(visible).includes('Cloud Fixture Person'));
  assert.equal((await request(`/applications/${id}/cv`,{cookie:manager.cookie})).status,403);
  assert.equal((await request(`/applications/${id}/decision`,{cookie:manager.cookie,method:'POST',body:{action:'reject'}})).status,400);
  assert.equal((await request(`/applications/${id}/decision`,{cookie:manager.cookie,method:'POST',body:{action:'interview',interviewAt:new Date(Date.now()+86400000).toISOString()}})).status,200);
  assert.equal((await request('/weekly-review',{cookie,method:'POST',body:{notes:'Reviewed synthetic ranks and human choices.'}})).status,200);
  const candidateId=rows[0].candidateId;
  const original=await db.prepare('SELECT batch_id FROM batch_items WHERE candidate_id=? LIMIT 1').get(candidateId),duplicateId=randomUUID(),duplicatePath=`private/duplicate-${duplicateId}.pdf`;
  await db.prepare("INSERT INTO batch_items(id,batch_id,filename,status,candidate_id) VALUES(?,?,?,'duplicate',?)").run(duplicateId,original.batch_id,'duplicate.pdf',candidateId);
  await db.prepare('INSERT INTO upload_files(id,session_id,filename,pathname,size,content_type) VALUES(?,?,?,?,?,?)').run(duplicateId,original.batch_id,'duplicate.pdf',duplicatePath,10,'application/pdf');
  blobs.set(duplicatePath,{buffer:Buffer.from('duplicate'),contentType:'application/pdf'});
  assert.equal((await request(`/candidates/${candidateId}`,{cookie:other.cookie,method:'DELETE',body:{confirmation:candidateId}})).status,404);
  assert.equal((await request(`/candidates/${candidateId}`,{cookie,method:'DELETE',body:{confirmation:candidateId}})).status,200);
  assert(!blobs.has(duplicatePath),'Deletion must erase duplicate Blob copies before removing their manifest records');
  assert.equal((await request(`/applications/${id}`,{cookie:manager.cookie})).status,404);
  assert.equal((await request('/privacy',{cookie})).data.candidates.length,2);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM weekly_reviews').get()).n,0);
});

test('cloud: rate limits and sessions work across API instances', {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const {db,request,signup,url}=await fixture(t),owner=await signup('native-recruiter@preview.test');
  const secondDb=openPostgres(url),second=await createApp({database:secondDb,demo:false,serverless:true}),server=second.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await second.close();});
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const me=await fetch(base+'/auth/me',{headers:{cookie:owner.cookie}});assert.equal(me.status,200);
  await db.prepare('DELETE FROM auth_rate_limits').run();
  for(let i=0;i<30;i++){
    const r=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'unknown@example.com',password:'wrong'})});assert.equal(r.status,401);
  }
  assert.equal((await request('/auth/login',{method:'POST',body:{email:'unknown@example.com',password:'wrong'}})).status,429);
});

test('cloud: 500 mixed CVs process through PostgreSQL and manifests enforce size limits', {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const {db,request,signup,drain,blobs,store}=await fixture(t),owner=await signup(),cookie=owner.cookie,clientId=(await request('/clients',{cookie})).data[0].id;
  const jd='Java Developer, 5-8 years, Java, Noida, notice up to 60 days';
  const job=await request('/jobs',{cookie,method:'POST',body:{title:'Java Developer',clientId,location:'Noida',jd,criteria:demoScorecard(jd)}});assert.equal(job.status,201);
  const buffers=[];for(let i=0;i<500;i++){const text=`Name: Bulk Person ${i}\nbulk${i}@example.com\nCurrent role: Java Developer\nTotal experience: 6 years\nSkills: Java\nNotice: 30 days\nProject: Built service ${i}`;buffers.push(i%2?await makeDocx(text,i%4===1):makePdf(text));}
  const manifest={source:'Synthetic bulk hiring consent',consent:true,aiProcessing:false,aiProvider:'gemini',files:buffers.map((b,i)=>({name:`${'履'.repeat(168)}${i}.${i%2?'docx':'pdf'}`,size:b.length}))};
  for(const files of [[...manifest.files,manifest.files[0]],[{name:'large.pdf',size:8*1024*1024+1}],Array.from({length:13},()=>({name:'cv.pdf',size:8*1024*1024}))]){
    const r=await request(`/jobs/${job.data.id}/upload-session`,{cookie,method:'POST',body:{...manifest,files}});assert([400,413].includes(r.status));
  }
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM upload_sessions').get()).n,0);
  const session=await request(`/jobs/${job.data.id}/upload-session`,{cookie,method:'POST',body:manifest});assert.equal(session.status,201);
  for(let i=0;i<500;i++)blobs.set(session.data.files[i].pathname,{buffer:buffers[i],contentType:session.data.files[i].contentType});
  assert.equal((await request(`/upload-sessions/${session.data.id}/complete`,{cookie,method:'POST',body:{}})).status,202);
  await drain(owner.data.workspace_id);
  const rows=await collectPages(async offset=>(await request(`/jobs/${job.data.id}/candidates?offset=${offset}`,{cookie})).data,100);assert.equal(rows.length,500);assert(rows.every(r=>r.score&&r.stage==='Sourced'));
  assert.equal((await request(`/jobs/${job.data.id}/candidates`,{cookie})).data.length,100);
  assert.equal((await request(`/jobs/${job.data.id}/candidates?offset=-1`,{cookie})).status,400);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM batch_items WHERE status='done'").get()).n,500);
  await db.prepare("INSERT INTO candidates(id,name,text,profile,consent,created_at,workspace_id) SELECT 'CND-LOW-PAGE',name,text,profile,consent,created_at,workspace_id FROM candidates LIMIT 1").run();
  await db.prepare("INSERT INTO applications(id,job_id,candidate_id,score,score_version,created_at) VALUES(?,?,?, ?,1,?)").run('low-page-app',job.data.id,'CND-LOW-PAGE',JSON.stringify({total:0,mode:'demo',criteria:[]}),new Date().toISOString());
  const all=await collectPages(async offset=>(await request(`/jobs/${job.data.id}/candidates?offset=${offset}`,{cookie})).data,100);assert.equal(all.length,501);assert.equal(all.find(r=>r.candidateId==='CND-LOW-PAGE').score.total,0);
  const privacy=await collectRecordPages(async offset=>(await request(`/privacy?offset=${offset}`,{cookie})).data,'candidates',500);assert.equal(privacy.candidates.length,501);
  for(let i=0;i<25;i++)await db.prepare('INSERT INTO jobs SELECT ?,title,client_id,client_name,location,jd,criteria,version,mode,created_at,workspace_id FROM jobs WHERE id=?').run(`page-job-${i}`,job.data.id);
  assert.equal((await collectPages(async offset=>(await request(`/jobs?offset=${offset}`,{cookie})).data,25)).length,26);
  for(let i=0;i<26;i++)await db.prepare('INSERT INTO weekly_reviews VALUES(?,?,?,?,?,?)').run(`${owner.data.workspace_id}:2026-01-${String(i+1).padStart(2,'0')}`,owner.data.id,'Synthetic saved review','[]',new Date().toISOString(),owner.data.workspace_id);
  const reviews=await collectRecordPages(async offset=>(await request(`/weekly-review?offset=${offset}`,{cookie})).data,'reviews',25);assert.equal(reviews.reviews.length,26);
  const small={...manifest,files:[manifest.files[0]]};
  const duplicate=await request(`/jobs/${job.data.id}/upload-session`,{cookie,method:'POST',body:small});assert.equal(duplicate.status,201);const dupeFile=duplicate.data.files[0];blobs.set(dupeFile.pathname,{buffer:buffers[0],contentType:dupeFile.contentType});
  await request(`/upload-sessions/${duplicate.data.id}/complete`,{cookie,method:'POST',body:{}});await drain(owner.data.workspace_id);assert(blobs.has(dupeFile.pathname));
  const abandoned=await request(`/jobs/${job.data.id}/upload-session`,{cookie,method:'POST',body:small}),abandonedFile=abandoned.data.files[0];blobs.set(abandonedFile.pathname,{buffer:buffers[0],contentType:abandonedFile.contentType});
  await db.prepare('UPDATE upload_sessions SET expires=? WHERE id=?').run(new Date(Date.now()-2*3600000).toISOString(),abandoned.data.id);
  await db.context(()=>createCloudUploads(store).cleanup(db));
  assert(!blobs.has(dupeFile.pathname));assert(!blobs.has(abandonedFile.pathname));assert(blobs.has(session.data.files[0].pathname));
  assert.equal(await db.prepare('SELECT id FROM upload_sessions WHERE id=?').get(abandoned.data.id),undefined);
});

test('cloud: durable step recovers interrupted work and candidate creation is atomic', {skip:!process.env.TEST_DATABASE_URL},async t=>{
  const {runtime,db,request,signup,blobs}=await fixture(t),owner=await signup(),cookie=owner.cookie,clientId=(await request('/clients',{cookie})).data[0].id;
  const jd='Java Developer, Java, 5-8 years, Noida',job=await request('/jobs',{cookie,method:'POST',body:{title:'Java Developer',clientId,location:'Noida',jd,criteria:demoScorecard(jd)}});
  const buffer=makePdf('Name: Recovery Cloud Person\nCurrent role: Java Developer\nTotal experience: 6 years\nSkills: Java\nProject: Durable processing recovery');
  const session=await request(`/jobs/${job.data.id}/upload-session`,{cookie,method:'POST',body:{source:'Synthetic recovery consent',consent:true,aiProcessing:false,aiProvider:'gemini',files:[{name:'recovery.pdf',size:buffer.length}]}});
  const file=session.data.files[0];blobs.set(file.pathname,{buffer,contentType:file.contentType});await request(`/upload-sessions/${session.data.id}/complete`,{cookie,method:'POST',body:{}});
  const prior=globalThis.__shortlistRuntime;globalThis.__shortlistRuntime=Promise.resolve(runtime);t.after(()=>{globalThis.__shortlistRuntime=prior;});
  const prepare=db.prepare;let failOnce=true;
  db.prepare=sql=>{
    if(sql.startsWith('UPDATE batch_items SET status=?')&&failOnce){failOnce=false;return {run:async()=>{throw Error('Synthetic transaction interruption');}};}
    return prepare(sql);
  };
  await processNext(owner.data.workspace_id);assert.equal((await db.prepare('SELECT COUNT(*) n FROM candidates').get()).n,0);assert.equal((await db.prepare('SELECT status FROM batch_items WHERE id=?').get(file.id)).status,'failed');
  db.prepare=prepare;
  await request(`/batch-items/${file.id}/retry`,{cookie,method:'POST',body:{}});
  await db.prepare("UPDATE batch_items SET status='processing' WHERE id=?").run(file.id);
  assert.equal(await processNext(owner.data.workspace_id),true);assert.equal(await processNext(owner.data.workspace_id),true);assert.equal(await processNext(owner.data.workspace_id),false);
  const row=(await request(`/jobs/${job.data.id}/candidates`,{cookie})).data[0];assert(row.score);assert.equal(row.stage,'Sourced');
});

test('Blob SDK refuses unsigned upload-completion callbacks',async()=>{
  let completed=false;
  await assert.rejects(handleUpload({token:'vercel_blob_rw_synthetic_test_secret',request:{headers:{}},body:{type:'blob.upload-completed',payload:{blob:{url:'https://forged.invalid',pathname:'cv/forged'},tokenPayload:'{}'}},onBeforeGenerateToken:async()=>({}),onUploadCompleted:async()=>{completed=true;}}),/signature/);
  assert.equal(completed,false);
});
