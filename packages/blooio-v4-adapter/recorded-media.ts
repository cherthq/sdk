import {validateMediaCapability} from '@chert/sdk';
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
/** Project one owned canonical media record; never fetch its URL or infer lifecycle. */
export function recordedMedia(parts:unknown,attachments:unknown,baseURL:string){
 if(!Array.isArray(parts)||!Array.isArray(attachments)||attachments.length!==1)return null;
 let caption:string|undefined;
 if(parts.length===2){
  const text=parts[0];
  if(!object(text)||Object.keys(text).sort().join(',')!=='type,value'||text.type!=='text'||typeof text.value!=='string'||!text.value.length||text.value.includes('\0')||new TextEncoder().encode(text.value).length>16384||new TextDecoder().decode(new TextEncoder().encode(text.value))!==text.value)return null;
  caption=text.value;
 }else if(parts.length!==1)return null;
 const media=parts.at(-1);
 if(!object(media)||Object.keys(media).sort().join(',')!=='attachment_id,type'||media.type!=='media'||typeof media.attachment_id!=='string')return null;
 const metadata=validateMediaCapability(attachments[0],media.attachment_id,baseURL);
 if(!metadata)return null;
 return{...(caption===undefined?{}:{text:caption}),attachments:[{url:metadata.download_url,media_type:metadata.content_type,size:metadata.size_bytes,...(caption===undefined?{}:{caption})}]};
}
