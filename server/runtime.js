import { createApp } from './app.js';
import { openPostgres } from './postgres.js';
import { blobFiles } from './files.js';
import { createCloudUploads } from './cloud-uploads.js';

export function getRuntime(){
  if(!globalThis.__shortlistRuntime)globalThis.__shortlistRuntime=(async()=>{
    if(process.env.VERCEL&&!process.env.DATABASE_URL&&!process.env.DATABASE_URL_UNPOOLED)throw new Error('Configure DATABASE_URL and run npm run migrate:cloud before deployment.');
    if(process.env.DATABASE_URL||process.env.DATABASE_URL_UNPOOLED){
      if(!/^[a-f0-9]{64}$/i.test(process.env.CREDENTIALS_ENCRYPTION_KEY||''))throw new Error('Configure a stable 64-character hexadecimal CREDENTIALS_ENCRYPTION_KEY.');
      if(!process.env.BLOB_READ_WRITE_TOKEN)throw new Error('Connect a private Blob store and configure BLOB_READ_WRITE_TOKEN.');
      if(!process.env.APP_URL)throw new Error('APP_URL must be your deployment origin.');
      if(process.env.VERCEL&&!process.env.APP_URL.startsWith('https://'))throw new Error('APP_URL must use HTTPS on Vercel.');
      const db=openPostgres();
      try{return await createApp({database:db,serverless:true,production:true,demo:false,fileStore:blobFiles,cloudUploads:createCloudUploads()});}
      catch(error){await db.close();throw error;}
    }
    return createApp({demo:process.env.DEMO_MODE==='true'||(process.env.NODE_ENV!=='production'&&process.env.DEMO_MODE!=='false'),production:process.env.NODE_ENV==='production'});
  })().catch(error=>{globalThis.__shortlistRuntime=null;throw error;});
  return globalThis.__shortlistRuntime;
}
