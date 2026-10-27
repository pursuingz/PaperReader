import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { LiteratureIdentity, ReferenceAcquisition } from '../shared/agentTypes'
import { LiteratureService, LiteratureVersionConflictError } from './literatureService'
import { LiteratureError } from './literatureErrors'
import { agentId, readAgentJson, writeAgentJson } from './agentStorage'
import { plain } from './agentValidation'

type AcquisitionRecord=ReferenceAcquisition&{identityRevision:string}
export class LiteratureAcquisitionService {
 private active=new Set<string>()
 private listeners=new Set<(record:ReferenceAcquisition)=>void>()
 constructor(private root:string,private literature:LiteratureService,private readReference:(sourcePaperId:string,referenceId:string)=>Promise<LiteratureIdentity>){}
 subscribe(listener:(record:ReferenceAcquisition)=>void):()=>void{this.listeners.add(listener);return()=>this.listeners.delete(listener)}
 private file(paperId:string,referenceId:string){return join(this.root,'reference-acquisitions',agentId(paperId),agentId(referenceId)+'.json')}
 private async publish(record:AcquisitionRecord){record.updatedAt=new Date().toISOString();await writeAgentJson(this.root,this.file(record.sourcePaperId,record.referenceId),record);const {identityRevision:_revision,...publicRecord}=record;for(const listener of this.listeners){try{listener(structuredClone(publicRecord))}catch{}}}
 private async saved(paperId:string,referenceId:string):Promise<AcquisitionRecord|null>{const value=await readAgentJson(this.root,this.file(paperId,referenceId));if(value===null)return null;if(!plain(value)||value.version!==1||value.sourcePaperId!==paperId||value.referenceId!==referenceId||!Array.isArray(value.candidates)||value.candidates.length>50||!['searching','waiting-selection','downloading','importing','imported','already-in-library','unavailable','failed'].includes(value.status as string)||typeof value.identityRevision!=='string')throw Error('Reference acquisition record is corrupt; original preserved');return value as unknown as AcquisitionRecord}
 async load(paperId:string,referenceId:string):Promise<ReferenceAcquisition|null>{const identity=await this.readReference(agentId(paperId),agentId(referenceId));const result=await this.saved(paperId,referenceId);if(!result||createHash('sha256').update(JSON.stringify(identity)).digest('hex')!==result.identityRevision)return null;if(!this.active.has(paperId+':'+referenceId)&&['searching','downloading','importing'].includes(result.status)){result.status='failed';result.error='Reference acquisition was interrupted. Retry explicitly; no network request starts on open.';await this.publish(result)}const {identityRevision:_revision,...record}=result;return structuredClone(record)}
 async run(sourcePaperId:string,referenceId:string,signal:AbortSignal,selectionId?:string):Promise<ReferenceAcquisition>{
  agentId(sourcePaperId);agentId(referenceId);if(selectionId)agentId(selectionId);const key=sourcePaperId+':'+referenceId;if(this.active.has(key))throw Error('Reference acquisition already active');this.active.add(key)
  try{return await this.runOwned(sourcePaperId,referenceId,signal,selectionId)}finally{this.active.delete(key)}
 }
 private async runOwned(sourcePaperId:string,referenceId:string,signal:AbortSignal,selectionId?:string):Promise<ReferenceAcquisition>{
  const identity=await this.readReference(sourcePaperId,referenceId),identityRevision=createHash('sha256').update(JSON.stringify(identity)).digest('hex'),previous=await this.saved(sourcePaperId,referenceId)
  if(previous?.identityRevision!==identityRevision&&selectionId)throw Error('Reference changed after candidate selection; search again')
  if(previous?.identityRevision===identityRevision&&['imported','already-in-library'].includes(previous.status)){const {identityRevision:_revision,...done}=previous;return done}
  const record:AcquisitionRecord=previous?.identityRevision===identityRevision?previous:{version:1,sourcePaperId,referenceId,status:'searching',candidates:[],updatedAt:new Date().toISOString(),identityRevision}
  if(selectionId&&!record.candidates.some(c=>c.id===selectionId&&c.provider==='arxiv'&&c.assessment!=='conflict'))throw Error('Selection is not an owned non-conflicting candidate')
  try{
   if(signal.aborted)throw Error('Reference acquisition cancelled')
   if(!selectionId){record.status='searching';record.error=undefined;await this.publish(record);const query=identity.title??identity.doi??identity.arxivId;if(!query)throw Error('Reference lacks a usable title or identifier');record.candidates=await this.literature.search({query,provider:'arxiv',limit:20,identity},signal)}
   const matches=record.candidates.filter(c=>c.provider==='arxiv'&&c.assessment==='consistent'),chosen=selectionId?record.candidates.find(c=>c.id===selectionId):matches.length===1?matches[0]:undefined
   if(!chosen){record.status=record.candidates.some(c=>c.provider==='arxiv'&&c.assessment!=='conflict')?'waiting-selection':'unavailable';if(record.status==='unavailable')record.error='paper unavailable';await this.publish(record);const {identityRevision:_revision,...result}=record;return structuredClone(result)}
   record.status='downloading';await this.publish(record)
   const receipt=await this.literature.acquire(chosen,signal,async stage=>{record.status=stage;await this.publish(record)},{allowNewVersion:!!selectionId})
   const current=await this.readReference(sourcePaperId,referenceId);if(createHash('sha256').update(JSON.stringify(current)).digest('hex')!==identityRevision){record.status='failed';record.error='Source reference changed while importing. The imported paper was retained without claiming a current reference match.';record.receipt=receipt;await this.publish(record);const {identityRevision:_revision,...result}=record;return result}
   record.receipt=receipt;record.importedPaperId=receipt.paperId;record.status=receipt.status==='already-in-library'?'already-in-library':'imported';record.error=undefined;await this.publish(record)
  }catch(error){if(error instanceof LiteratureVersionConflictError){record.status='waiting-selection';record.error='Different version already in library. Select this candidate to retain the old version and import a separate paper.'}else{record.status=error instanceof LiteratureError&&error.code==='not-found'?'unavailable':'failed';record.error=signal.aborted?'Reference acquisition cancelled. Existing successful imports remain in the library.':error instanceof LiteratureError?error.message:'Reference acquisition failed. Prior candidates and imports were preserved; retry explicitly.'}await this.publish(record)}
  const {identityRevision:_revision,...result}=record;return structuredClone(result)
 }
}
