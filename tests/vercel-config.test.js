import test from 'node:test';
import assert from 'node:assert/strict';
import { openPostgres } from '../server/postgres.js';
import { getRuntime } from '../server/runtime.js';

test('Vercel refuses missing durable storage and rejects known transaction-pooler URLs',async()=>{
  const names=['VERCEL','DATABASE_URL','DATABASE_URL_UNPOOLED'],previous=Object.fromEntries(names.map(n=>[n,process.env[n]])),runtime=globalThis.__shortlistRuntime;
  try{
    process.env.VERCEL='1';delete process.env.DATABASE_URL;delete process.env.DATABASE_URL_UNPOOLED;globalThis.__shortlistRuntime=null;
    await assert.rejects(getRuntime(),/Configure DATABASE_URL/);
    assert.throws(()=>openPostgres('postgresql://user:pass@ep-example-pooler.us-east-2.aws.neon.tech/app'),/direct PostgreSQL/);
  }finally{globalThis.__shortlistRuntime=runtime;for(const n of names)if(previous[n]===undefined)delete process.env[n];else process.env[n]=previous[n];}
});
