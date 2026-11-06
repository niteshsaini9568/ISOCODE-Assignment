import { timingSafeEqual,createHash } from 'node:crypto';
import { getRuntime } from '../../../../../server/runtime.js';
import { dispatchWork } from '../../../../../server/dispatch.js';
import { createCloudUploads } from '../../../../../server/cloud-uploads.js';
export const runtime='nodejs',dynamic='force-dynamic',maxDuration=300;
export async function GET(request){
  const secret=process.env.CRON_SECRET;
  const digest=s=>createHash('sha256').update(s).digest();
  if(!secret||!timingSafeEqual(digest(request.headers.get('authorization')||''),digest(`Bearer ${secret}`)))return Response.json({error:'Unauthorized'},{status:401});
  const app=await getRuntime();if(app.db.kind!=='postgres')return Response.json({error:'Cloud mode required'},{status:503});
  await app.db.context(async()=>{
    await createCloudUploads().cleanup(app.db);
    const waiting=await app.db.prepare("SELECT DISTINCT b.workspace_id FROM batch_items i JOIN batches b ON b.id=i.batch_id WHERE i.status IN ('pending','processing') UNION SELECT DISTINCT j.workspace_id FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.score_version!=j.version AND a.score_error IS NULL").all();
    for(const row of waiting)await app.db.prepare("INSERT INTO workflow_outbox(workspace_id,requested_at) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET dispatched_at=CASE WHEN workflow_outbox.dispatched_at<? THEN NULL ELSE workflow_outbox.dispatched_at END").run(row.workspace_id,new Date().toISOString(),new Date(Date.now()-5*60000).toISOString());
    await dispatchWork(app);
  });return Response.json({ok:true});
}
