import App from '../../../App.jsx';
import { dashboardUser } from '../../../../server/page-auth.js';
import { redirect } from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}){const user=await dashboardUser(),{section}=await params,query=await searchParams;const page=section?.[0]||'overview',allowed=user.role==='client'?['overview','portal','pipeline']:['overview','scorecard','upload','ranked','pipeline','governance'];if(section?.length>1||!allowed.includes(page))redirect('/dashboard');return <App initialPage={page} initialJob={typeof query.job==='string'?query.job:undefined} initialCreate={query.new==='1'}/>;}
