import { readFile,unlink } from 'node:fs/promises';
import { get,del,head,issueSignedToken,presignUrl } from '@vercel/blob';
import { fail } from './domain.js';

export const localFiles={read:readFile,remove:unlink};
export const blobFiles={
  async read(pathname){
    const result=await get(pathname,{access:'private',useCache:false});if(!result||result.statusCode!==200)fail(404,'CV file not found');
    const reader=result.stream.getReader(),chunks=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024){await reader.cancel();fail(413,'CV exceeds 8 MB');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
    return Buffer.concat(chunks);
  },
  remove:pathname=>del(pathname),removeMany:pathnames=>del(pathnames),head,
  async download(pathname){
    const validUntil=Date.now()+60000;
    const token=await issueSignedToken({pathname,operations:['get'],validUntil});
    return (await presignUrl(token,{operation:'get',pathname,access:'private',validUntil,useCache:false})).presignedUrl;
  }
};
