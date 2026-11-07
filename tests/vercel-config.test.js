import test from 'node:test';
import assert from 'node:assert/strict';
import { openPostgres } from '../server/postgres.js';
import { getRuntime } from '../server/runtime.js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('Vercel applies and verifies the cloud schema before building',()=>{
  const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.equal(config.buildCommand,'npm run migrate:cloud && npm run check:cloud && npm run build');
});

test('Vercel refuses missing durable storage and rejects known transaction-pooler URLs',async()=>{
  const names=['VERCEL','DATABASE_URL','DATABASE_URL_UNPOOLED'],previous=Object.fromEntries(names.map(n=>[n,process.env[n]])),runtime=globalThis.__shortlistRuntime;
  try{
    process.env.VERCEL='1';delete process.env.DATABASE_URL;delete process.env.DATABASE_URL_UNPOOLED;globalThis.__shortlistRuntime=null;
    await assert.rejects(getRuntime(),/Configure DATABASE_URL/);
    assert.throws(()=>openPostgres('postgresql://user:pass@ep-example-pooler.us-east-2.aws.neon.tech/app'),/direct PostgreSQL/);
  }finally{globalThis.__shortlistRuntime=runtime;for(const n of names)if(previous[n]===undefined)delete process.env[n];else process.env[n]=previous[n];}
});

test('hosted backend can import without the optional local SQLite module',()=>{
  const script=`import {registerHooks} from 'node:module';registerHooks({resolve(specifier,context,nextResolve){if(specifier==='node:sqlite')throw new Error('SQLite unavailable in this hosting runtime');return nextResolve(specifier,context);}});await import('./server/runtime.js');console.log('cloud-import-ok');`;
  assert.match(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'}),/cloud-import-ok/);
});
