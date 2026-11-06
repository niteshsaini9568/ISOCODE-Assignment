import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getRuntime } from './runtime.js';

export async function pageUser(){const runtime=await getRuntime();return runtime.sessionUser({headers:{cookie:(await cookies()).toString()}});}
export async function dashboardUser(){
  const user=await pageUser();if(!user)redirect('/login');
  if(user.role==='recruiter'&&!await (await getRuntime()).providerReady(user))redirect('/setup/provider');return user;
}
