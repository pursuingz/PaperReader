import { createHash } from 'node:crypto'
import { lstat, mkdir, open, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AIImageData, AIImageInput, AIImageReference } from '../shared/aiSourceTypes'
import { AI_IMAGE_BYTES_LIMIT } from '../shared/aiSourceTypes'
import { validateAIImageOrigin, validateAIImageReference } from './aiSourceValidation'
import { validId } from './validation'
export type AIImageDecoder=(bytes:Uint8Array)=>{width:number;height:number}
export const imageSha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
export function imageMedia(bytes:Uint8Array):'image/png'|'image/jpeg'{const b=Buffer.from(bytes);if(b.length>=24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&b.toString('ascii',12,16)==='IHDR')return 'image/png';if(b.length>4&&b[0]===255&&b[1]===216&&b[2]===255&&b.at(-2)===255&&b.at(-1)===217)return 'image/jpeg';throw Error('AI image must contain valid PNG or JPEG bytes')}
async function bounded(path:string,limit:number){const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>limit)throw Error('Invalid immutable AI image file');const handle=await open(path,'r');try{const current=await handle.stat();if(current.size!==info.size)throw Error('AI image changed while reading');const buffer=Buffer.alloc(info.size+1);let offset=0;while(offset<buffer.length){const r=await handle.read(buffer,offset,buffer.length-offset,offset);if(!r.bytesRead)break;offset+=r.bytesRead}if(offset!==info.size)throw Error('AI image changed while reading');return buffer.subarray(0,offset)}finally{await handle.close()}}
function encodedDimensions(bytes:Uint8Array,mime:string){
 const b=Buffer.from(bytes);if(mime==='image/png')return {width:b.readUInt32BE(16),height:b.readUInt32BE(20)}
 let i=2;while(i<b.length-3){if(b[i++]!==255)throw Error('Invalid JPEG image');while(b[i]===255)i++;const marker=b[i++];if(marker===217||marker===218)break;if(marker===1||(marker>=208&&marker<=215))continue;const length=b.readUInt16BE(i);if(length<2||i+length>b.length)throw Error('Invalid JPEG image');if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(length<8)throw Error('Invalid JPEG frame');return {height:b.readUInt16BE(i+3),width:b.readUInt16BE(i+5)}}i+=length}throw Error('Invalid JPEG dimensions')
}
const canonical=(v:any):string=>v&&typeof v==='object'&&!Array.isArray(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v)
export class AIImageStore {
 private tail:Promise<unknown>=Promise.resolve()
 constructor(private readonly root:string,private readonly requirePaper:(id:string)=>Promise<void>,private readonly decode?:AIImageDecoder){}
 async flush():Promise<void>{await this.tail}
 private async directory(paperId:string){validId(paperId);await this.requirePaper(paperId);const parts=[join(this.root,'papers'),join(this.root,'papers',paperId),join(this.root,'papers',paperId,'ai-images')];for(const path of parts){try{const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Invalid AI image storage directory')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}}return parts[2]}
 private inspect(bytes:Uint8Array){if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>AI_IMAGE_BYTES_LIMIT)throw Error('AI image exceeds the 10 MiB limit');const mimeType=imageMedia(bytes);const encoded=encodedDimensions(bytes,mimeType);if(encoded.width<1||encoded.height<1||encoded.width>4096||encoded.height>4096||encoded.width*encoded.height>16000000)throw Error('AI image dimensions exceed the pixel limit');if(!this.decode)throw Error('AI image decoder unavailable');const dimensions=this.decode(bytes);if(!dimensions||!Number.isInteger(dimensions.width)||!Number.isInteger(dimensions.height)||dimensions.width<1||dimensions.height<1||dimensions.width>4096||dimensions.height>4096||dimensions.width*dimensions.height>16000000)throw Error('AI image dimensions exceed 4096 side or 16M pixels');if(dimensions.width!==encoded.width||dimensions.height!==encoded.height)throw Error('Decoded AI image dimensions do not match its bytes');return {...dimensions,mimeType}}
 save(paperId:string,input:AIImageInput):Promise<AIImageReference>{
  try {
   if(!input||Object.keys(input).some(k=>!['bytes','origin'].includes(k))||!(input.bytes instanceof Uint8Array)||!input.bytes.length||input.bytes.length>AI_IMAGE_BYTES_LIMIT)throw Error('Invalid AI image input or 10 MiB image limit exceeded')
   validateAIImageOrigin(input.origin)
  } catch(error){return Promise.reject(error)}
  const frozen=structuredClone(input)
  const next=this.tail.then(async()=>{
   const bytes=Buffer.from(frozen.bytes),metadata=this.inspect(bytes),directory=await this.directory(paperId)
   const digest=createHash('sha256').update(bytes).update(canonical(frozen.origin)).digest('hex')
   const imageId=digest.slice(0,8)+'-'+digest.slice(8,12)+'-4'+digest.slice(13,16)+'-8'+digest.slice(17,20)+'-'+digest.slice(20,32)
   const ref:AIImageReference={imageId,sha256:imageSha(bytes),...metadata,byteLength:bytes.length,origin:frozen.origin}
   validateAIImageReference(ref)
   const binPath=join(directory,imageId+'.bin'),metadataPath=join(directory,imageId+'.json')
   const existingReference=async()=>{const {bytes:_,...prior}=await this.read(paperId,imageId);if(canonical(prior)!==canonical(ref))throw Error('AI image identity conflict');return prior}
   let metadataExists=false
   try{await lstat(metadataPath);metadataExists=true}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
   if(metadataExists)return existingReference()
   await mkdir(directory,{recursive:true})
   try{await writeFile(binPath,bytes,{flag:'wx',mode:0o600})}
   catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error
    const retained=await bounded(binPath,AI_IMAGE_BYTES_LIMIT)
    if(retained.length!==ref.byteLength||imageSha(retained)!==ref.sha256||!retained.equals(bytes))throw Error('Retained AI image bytes conflict with this immutable image; originals are protected')
   }
   try{await writeFile(metadataPath,JSON.stringify({version:1,paperId,...ref}),{flag:'wx',mode:0o600})}
   catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;return existingReference()}
   return ref
  })
  this.tail=next.catch(()=>undefined);return next
 }

 async read(paperId:string,imageId:string):Promise<AIImageData>{validId(imageId);const directory=await this.directory(paperId);const raw=JSON.parse((await bounded(join(directory,`${imageId}.json`),16384)).toString('utf8'));const {version, paperId:owner,...ref}=raw;if(version!==1||owner!==paperId||ref.imageId!==imageId)throw Error('AI image owner does not match');validateAIImageReference(ref);const bytes=await bounded(join(directory,`${imageId}.bin`),AI_IMAGE_BYTES_LIMIT);if(imageSha(bytes)!==ref.sha256)throw Error('Immutable AI image bytes changed');const media=this.inspect(bytes);if(bytes.length!==ref.byteLength||imageSha(bytes)!==ref.sha256||media.mimeType!==ref.mimeType||media.width!==ref.width||media.height!==ref.height)throw Error('Immutable AI image bytes or metadata changed');return {...ref,bytes}}
}
