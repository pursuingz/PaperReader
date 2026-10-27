import {lstat,open,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import type {LibraryActivity} from '../shared/types'
import type {PaperStore} from './storage'
import {validId} from './validation'
const MAX_BYTES=2*1024*1024,MAX_PAPERS=10000,NAME='library-activity.json'
function record(value:unknown):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))throw Error('Invalid library activity object')}
export function validateLibraryActivity(value:unknown):asserts value is LibraryActivity{
 record(value);if(Reflect.ownKeys(value).some(key=>key!=='version'&&key!=='lastOpenedAt')||value.version!==1)throw Error('Invalid library activity fields or version')
 record(value.lastOpenedAt);const entries=Object.entries(value.lastOpenedAt);if(entries.length>MAX_PAPERS)throw Error('Library activity paper limit exceeded')
 for(const [id,time]of entries){validId(id);if(id==='demo-workspace'||typeof time!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time)||!Number.isFinite(Date.parse(time))||new Date(time).toISOString()!==time)throw Error('Invalid library activity timestamp')}
}
/** Successful opens are a separate sidecar; old library/state files never change. */
export class LibraryActivityStore{
 private tail:Promise<unknown>=Promise.resolve()
 constructor(private readonly papers:Pick<PaperStore,'root'|'list'|'atomicJson'>,private readonly clock:()=>Date=()=>new Date()){}
 async flush():Promise<void>{await this.tail}
 private async read():Promise<LibraryActivity>{
  const file=join(this.papers.root,NAME);let exists=false
  try{const info=await lstat(file);exists=true;if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_BYTES)throw Error('Invalid activity file size or type')
   const handle=await open(file,'r');let text='';try{const bytes=Buffer.alloc(MAX_BYTES+1);let length=0;while(length<bytes.length){const next=await handle.read(bytes,length,bytes.length-length,length);if(!next.bytesRead)break;length+=next.bytesRead}if(length>MAX_BYTES)throw Error('Activity file too large');text=bytes.subarray(0,length).toString('utf8')}finally{await handle.close()}
   const value:unknown=JSON.parse(text);validateLibraryActivity(value);return value
  }catch(error){if(exists||(error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('Library activity is damaged or invalid. Existing files are protected; retry after recovery.')
   const names=await readdir(this.papers.root).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error})
   if(names.some(name=>name.startsWith(NAME+'.backup-')||name.startsWith(NAME+'.tmp-')))throw Error('Activity primary is missing. Retained recovery files are protected.')
   return{version:1,lastOpenedAt:{}}
  }
 }
 async load():Promise<LibraryActivity>{await this.tail;return this.read()}
 async record(paperId:string):Promise<LibraryActivity>{validId(paperId);const pending=this.tail.then(async()=>{
  const papers=await this.papers.list();if(paperId==='demo-workspace'||!papers.some(paper=>paper.id===paperId&&!paper.isDemo))throw Error('Open activity requires a real paper; paper not found.')
  const previous=await this.read(),value:LibraryActivity={version:1,lastOpenedAt:{...previous.lastOpenedAt,[paperId]:this.clock().toISOString()}};validateLibraryActivity(value)
  if(Buffer.byteLength(JSON.stringify(value),'utf8')>MAX_BYTES)throw Error('Library activity size limit exceeded')
  await this.papers.atomicJson(join(this.papers.root,NAME),value);return structuredClone(value)
 });this.tail=pending.catch(()=>undefined);return pending}
}
