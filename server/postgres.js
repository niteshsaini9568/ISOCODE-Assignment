import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { attachDatabasePool } from '@vercel/functions';

pg.types.setTypeParser(20,Number);
export function postgresSql(sql){
  let index=0;
  return sql.replace(/\?/g,()=>`$${++index}`).replace(/(\$\d+) IS NULL/g,'$1::text IS NULL').replace('SELECT value FROM json_each($2)','SELECT json_array_elements_text($2::json)').replace(/\bi\.rowid\b/g,'i.id');
}

export function openPostgres(connectionString=process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL){
  if(!connectionString)throw new Error('DATABASE_URL is required for cloud deployment.');
  if(new URL(connectionString).hostname.includes('-pooler.')||new URL(connectionString).searchParams.get('pgbouncer')==='true')throw new Error('Use a direct PostgreSQL connection for workspace session locks; set DATABASE_URL_UNPOOLED or use the direct URL as DATABASE_URL.');
  const pool=new pg.Pool({connectionString,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000,allowExitOnIdle:true});
  if(process.env.VERCEL)attachDatabasePool(pool);
  const context=new AsyncLocalStorage();
  const query=(sql,values=[])=>{
    const state=context.getStore(),args=[postgresSql(sql),values.map(v=>v===undefined?null:v)];
    if(!state)return pool.query(...args);
    if(state.closed)throw new Error('Request context is closed');
    const pending=state.tail.then(()=>state.client.query(...args));state.tail=pending.catch(()=>{});return pending;
  };
  return {
    kind:'postgres',pool,
    prepare(sql){return {
      get:async(...values)=>(await query(sql,values)).rows[0],
      all:async(...values)=>(await query(sql,values)).rows,
      run:async(...values)=>({changes:(await query(sql,values)).rowCount})
    };},
    exec:async sql=>{if(!sql.startsWith('PRAGMA'))await query(sql);},
    async context(work){
      if(context.getStore())return work();
      const client=await pool.connect();
      const state={client,tail:Promise.resolve(),closed:false};
      try{await client.query("SET idle_in_transaction_session_timeout='60s'");return await context.run(state,work);}finally{
        state.closed=true;await state.tail;
        // Release transactions and session locks even after an aborted HTTP request.
        await client.query('ROLLBACK').catch(()=>{});
        await client.query('SELECT pg_advisory_unlock_all()').catch(()=>{});client.release();
      }
    },
    lock:async workspace=>{await query('SELECT pg_advisory_lock(hashtextextended(?,0))',[`shortlist:${workspace}`]);},
    close:()=>pool.end()
  };
}
