import AuthForm from '../../components/AuthForm.jsx';
import { pageUser } from '../../../server/page-auth.js';
import { redirect } from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Page(){const user=await pageUser();if(user)redirect(user.role==='recruiter'?'/setup/provider':'/dashboard');return <AuthForm mode="login"/>;}
