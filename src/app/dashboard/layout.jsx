import { dashboardUser } from '../../../server/page-auth.js';
export const dynamic='force-dynamic';
export default async function Layout({children}){await dashboardUser();return children;}
