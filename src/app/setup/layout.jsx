import { pageUser } from '../../../server/page-auth.js';
import { redirect } from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Layout({children}){const user=await pageUser();if(!user)redirect('/login');if(user.role==='client')redirect('/dashboard');return children;}
