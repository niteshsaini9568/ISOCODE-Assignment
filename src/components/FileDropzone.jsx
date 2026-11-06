// Adapted from joyco's File Dropzone, retrieved through the 21st.dev MCP.
import { useRef, useState } from 'react';
import { FileText, UploadCloud, X } from 'lucide-react';
export default function FileDropzone({files,setFiles,disabled}) {
  const input=useRef(null), [dragging,setDragging]=useState(false),[error,setError]=useState('');
  function add(incoming) {
    const next=[...files,...Array.from(incoming)];
    if(next.length>500)return setError('Select up to 500 CVs per batch.');
    if(next.some(f=>! /\.(pdf|docx)$/i.test(f.name)))return setError('Only PDF and DOCX files are supported.');
    if(next.some(f=>f.size>8*1024*1024))return setError('Each CV must be 8 MB or smaller.');
    if(next.reduce((s,f)=>s+f.size,0)>100*1024*1024)return setError('Batch exceeds 100 MB. Split into smaller batches.');
    setError('');setFiles(next);
  }
  return <div><div className={`dropzone ${dragging?'dragging':''}`} onDragOver={e=>{e.preventDefault();if(!disabled)setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);if(!disabled)add(e.dataTransfer.files);}}>
    <input ref={input} className="sr-only" type="file" accept=".pdf,.docx" multiple disabled={disabled} aria-label="Select CV files" onChange={e=>{add(e.target.files);e.target.value='';}}/>
    <div className="upload-icon"><UploadCloud size={30} strokeWidth={1.4}/></div><h3>Add CVs to this requisition</h3><p>Drag and drop a batch of CVs, or browse your files.</p><button className="button primary" disabled={disabled} onClick={()=>input.current.click()}>Choose CVs <span>↗</span></button><small>PDF & DOCX · 8 MB per file · Up to 500 CVs · 100 MB per batch</small>
  </div>{error&&<p className="error" role="alert">{error}</p>}{files.length>0&&<div className="selected-files"><div className="row between"><strong>{files.length} files ready</strong><button className="text-button" disabled={disabled} onClick={()=>setFiles([])}>Clear all</button></div>{files.slice(0,8).map((file,i)=><div className="file-row" key={`${file.name}-${i}`}><FileText size={18}/><span>{file.name}</span><small>{(file.size/1024).toFixed(0)} KB</small><button aria-label={`Remove ${file.name}`} disabled={disabled} onClick={()=>setFiles(files.filter((_,n)=>n!==i))}><X size={15}/></button></div>)}{files.length>8&&<small>and {files.length-8} more files</small>}</div>}</div>;
}
