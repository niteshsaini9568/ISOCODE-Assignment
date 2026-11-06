import { start } from 'workflow/api';
import { processHiring } from '../workflows/hiring.js';

export async function dispatchWork(runtime){
  if(runtime.db.kind!=='postgres')return;
  const rows=await runtime.db.prepare('SELECT * FROM workflow_outbox WHERE dispatched_at IS NULL ORDER BY requested_at LIMIT 20').all();
  for(const row of rows){
    const run=await start(processHiring,[row.workspace_id]);
    await runtime.db.prepare('UPDATE workflow_outbox SET dispatched_at=?,run_id=? WHERE workspace_id=? AND requested_at=?').run(new Date().toISOString(),run.runId,row.workspace_id,row.requested_at);
  }
}
