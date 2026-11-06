import { fail } from './domain.js';
export const mailConfigured=()=>Boolean(process.env.RESEND_API_KEY&&process.env.MAIL_FROM);
export async function sendPasswordReset(email,url){
  if(!mailConfigured())fail(503,'Password recovery email is not configured. Contact your workspace administrator.');
  let response;
  try{response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.MAIL_FROM,to:[email],subject:'Reset your Shortlist password',text:`Use this link to reset your password. It expires in 30 minutes.\n\n${url}\n\nIf you did not request this, ignore this email.`}),signal:AbortSignal.timeout(15000)});}catch{fail(503,'Password recovery email could not be sent. Please try again later.');}
  if(!response.ok)fail(503,'Password recovery email could not be sent. Please try again later.');
}
