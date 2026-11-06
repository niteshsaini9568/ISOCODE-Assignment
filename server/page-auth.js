import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
async function getRuntime(){return (await import('./runtime.js')).getRuntime();}

export async function pageUser(){const jar=await cookies();if(!jar.get('shortlist_session')?.value)return null;const runtime=await getRuntime();return runtime.sessionUser({headers:{cookie:jar.toString()}});}
export async function dashboardUser(){
  const user=await pageUser();if(!user)redirect('/login');
  if(user.role==='recruiter'&&!await (await getRuntime()).providerReady(user))redirect('/setup/provider');return user;
}
