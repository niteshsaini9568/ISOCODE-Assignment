'use client';
import { useEffect, useState } from 'react';
import { Check, Info, ShieldCheck, Sparkles } from 'lucide-react';

export default function AiSettings({act,onSaved,onboarding=false}) {
  const [apiKey,setApiKey]=useState(''),[saveError,setSaveError]=useState('');
  const [settings,setSettings]=useState(null),[provider,setProvider]=useState('gemini'),[model,setModel]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function load() {
    const response=await fetch('/api/settings/ai');const data=await response.json();
    if(response.status===401){window.location.assign('/login');return;}
    if(!response.ok)throw new Error(data.error||'Could not load AI settings');
    setSettings(data);setProvider(data.selection.provider);setModel(data.selection.model);
  }
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  if(error)return <div className="alert error" role="alert">{error}</div>;
  if(!settings)return <div className="empty">Loading provider settings…</div>;
  const selected=settings.providers.find(p=>p.id===provider);
  async function save(event) {
    event.preventDefault();setBusy(true);setSaveError('');
    const work=async()=>{
      const response=await fetch('/api/settings/ai',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider,model,...apiKey.trim()?{apiKey:apiKey.trim()}:{}})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not save provider');
      setSettings(data);setApiKey('');
      if(onboarding){if(!data.enabled)throw new Error('Add an API key to start your workspace.');window.location.assign('/dashboard');}else await onSaved?.();
    };
    try{if(act)await act(work,'AI provider saved. Existing scores are unchanged.');else await work();}catch(e){setSaveError(e.message);}finally{setBusy(false);}
  }
  return <section className="panel ai-settings"><div className="panel-heading"><div><h2>Choose your AI provider</h2><p className="field-note">Use the selected provider for JD extraction, CV parsing and scoring.</p></div><Sparkles size={20}/></div>
    <form onSubmit={save}><fieldset className="provider-fields" disabled={busy}><legend className="sr-only">Provider and API credentials</legend>
    <div className="provider-options" role="radiogroup" aria-label="AI provider">{settings.providers.map(p=><label key={p.id} className={`provider-option ${p.id===provider?'selected':''}`}><div className="row between"><span className="row"><input type="radio" name="ai-provider" value={p.id} checked={provider===p.id} onChange={()=>{setProvider(p.id);setModel(p.defaultModel);setApiKey('');setSaveError('');}}/>{p.name}</span><span className={`badge ${p.configured?'green':''}`}>{p.configured?'Connected':'Key needed'}</span></div><code>{p.defaultModel}</code><p>{p.description}</p></label>)}</div>
    <label>Model<input value={model} onChange={e=>setModel(e.target.value)} spellCheck={false} autoComplete="off" placeholder={selected.defaultModel} maxLength={120} required/></label><button type="button" className="text-button" onClick={()=>setModel(selected.defaultModel)}>Use recommended default: {selected.defaultModel}</button>
    <label htmlFor="provider-api-key">{selected.name} API key<input id="provider-api-key" type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="none" placeholder={selected.configured?'Leave blank to keep the configured key':'Paste your API key'} minLength={10} maxLength={512} required={onboarding&&!selected.configured} aria-describedby="provider-key-note"/></label>
    <p className="field-note" id="provider-key-note">{selected.ownKey?'Your workspace key is saved. Enter a new key to replace it.':selected.configured?'A server key is available. Add your own key to use your provider account.':'Use a key from your provider account with access to this model.'} A small test request checks new keys before saving. Usage is billed to that provider account.</p>
    <div className="notice"><ShieldCheck size={17}/><span>Your key is encrypted on the server and never shown again. Candidate data is sent only with consent for the selected provider.</span></div>
    {!selected.pdf&&<div className="notice"><Info size={17}/><span>This model processes text only. Scanned PDFs wait for a verified transcript; we never send them to another provider automatically.</span></div>}
    {!onboarding&&<p className="field-note">Changes apply to new work and explicit scoring retries. Existing scores keep their original provider and model. Candidate consent must cover the selected provider before CV data is sent. Wait for active processing to finish before switching.</p>}
    {saveError&&<div className="alert error" role="alert">{saveError}</div>}
    <button className="button primary" type="submit" disabled={busy||!model.trim()||(onboarding&&!selected.configured&&!apiKey.trim())}><Check size={16}/>{busy?'Checking and saving…':onboarding?'Save & open dashboard':'Save provider & model'}</button>
    </fieldset></form>
  </section>;
}
