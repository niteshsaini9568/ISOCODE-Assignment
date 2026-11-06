import test from 'node:test';
import assert from 'node:assert/strict';
import { sendPasswordReset } from '../server/mail.js';
test('production password recovery uses server mail credentials and handles delivery failures',async()=>{
  const previous={key:process.env.RESEND_API_KEY,from:process.env.MAIL_FROM},originalFetch=globalThis.fetch;
  try{
    delete process.env.RESEND_API_KEY;delete process.env.MAIL_FROM;await assert.rejects(sendPasswordReset('test@example.com','https://app.example.com/reset'),/not configured/);
    process.env.RESEND_API_KEY='synthetic-mail-key';process.env.MAIL_FROM='Shortlist <reset@example.com>';
    globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');const body=JSON.parse(options.body);assert.deepEqual(body.to,['test@example.com']);assert(body.text.includes('https://app.example.com/reset'));assert.equal(options.headers.Authorization,'Bearer synthetic-mail-key');return Response.json({id:'synthetic'});};
    await sendPasswordReset('test@example.com','https://app.example.com/reset');
    globalThis.fetch=async()=>new Response('private provider error',{status:500});await assert.rejects(sendPasswordReset('test@example.com','https://app.example.com/reset'),/could not be sent/);
    globalThis.fetch=async()=>{throw Error('Network failure');};await assert.rejects(sendPasswordReset('test@example.com','https://app.example.com/reset'),/could not be sent/);
  }finally{globalThis.fetch=originalFetch;for(const [name,value] of [['RESEND_API_KEY',previous.key],['MAIL_FROM',previous.from]])if(value===undefined)delete process.env[name];else process.env[name]=value;}
});
