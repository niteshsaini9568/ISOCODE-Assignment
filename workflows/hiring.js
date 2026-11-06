export async function processNext(workspace){
  'use step';
  const { getRuntime }=await import('../server/runtime.js');
  const runtime=await getRuntime();
  return runtime.db.context(async()=>{
    await runtime.db.lock(workspace);
    // A step replay resumes work left processing by a terminated invocation.
    await runtime.db.prepare("UPDATE batch_items SET status='pending' WHERE status='processing' AND batch_id IN (SELECT id FROM batches WHERE workspace_id=?)").run(workspace);
    return runtime.worker.tick(workspace);
  });
}

export async function processHiring(workspace){
  'use workflow';
  while(await processNext(workspace)){}
}
