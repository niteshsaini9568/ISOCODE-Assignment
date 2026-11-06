import { upload } from '@vercel/blob/client';

export async function uploadCvs(jobId,files,consent,mode,api){
  if(mode!=='blob'){
    const body=new FormData();files.forEach(file=>body.append('cvs',file));
    return api(`/jobs/${jobId}/upload`,{method:'POST',body,headers:{'x-consent-source':consent.source,'x-consent-granted':String(consent.consent),'x-ai-consent':String(consent.aiProcessing),'x-ai-provider':consent.aiProvider}});
  }
  const session=await api(`/jobs/${jobId}/upload-session`,{method:'POST',body:JSON.stringify({...consent,files:files.map(f=>({name:f.name,size:f.size}))})});
  try{
    for(let offset=0;offset<files.length;offset+=4)await Promise.all(files.slice(offset,offset+4).map((file,index)=>{
      const manifest=session.files[offset+index];
      return upload(manifest.pathname,file,{access:'private',handleUploadUrl:'/api/blob/upload',contentType:manifest.contentType});
    }));
    return await api(`/upload-sessions/${session.id}/complete`,{method:'POST',body:'{}'});
  }catch(error){await api(`/upload-sessions/${session.id}`,{method:'DELETE'}).catch(()=>{});throw error;}
}
