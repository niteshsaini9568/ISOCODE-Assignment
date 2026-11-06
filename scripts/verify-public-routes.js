import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const port=Number(process.env.TEST_APP_PORT||5178),base=`http://127.0.0.1:${port}`,checks=[];
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{windowsHide:true,env:{...process.env,VERCEL:'1',DATABASE_URL:'',DATABASE_URL_UNPOOLED:'',CREDENTIALS_ENCRYPTION_KEY:'',BLOB_READ_WRITE_TOKEN:'',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:''}});
let logs='';child.stdout.on('data',chunk=>{logs+=chunk;});child.stderr.on('data',chunk=>{logs+=chunk;});
try{
  let ready=false;for(let i=0;i<120;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert(ready,'Production test server did not start');
  const home=await (await fetch(base)).text();assert(home.includes('href="/login"'));assert(home.includes('href="/signup"'));
  for(const path of ['/login','/signup','/login?from=home','/login','/signup']){const response=await fetch(base+path);assert.equal(response.status,200,path);assert((await response.text()).includes('YOUR HIRING WORKSPACE'));checks.push({path,status:200});}
  for(const path of ['/login','/signup']){const response=await fetch(base+path,{headers:{RSC:'1','Next-Url':'/'}});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/x-component/);await response.text();checks.push({path,type:'Next.js client navigation',status:200});}
  const privatePage=await fetch(base+'/dashboard',{redirect:'manual'});assert.equal(privatePage.status,307);assert.equal(privatePage.headers.get('location'),'/login');await privatePage.text();checks.push({path:'/dashboard',status:307});
  const health=await fetch(base+'/api/health');assert.equal(health.status,503);assert.match(health.headers.get('content-type'),/application\/json/);await health.json();checks.push({path:'/api/health',status:503,reason:'cloud configuration deliberately absent'});
  await writeFile('data/vercel-public-route-checks.json',JSON.stringify({checks},null,2));console.log(JSON.stringify({passed:checks.length,cloudConfiguration:'deliberately absent',protectedRoutes:'still enforced'}));
}finally{child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});await writeFile('data/vercel-public-route-server.log',logs);}
