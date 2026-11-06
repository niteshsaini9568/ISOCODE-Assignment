import { readFile } from 'node:fs/promises';
import { openPostgres } from '../server/postgres.js';
export async function migrate(db){
  await db.context(async()=>{
    await db.exec('BEGIN');
    try{await db.lock('schema');await db.exec(await readFile(new URL('../server/postgres-schema.sql',import.meta.url),'utf8'));await db.exec('COMMIT');}
    catch(error){await db.exec('ROLLBACK');throw error;}
  });
}
if(process.argv[1]&&import.meta.url===(await import('node:url')).pathToFileURL(process.argv[1]).href){const db=openPostgres();try{await migrate(db);console.log('PostgreSQL schema is ready. No demo accounts created.');}finally{await db.close();}}
