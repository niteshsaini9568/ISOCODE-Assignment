import { getRuntime } from '../../../server/runtime.js';
import { dispatchWork } from '../../../server/dispatch.js';
import { waitUntil } from '@vercel/functions';

export const config={api:{bodyParser:false,responseLimit:'4mb'},maxDuration:300};
export default async function handler(req,res){
  let runtime;
  try{
    runtime=await getRuntime();
    await new Promise((resolve,reject)=>{res.once('finish',resolve);res.once('close',resolve);runtime.app(req,res,error=>error?reject(error):res.status(404).json({error:'API route not found'}));if(process.env.VERCEL&&req.dbFinished)waitUntil(req.dbFinished);});
    await req.dbFinished;
    // Work is recorded durably before responding; cron can recover a failed dispatch.
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){
      const pending=dispatchWork(runtime).catch(error=>console.error('Workflow dispatch deferred to cron:',error.message));
      if(process.env.VERCEL)waitUntil(pending);else await pending;
    }
  }catch(error){
    console.error('API runtime:',error.message);
    if(!res.headersSent)res.status(503).json({error:'Service configuration or database is unavailable. Contact your administrator.'});
  }
}
