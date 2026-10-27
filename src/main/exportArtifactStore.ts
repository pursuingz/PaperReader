import {createHash,randomUUID} from 'node:crypto'
import {mkdir,lstat,readFile,readdir,realpath} from 'node:fs/promises'
import {basename,extname,join,resolve} from 'node:path'
import {agentId,ownedAgentPath,readAgentJson,writeAgentJson} from './agentStorage'
import {exact,boundedText} from './agentValidation'
import {assertExportLocation} from './exportLocationPolicy'
import type {ExportArtifactFileInfo} from '../shared/agentArtifactTypes'
interface ArtifactFile {path:string;name:string;byteLength:number;sha256:string;format:'pdf'|'png'|'md'}
interface ArtifactRecord {version:1;id:string;paperId:string;files:ArtifactFile[];createdAt:string}
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const same=(a:string,b:string)=>process.platform==='win32'?resolve(a).toLowerCase()===resolve(b).toLowerCase():resolve(a)===resolve(b)
export class ExportArtifactStore{
 constructor(private root:string,private protectedRoots:()=>Promise<string[]>){ }
 private async checkedFile(path:string):Promise<{bytes:Buffer;format:'pdf'|'png'|'md'}>{
  if(typeof path!=='string'||path.length>32760)throw Error('Invalid exported artifact path')
  const format=extname(path).slice(1).toLowerCase();if(!['pdf','png','md'].includes(format))throw Error('Unsupported export artifact format')
  await assertExportLocation(path,await this.protectedRoots())
  const before=await lstat(path);if(!before.isFile()||before.isSymbolicLink()||before.size<1||before.size>200*1024*1024||!same(await realpath(path),path))throw Error('Exported file is unavailable or changed')
  const bytes=await readFile(path),after=await lstat(path)
  if(bytes.length!==before.size||after.size!==before.size||after.ino!==before.ino||after.dev!==before.dev||after.mtimeMs!==before.mtimeMs||!after.isFile()||after.isSymbolicLink())throw Error('Exported file changed while opening')
  return{bytes,format:format as 'pdf'|'png'|'md'}
 }
 async register(paperId:string,paths:readonly string[]):Promise<string>{
  agentId(paperId);if(!Array.isArray(paths)||!paths.length||paths.length>200||new Set(paths).size!==paths.length)throw Error('Invalid exported artifact selection')
  const files:ArtifactFile[]=[];let total=0
  for(const path of paths){const {bytes,format}=await this.checkedFile(path);total+=bytes.length;if(total>512*1024*1024)throw Error('Export artifact batch exceeds its resource limit');const name=basename(path).replace(/--[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?=\.[a-z]+$)/i,'');files.push({path:resolve(path),name,format,byteLength:bytes.length,sha256:hash(bytes)})}
  const directory=join(this.root,'export-artifacts');await ownedAgentPath(this.root,directory);await mkdir(directory,{recursive:true});if((await readdir(directory)).filter(name=>name.endsWith('.json')).length>=1000)throw Error('Export artifact history quota reached')
  const id=randomUUID(),record:ArtifactRecord={version:1,id,paperId,files,createdAt:new Date().toISOString()};await writeAgentJson(this.root,join(directory,id+'.json'),record,true);return id
 }
 private async read(id:string,paperId:string):Promise<ArtifactRecord>{
  agentId(id);agentId(paperId);const value=await readAgentJson(this.root,join(this.root,'export-artifacts',id+'.json'),8*1024*1024)
  exact(value,['version','id','paperId','files','createdAt']);if(value.version!==1||value.id!==id||value.paperId!==paperId)throw Error('Export artifact paper owner does not match');boundedText(value.createdAt,40)
  if(!Array.isArray(value.files)||!value.files.length||value.files.length>200)throw Error('Invalid saved export artifacts')
  for(const file of value.files){exact(file,['path','name','format','byteLength','sha256']);boundedText(file.path,32760);boundedText(file.name,512);if(!['pdf','png','md'].includes(file.format as string)||!Number.isSafeInteger(file.byteLength)||(file.byteLength as number)<1||(file.byteLength as number)>200*1024*1024||typeof file.sha256!=='string'||! /^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid saved export artifact')}
  return value as unknown as ArtifactRecord
 }
 async files(id:string,paperId:string):Promise<ExportArtifactFileInfo[]>{return(await this.read(id,paperId)).files.map((file,index)=>({index,name:file.name,byteLength:file.byteLength,format:file.format}))}
 async resolve(id:string,paperId:string,index:number):Promise<string>{
  const record=await this.read(id,paperId);if(!Number.isInteger(index)||index<0||index>=record.files.length)throw Error('Choose an owned export file index');const file=record.files[index],{bytes,format}=await this.checkedFile(file.path)
  if(format!==file.format||bytes.length!==file.byteLength||hash(bytes)!==file.sha256)throw Error('Exported file changed or is unavailable; existing file was preserved')
  return file.path
 }
}