'use client';
import Link from 'next/link';
import Brand from '../../../components/Brand.jsx';
import AiSettings from '../../../components/AiSettings.jsx';

export default function ProviderSetup(){
  return <div className="provider-setup-page"><header className="auth-header"><Link href="/" aria-label="Shortlist home"><Brand/></Link><button className="text-button" onClick={async()=>{const response=await fetch('/api/auth/logout',{method:'POST'});if(response.ok)window.location.assign('/login');}}>Sign out</button></header><main className="provider-setup-main"><ol className="setup-steps" aria-label="Workspace setup"><li>1. Sign in</li><li aria-current="step">2. Connect AI</li><li>3. Dashboard</li></ol><div className="provider-setup-heading"><span className="eyebrow">YOUR WORKSPACE, YOUR PROVIDER</span><h1>Connect AI to start screening.</h1><p>Choose a provider and add your API key. We’ve selected a default model for each, so you can get straight to your first shortlist.</p></div><AiSettings onboarding/></main></div>;
}
