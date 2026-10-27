import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

const pending = new Map<string, Promise<unknown>>()
export const agentId = (id: unknown): string => { if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id)) throw Error('Invalid identifier'); return id }
export async function ownedAgentPath(root: string, file: string): Promise<string> {
  const base=resolve(root), target=resolve(file), rel=relative(base,target)
  if (isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep)) throw Error('Invalid owned storage path')
  const parts=[base,...rel.split(sep).filter(Boolean).map((_p,i,all)=>resolve(base,...all.slice(0,i+1)))]
  for(const part of parts) { try { if((await lstat(part)).isSymbolicLink())throw Error('Symbolic links are not allowed in owned storage') }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error} }
  return target
}
export async function readAgentJson(root:string,file:string,max=4_000_000):Promise<unknown|null>{
 return serializeAgent(file,async()=>{await ownedAgentPath(root,file)
 try {const stat=await lstat(file);if(!stat.isFile()||stat.size>max)throw Error('Invalid storage size');return JSON.parse(await readFile(file,'utf8'))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw Error('Stored record is corrupt or invalid; its bytes were preserved')}})
}
export async function writeAgentJson(root:string,file:string,value:unknown,exclusive=false):Promise<void>{
 const task=(pending.get(file)??Promise.resolve()).catch(()=>{}).then(async()=>{
  await ownedAgentPath(root,file);await mkdir(dirname(file),{recursive:true});await ownedAgentPath(root,file)
  const bytes=JSON.stringify(value);if(Buffer.byteLength(bytes)>4_000_000)throw Error('Owned record exceeds storage budget')
  if(exclusive){await writeFile(file,bytes,{flag:'wx',mode:0o600});return}
  const temporary=file+'.'+randomUUID()+'.tmp';await writeFile(temporary,bytes,{flag:'wx',mode:0o600})
  await ownedAgentPath(root,file)
  try{const previous=await readFile(file);await writeFile(file+'.'+randomUUID()+'.bak',previous,{flag:'wx',mode:0o600})}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  await rename(temporary,file)
 });pending.set(file,task);try{await task}finally{if(pending.get(file)===task)pending.delete(file)}
}
export async function serializeAgent<T>(key:string,work:()=>Promise<T>):Promise<T>{
 const task=(pending.get(key)??Promise.resolve()).catch(()=>{}).then(work);pending.set(key,task)
 try{return await task}finally{if(pending.get(key)===task)pending.delete(key)}
}
