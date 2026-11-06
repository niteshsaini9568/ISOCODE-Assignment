import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { handleUpload } from '@vercel/blob/client';
import { blobFiles } from './files.js';
import { now,fail } from './domain.js';

const types={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const validate=(schema,value)=>{const parsed=schema.safeParse(value);if(!parsed.success)fail(400,'Invalid upload manifest or consent.');return parsed.data;};
export function createCloudUploads(store=blobFiles,authorize=handleUpload){return {
  hasActive:async(db,workspace)=>Boolean(await db.prepare("SELECT 1 FROM upload_sessions WHERE workspace_id=? AND status='uploading' AND expires>? LIMIT 1").get(workspace,now())),
  registerTokenRoute(app,{db,auth}){
    app.post('/api/blob/upload',wrap(async(req,res)=>{
      const result=await authorize({request:req,body:req.body,
        async onBeforeGenerateToken(pathname){
          const user=await auth.sessionUser(req);if(!user)fail(401,'Sign in to upload');if(user.role!=='recruiter')fail(403,'Recruiter access required');
          const file=await db.prepare("SELECT f.*,s.expires FROM upload_files f JOIN upload_sessions s ON s.id=f.session_id WHERE f.pathname=? AND s.workspace_id=? AND s.status='uploading' AND s.expires>?").get(pathname,user.workspace_id,now());
          if(!file)fail(404,'Upload authorization not found or expired');
          return {allowedContentTypes:[file.content_type],maximumSizeInBytes:file.size,validUntil:new Date(file.expires).getTime(),addRandomSuffix:false,allowOverwrite:false,tokenPayload:JSON.stringify({fileId:file.id})};
        },
        async onUploadCompleted({blob,tokenPayload}){
          const {fileId}=JSON.parse(tokenPayload||'{}');
          await db.prepare('UPDATE upload_files SET blob_url=? WHERE id=? AND pathname=?').run(blob.url,fileId,blob.pathname);
        }
      });res.json(result);
    }));
  },
  registerRoutes(app,{db,getJob,getSelection,requestWork,audit}){
    app.post('/api/jobs/:id/upload-session',wrap(async(req,res)=>{
      await getJob(req.params.id,req.user);
      const body=validate(z.object({source:z.string().trim().min(5).max(500),consent:z.literal(true),aiProcessing:z.boolean(),aiProvider:z.enum(['openai','gemini','groq']),files:z.array(z.object({name:z.string().min(1).max(180).regex(/\.(pdf|docx)$/i),size:z.number().int().positive().max(8*1024*1024)}).strict()).min(1).max(500)}).strict(),req.body);
      if(body.files.reduce((sum,f)=>sum+f.size,0)>100*1024*1024)fail(413,'Batch exceeds 100 MB');
      const selection=await getSelection(req.user.workspace_id);if(body.aiProvider!==selection.provider)fail(409,'Provider changed. Refresh and confirm consent.');
      const id=randomUUID(),stamp=now(),consent={source:body.source,purpose:'Hiring evaluation only',grantedAt:stamp,recordedBy:req.user.id,aiProcessing:body.aiProcessing,aiProvider:selection.provider};
      const files=body.files.map(f=>{const ext=f.name.split('.').at(-1).toLowerCase();return {id:randomUUID(),filename:f.name,pathname:`cv/${req.user.workspace_id}/${id}/${randomUUID()}.${ext}`,size:f.size,contentType:types[ext]};});
      await db.exec('BEGIN');try{
        await db.prepare('INSERT INTO upload_sessions(id,workspace_id,job_id,actor,consent,expires,created_at) VALUES(?,?,?,?,?,?,?)').run(id,req.user.workspace_id,req.params.id,req.user.id,JSON.stringify(consent),new Date(Date.now()+30*60000).toISOString(),stamp);
        for(const f of files)await db.prepare('INSERT INTO upload_files(id,session_id,filename,pathname,size,content_type) VALUES(?,?,?,?,?,?)').run(f.id,id,f.filename,f.pathname,f.size,f.contentType);
        await db.exec('COMMIT');
      }catch(error){await db.exec('ROLLBACK');throw error;}
      res.status(201).json({id,files});
    }));
    app.post('/api/upload-sessions/:id/complete',wrap(async(req,res)=>{
      const session=await db.prepare('SELECT * FROM upload_sessions WHERE id=? AND workspace_id=?').get(req.params.id,req.user.workspace_id);if(!session)fail(404,'Upload not found');
      if(session.status==='queued')return res.status(202).json({id:session.id});
      if(session.expires<now())fail(409,'Upload session expired. Start a new batch.');
      const files=await db.prepare('SELECT * FROM upload_files WHERE session_id=?').all(session.id);
      for(let i=0;i<files.length;i+=8)await Promise.all(files.slice(i,i+8).map(async file=>{
        let metadata;try{metadata=await store.head(file.pathname);}catch{fail(409,'Some CVs have not finished uploading. Retry completion.');}
        if(metadata.pathname!==file.pathname||metadata.size!==file.size||metadata.contentType!==file.content_type)fail(422,'Uploaded CV differs from its authorized manifest');
      }));
      await db.exec('BEGIN');try{
        await db.prepare('INSERT INTO batches(id,job_id,consent,created_at,workspace_id) VALUES(?,?,?,?,?)').run(session.id,session.job_id,session.consent,now(),session.workspace_id);
        for(const f of files)await db.prepare("INSERT INTO batch_items(id,batch_id,filename,file_path,status) VALUES(?,?,?,?,'pending')").run(f.id,session.id,f.filename,f.pathname);
        await db.prepare("UPDATE upload_sessions SET status='queued' WHERE id=?").run(session.id);
        await requestWork(session.workspace_id);await audit(req.user.id,'batch.uploaded',session.id,`${files.length} private CVs; consent recorded`);await db.exec('COMMIT');
      }catch(error){await db.exec('ROLLBACK');throw error;}
      res.status(202).json({id:session.id});
    }));
    app.delete('/api/upload-sessions/:id',wrap(async(req,res)=>{
      const session=await db.prepare("SELECT * FROM upload_sessions WHERE id=? AND workspace_id=? AND status='uploading'").get(req.params.id,req.user.workspace_id);if(!session)fail(404,'Unfinished upload not found');
      // Tokens may remain valid until expiry; cleanup waits an hour before deleting abandoned files.
      await db.prepare("UPDATE upload_sessions SET expires=? WHERE id=?").run(now(),session.id);res.json({ok:true});
    }));
  },
  async cleanup(db){
    const removePaths=async paths=>{for(let offset=0;offset<paths.length;offset+=100){const chunk=paths.slice(offset,offset+100);if(store.removeMany)await store.removeMany(chunk);else for(let i=0;i<chunk.length;i+=8)await Promise.all(chunk.slice(i,i+8).map(p=>store.remove(p)));}};
    const orphans=await db.prepare("SELECT f.id,f.pathname FROM upload_files f JOIN batch_items i ON i.id=f.id WHERE i.status IN ('done','duplicate') AND NOT EXISTS (SELECT 1 FROM candidates c WHERE c.file_path=f.pathname) AND NOT EXISTS (SELECT 1 FROM batch_items other WHERE other.file_path=f.pathname) LIMIT 100").all();
    await removePaths(orphans.map(file=>file.pathname));for(const file of orphans)await db.prepare('DELETE FROM upload_files WHERE id=?').run(file.id);
    const expired=await db.prepare("SELECT * FROM upload_sessions WHERE status='uploading' AND expires<? LIMIT 10").all(new Date(Date.now()-3600000).toISOString());
    for(const session of expired){await db.lock(session.workspace_id);const files=await db.prepare('SELECT pathname FROM upload_files WHERE session_id=?').all(session.id);await removePaths(files.map(f=>f.pathname));await db.prepare('DELETE FROM upload_sessions WHERE id=?').run(session.id);}
    await db.prepare('DELETE FROM auth_rate_limits WHERE reset_at<?').run(Date.now()-86400000);
  }
};}
