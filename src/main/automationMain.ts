import { app,BrowserWindow,dialog,shell } from 'electron'
import { createHash,randomUUID } from 'node:crypto'
import { join,resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { PaperStore } from './storage'
import type { NotebookStore } from './notebookStore'
import type { DiagramStore } from './diagramStore'
import type { CanvasStore } from './canvasStore'
import type { AIImageStore } from './aiImageStore'
import type { ReferenceStore } from './referenceStore'
import type { GeneralChatStore } from './generalChatStore'
import { RenderJobBroker } from './renderJobBroker'
import { AgentCoordinator } from './agentCoordinator'
import { AgentTaskStore } from './agentTaskStore'
import { AgentChatStore } from './agentChatStore'
import { validateChatSourceScope,validateSavedChatBinding } from './chatTurnAccess'
import { extractLiteratureIdentity } from './literatureIdentity'
import { createAgentTools } from './agentTools'
import { importScannedPaperBatch } from './automationScanImport'
import { validateAgentInput,validateAgentOwner,AGENT_OPERATIONS,exact } from './agentValidation'
import { executeAgentDeepSeek } from './agentDeepSeek'
import { GeneratedNotesStore } from './generatedNotesStore'
import { LiteratureService,LiteratureVersionConflictError } from './literatureService'
import { PublicHttpClient,assertPublicUrl } from './literatureHttp'
import { LiteratureAcquisitionService } from './literatureAcquisition'
import { AutomationFileExportService } from './automationFileExport'
import { ExportArtifactStore } from './exportArtifactStore'
import { generateAutomationNotes } from './automationGeneration'
import { generatePaperSummary,resumePaperSummary,loadSummaryJob } from './summary'
import { askDeepSeek,AIJobs } from './deepseek'
import { LocalInputAssets } from './localInputAssets'
import { LocalSpeechService } from './localSpeech'
import { validateAIImages } from './aiSourceValidation'
import { imageSha } from './aiImageStore'
import { validId,object } from './validation'
import { readingExportFileName } from './readingExport'
import type { AgentCapabilities,AgentRunInput,AgentReanswerInput,AgentOwner,AgentContinueInput,AgentReceipt,LiteratureImportReceipt } from '../shared/agentTypes'
import type { AutomationRenderReply } from '../shared/renderJobTypes'
import type { AIImageReference,PaperState,SummaryLanguage } from '../shared/types'
import type { FileOperationGate } from './fileOperations'

interface Dependencies {
 store:PaperStore; notebookStore:NotebookStore; diagramStore:DiagramStore; canvasStore:CanvasStore; images:AIImageStore; references:ReferenceStore; general:GeneralChatStore; requests:AIJobs; files:FileOperationGate
 window():BrowserWindow|null; loadedUrl():string; model():string; key():string
}
export const textRevision=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex')
export class AutomationRuntime {
 readonly renderJobs:RenderJobBroker
 readonly assets:LocalInputAssets
 readonly speech:LocalSpeechService
 readonly drafts:GeneratedNotesStore
 readonly chatTurns:AgentChatStore
 readonly coordinator:AgentCoordinator
 readonly capabilities:AgentCapabilities
 readonly acquisitions:LiteratureAcquisitionService
 private exports:AutomationFileExportService
 private artifacts:ExportArtifactStore
 private taskStore:AgentTaskStore
 private grants=new Map<string,string>()
 private pendingClients=new Map<string,AbortController>()
 private startingRuns=new Set<AbortController>()
 private clients=new Map<string,{id:string;owner:AgentOwner}>()
 private active=new Set<Promise<unknown>>()
 private referenceControllers=new Set<AbortController>()
 readonly devices={microphone:false,camera:false}
 constructor(private d:Dependencies){
  this.renderJobs=new RenderJobBroker(job=>this.send('automation-render-job',job),id=>this.send('automation-render-cancel',id))
  this.assets=new LocalInputAssets({resourceDirectory:join(__dirname,'../local-input'),modelDirectory:join(d.store.root,'local-models')})
  this.speech=new LocalSpeechService({assets:this.assets})
  this.drafts=new GeneratedNotesStore(d.store.root,id=>this.requirePaper(id))
  const literature=new LiteratureService(new PublicHttpClient(),async(bytes,candidate,signal,options):Promise<LiteratureImportReceipt>=>{
   await this.ensureDirectory()
   const result=await d.store.importManagedBytes(bytes,readingExportFileName(candidate.title).replace(/-reading-notes\.md$/i,'.pdf'),{identifiers:{doi:candidate.doi,arxiv:candidate.arxivId},allowNewVersion:options?.allowNewVersion,signal})
   if(!result.paper)throw new LiteratureVersionConflictError(result.relatedPaperIds)
   if(result.status==='imported'&&candidate.title.length<=300&&candidate.authors.join('; ').length<=1000){
    await d.store.savePaperMetadata(result.paper.id,{title:candidate.title,authors:candidate.authors.join('; '),year:candidate.year??null})
   }
   this.libraryChanged()
   return {paperId:result.paper.id,status:result.status==='duplicate'?'already-in-library':'imported',title:result.paper.title,sha256:result.sha256,relatedPaperIds:result.relatedPaperIds}
  },d.store.root)
  this.capabilities=this.createCapabilities()
  this.artifacts=new ExportArtifactStore(d.store.root,async()=>[d.store.root,...await d.store.getManagedPdfDirectories()])
  this.exports=new AutomationFileExportService({registerArtifacts:(id,paths)=>this.artifacts.register(id,paths),store:d.store,notebookStore:d.notebookStore,diagramStore:d.diagramStore,generatedNotes:this.drafts,renderJobs:this.renderJobs,readCanvasImage:(id,asset)=>d.canvasStore.readImage(id,asset),chooseDirectory:signal=>this.chooseExportFolder(signal),resolveCanvasRegion:async(paperId,boardId,area,signal)=>{const value=await this.renderJobs.run({kind:'canvas-region',paperId,boardId,area},signal);return value.kind==='canvas-region'?value.region:null}})
  this.chatTurns=new AgentChatStore(d.store.root)
  this.taskStore=new AgentTaskStore(d.store.root)
  this.coordinator=new AgentCoordinator(this.taskStore,async(messages,tools,signal,input,onProgress)=>{
   const images=await this.resolveImages(input.owner,input.images??[])
   return executeAgentDeepSeek({model:input.model??d.model(),messages,tools,...(images.length?{images}:{})},d.key(),signal,undefined,onProgress)
  },createAgentTools(this.capabilities,this.drafts,literature),this.chatTurns)
  this.coordinator.subscribe(task=>{if(task.input.clientRequestId)this.clients.set(task.input.clientRequestId,{id:task.id,owner:task.input.owner});try{this.send('agent-task',task)}catch{}})
  this.chatTurns.subscribe(turn=>{try{this.send('agent-chat-turn',turn)}catch{}})
  this.coordinator.subscribeProgress(event=>{try{this.send('agent-chat-progress',event)}catch{}})
  this.acquisitions=new LiteratureAcquisitionService(d.store.root,literature,async(paperId,referenceId)=>{
   await this.requirePaper(paperId);validId(referenceId);const references=await d.references.load(paperId),ref=references?.records.find(r=>r.id===referenceId&&r.segmentation==='entry')
   if(!ref)throw Error('Reference not available. Rebuild local references first.')
   return extractLiteratureIdentity({...ref.fields,rawText:ref.rawText})
  })
  this.acquisitions.subscribe(record=>{try{this.send('reference-acquisition',record)}catch{}})
 }
 private send(channel:string,value?:unknown):void{const host=this.d.window();if(!host||host.isDestroyed()||host.webContents.isDestroyed()||host.webContents.mainFrame.url!==this.d.loadedUrl())throw Error('Application window unavailable');host.webContents.send('paper-reader:'+channel,value)}
 private libraryChanged(){try{this.send('library-changed')}catch{}}
 private track<T>(promise:Promise<T>):Promise<T>{this.active.add(promise);promise.then(()=>this.active.delete(promise),()=>this.active.delete(promise));return promise}
 async cancelClient(requestId:string):Promise<void>{this.pendingClients.get(requestId)?.abort();const value=this.clients.get(requestId);if(value)await this.coordinator.cancel(value.id,value.owner)}
 async flush():Promise<void>{await Promise.allSettled([...this.active]);await this.chatTurns.flush();await this.d.store.flush()}
 cancelAll():void{for(const controller of this.startingRuns)controller.abort();this.coordinator.cancelAll();this.renderJobs.cancelAll();this.speech.cancelAll();for(const c of this.referenceControllers)c.abort();this.devices.camera=false;this.devices.microphone=false}
 private async requirePaper(id:string):Promise<void>{validId(id);if(!(await this.d.store.list()).some(p=>p.id===id&&!p.isDemo))throw Error('Paper not found. Import a PDF first.')}
 private async owner(owner:AgentOwner){validateAgentOwner(owner);if(owner.kind==='paper')await this.requirePaper(owner.id);else if((await this.d.general.load()).conversationId!==owner.id)throw Error('General conversation owner mismatch')}
 private host():BrowserWindow{const host=this.d.window();if(!host||host.isDestroyed())throw Error('Window unavailable');return host}
 async ensureDirectory():Promise<void>{if(!(await this.d.store.getManagedDirectory()).configured){const result=await this.chooseManagedDirectory();if(!result)throw Error('Choose your managed Papers folder before importing.')}}
 async chooseManagedDirectory(){return this.d.files.run(async()=>{const current=await this.d.store.getManagedDirectory();const result=await dialog.showOpenDialog(this.host(),{title:'Choose the Papers folder',defaultPath:current.directory??join(app.getPath('documents'),'PaperReader','Papers'),properties:['openDirectory','createDirectory']});if(result.canceled||!result.filePaths[0])return null;const value=await this.d.store.configureManagedDirectory(result.filePaths[0]);this.grants.clear();this.libraryChanged();return value})}
 private async chooseExportFolder(signal:AbortSignal):Promise<string|null>{if(signal.aborted)throw Error('Export cancelled');return this.d.files.run(async()=>{const result=await dialog.showOpenDialog(this.host(),{title:'Choose one output folder for this export batch',properties:['openDirectory','createDirectory']});if(signal.aborted)throw Error('Export cancelled');return result.canceled?null:result.filePaths[0]??null})}
 private async resolveImages(owner:AgentOwner,refs:AIImageReference[]):Promise<string[]>{if(!refs.length)return[];if(owner.kind!=='paper')throw Error('Images must belong to an imported paper');const images=validateAIImages(refs),urls:string[]=[];for(const ref of images){const image=await this.d.images.read(owner.id,ref.imageId);if(imageSha(image.bytes)!==ref.sha256||image.byteLength!==ref.byteLength||image.mimeType!==ref.mimeType||image.width!==ref.width||image.height!==ref.height)throw Error('Saved AI image changed');urls.push('data:'+image.mimeType+';base64,'+Buffer.from(image.bytes).toString('base64'))}return urls}
 private async prepare(id:string,signal?:AbortSignal){await this.requirePaper(id);await this.renderJobs.run({kind:'prepare',paperId:id},signal)}
 private async pages(id:string,signal:AbortSignal){await this.prepare(id,signal);const result=await this.renderJobs.run({kind:'extract',paperId:id},signal);if(result.kind!=='extract')throw Error('Invalid extracted source');return result.pages}
 private async grant(input:AgentRunInput):Promise<AgentRunInput>{
  const frozen=structuredClone(input);frozen.allowedOperations=frozen.allowedOperations.filter(operation=>AGENT_OPERATIONS.includes(operation))
  if(frozen.scope?.folderToken){const configured=await this.d.store.getManagedDirectory();if(!configured.directory)delete frozen.scope.folderToken;else{const token='folder_'+textRevision(configured.directory);this.grants.set(token,configured.directory);frozen.scope.folderToken=token}}
  frozen.model=this.d.model()
  validateAgentInput(frozen);validateChatSourceScope(frozen);await this.owner(frozen.owner)
  if(frozen.chatTurn){const messages=frozen.owner.kind==='paper'?(await this.d.store.loadState(frozen.owner.id)).messages:(await this.d.general.load()).messages;validateSavedChatBinding(frozen,messages,await this.chatTurns.list(frozen.owner))}
  return frozen
 }
 private createCapabilities():AgentCapabilities{
  const d=this.d
  return {
   listPapers:async()=>{const [papers,metadata,org]=await Promise.all([d.store.list(),d.store.loadLibraryMetadata(),d.store.loadLibraryOrganization()]);return papers.filter(p=>!p.isDemo).map(p=>({...p,...metadata[p.id],category:org.assignments[p.id]??'uncategorized'}))},
   readPaper:async(id,kind,signal)=>{await this.requirePaper(id);const paper=(await this.capabilities.listPapers()).find(p=>p.id===id)!;if(kind==='metadata')return{paperId:id,title:paper.title,metadata:paper};if(kind==='notes'){await this.prepare(id,signal);const state=await d.store.loadState(id);return{paperId:id,title:paper.title,note:state.note,noteRevision:textRevision(state.note)}}return{paperId:id,title:paper.title,pages:await this.pages(id,signal)}},
   scanFolder:async(token,signal)=>{const granted=this.grants.get(token),current=await d.store.getManagedDirectory();if(!current.directory||(granted!==current.directory&&token!=='folder_'+textRevision(current.directory)))throw Error('Paper is outside the frozen managed-folder scope; start a new folder task.');if(signal.aborted)throw Error('Scan cancelled');const result=await d.store.scanManagedDirectory();return {value:result}},
   importScanned:(tokens,signal)=>importScannedPaperBatch(d.store,tokens,signal,()=>this.libraryChanged()),
   listCategories:async()=>(await d.store.loadLibraryOrganization()).categories,
   createCategory:async name=>{const existing=(await d.store.loadLibraryOrganization()).categories.find(c=>c.name.toLocaleLowerCase()===name.trim().toLocaleLowerCase());if(existing)return existing;const result=await d.store.createCategory(name);this.libraryChanged();return result.categories.find(c=>c.name===name.trim())!},
   assignCategory:async(id,categoryId,reclassify,signal)=>{if(signal.aborted)throw Error('Classification cancelled');const before=await d.store.loadLibraryOrganization();if(before.assignments[id]&&before.assignments[id]!==categoryId&&!reclassify)throw Error('Existing category preserved; explicit reclassification is required');await d.store.assignPaperCategory(id,categoryId);this.libraryChanged()},
   generateSummary:async(id,language,signal,frozenModel)=>{
    const requestId=randomUUID(),model=frozenModel??d.model(),prior=await loadSummaryJob(d.store,{paperId:id,language},model)
    await d.requests.run(requestId,id,'summary',async ownSignal=>{const combined=AbortSignal.any([signal,ownSignal]);if(prior?.canResume)await resumePaperSummary(d.store,{requestId,paperId:id,checkpointId:prior.checkpointId},model,d.key(),combined);else await generatePaperSummary(d.store,{requestId,paperId:id,language,pages:await this.pages(id,combined)},model,d.key(),combined)})
    const after=await loadSummaryJob(d.store,{paperId:id,language},model);this.libraryChanged();return{paperId:id,kind:'summary',title:'Summary saved',status:'succeeded',usage:{calls:Math.max(0,(after?.consumed.calls??0)-(prior?.canResume?prior.consumed.calls:0))}}
   },
   generateReadingNotes:async(id,language,signal,frozenModel)=>{const model=frozenModel??d.model();const paper=(await this.capabilities.listPapers()).find(p=>p.id===id);if(!paper)throw Error('Paper not found');const pages=await this.pages(id,signal);const result=await generateAutomationNotes({paperId:id,title:paper.title,pages},language,signal,async(system,user,abort)=>(await executeAgentDeepSeek({model,messages:[{role:'system',content:system},{role:'user',content:user}],tools:[]},d.key(),abort)).content);return{markdown:result.markdown,model,usage:{calls:result.calls}}},
   organizeNotes:async(id,signal,taskId,frozenModel)=>{const model=frozenModel??d.model();await this.prepare(id,signal);const state=await d.store.loadState(id);if(!state.note.trim())throw Error('Existing Text is empty. Generate new reading notes instead.');let calls=0;const result=await askDeepSeek({requestId:randomUUID(),paperId:id,question:'Organize existing Text',action:'organize-notes',history:[],context:{mode:'notes',paperTitle:(await this.capabilities.listPapers()).find(p=>p.id===id)!.title,page:1,pageText:'',note:state.note}},model,d.key(),signal,async(input,init)=>{calls++;return fetch(input,init)});const draft=await this.drafts.create({paperId:id,taskId:taskId??randomUUID(),language:/[\u3400-\u9fff]/.test(state.note)?'zh':'en',title:'Organized Text',markdown:result.content,model});return{paperId:id,kind:'reading-draft',id:draft.id,title:'Text organization suggestion',status:'succeeded',usage:{calls}}},
   readText:async(id,signal)=>{await this.prepare(id,signal);const text=(await d.store.loadState(id)).note;return{text,revision:textRevision(text)}},
   appendText:async(id,markdown,expectedRevision,signal)=>{await this.requirePaper(id);if(signal?.aborted)throw Error('Note append cancelled');await this.renderJobs.run({kind:'append-text',paperId:id,markdown,expectedRevision},signal);this.libraryChanged()},
   exportContent:(id,spec,signal)=>this.exports.exportContent(id,spec,signal)
  }
 }
 private async artifactReceipt(owner:AgentOwner,taskId:string,index:number){
  await this.owner(owner);validId(taskId);const task=await this.taskStore.load(taskId,owner,false)
  if(!Number.isInteger(index)||index<0||index>=task.receipts.length)throw Error('Choose an owned export receipt')
  const receipt=task.receipts[index];if(receipt.kind!=='export'||receipt.status!=='succeeded'||!receipt.paperId||!receipt.id)throw Error('Openable files are unavailable for this older or incomplete export')
  return receipt as typeof receipt&{paperId:string;id:string}
 }
 async commitText(jobId:string):Promise<PaperState>{
  validId(jobId);const job=this.renderJobs.pendingJob(jobId);if(!job||job.kind!=='append-text')throw Error('No owned active note write')
  return this.d.store.appendTextIfUnchanged(job.paperId,job.markdown,job.expectedRevision,()=>this.renderJobs.pendingJob(jobId)?.kind==='append-text')
 }
 register(handle:(channel:string,fn:(...args:any[])=>unknown)=>void){
  const d=this.d
  handle('load-agent-artifact-files',async(owner,taskId,index)=>{const receipt=await this.artifactReceipt(owner,taskId,index);return this.artifacts.files(receipt.id,receipt.paperId)})
  handle('open-agent-artifact',async(owner,taskId,index,fileIndex,action)=>{
   if(action!=='open'&&action!=='reveal')throw Error('Invalid artifact action')
   const receipt=await this.artifactReceipt(owner,taskId,index),path=await this.artifacts.resolve(receipt.id,receipt.paperId,fileIndex)
   if(action==='reveal')shell.showItemInFolder(path);else if(await shell.openPath(path))throw Error('The exported file could not be opened. Use Show in folder to locate it.')
  })
  handle('managed-directory',()=>d.store.getManagedDirectory())
  handle('choose-managed-directory',()=>this.chooseManagedDirectory())
  handle('scan-managed-papers',options=>d.store.scanManagedDirectory(options))
  handle('import-scanned-papers',tokens=>this.track((async()=>{if(!Array.isArray(tokens)||tokens.length>50||tokens.some(t=>typeof t!=='string'))throw Error('Select at most50 scanned PDFs');const results=[];try{for(const token of tokens)results.push(await d.store.importScannedPdf(token));return results}finally{this.libraryChanged()}})()))
  handle('consolidate-papers',ids=>this.track(d.store.consolidateLegacyPdfs(ids).then(r=>{this.libraryChanged();return r})))
  handle('show-paper-in-folder',async id=>{validId(id);await this.requirePaper(id);shell.showItemInFolder(await d.store.resolvePaperPath(id))})
  handle('run-agent',input=>this.track((async()=>{
   validateAgentInput(input);if(input.answerReplayOf!==undefined)throw Error('Use the saved-answer action to answer again');const controller=new AbortController(),client=input.clientRequestId;
   if(client&&this.pendingClients.has(client))throw Error('Chat request is already active');
   this.startingRuns.add(controller);if(client)this.pendingClients.set(client,controller);
   try{const frozen=await this.grant(input);return await this.coordinator.run(frozen,controller.signal)}
   finally{this.startingRuns.delete(controller);if(client&&this.pendingClients.get(client)===controller)this.pendingClients.delete(client)}
  })()))
  handle('reanswer-agent-chat',input=>this.track((async()=>{
   exact(input,['taskId','owner','chatTurn']);validateAgentOwner(input.owner);validId(input.taskId);exact(input.chatTurn,['requestId','userMessageId','assistantMessageId']);for(const value of Object.values(input.chatTurn))validId(value)
   const request=input as unknown as AgentReanswerInput,client=request.chatTurn.requestId,controller=new AbortController()
   if(this.pendingClients.has(client))throw Error('Chat request is already active')
   this.startingRuns.add(controller);this.pendingClients.set(client,controller)
   try{await this.owner(request.owner);const original=await this.taskStore.load(request.taskId,request.owner,false),candidate:AgentRunInput={...original.input,chatTurn:request.chatTurn,clientRequestId:client},messages=request.owner.kind==='paper'?(await d.store.loadState(request.owner.id)).messages:(await d.general.load()).messages
    validateAgentInput(candidate);validateSavedChatBinding(candidate,messages,await this.chatTurns.list(request.owner));return await this.coordinator.reanswer(request,controller.signal)
   }finally{this.startingRuns.delete(controller);if(this.pendingClients.get(client)===controller)this.pendingClients.delete(client)}
  })()))
  handle('load-agent-tasks',async owner=>{await this.owner(owner);return this.coordinator.list(owner)})
  handle('load-agent-chat-turns',async owner=>{
   await this.owner(owner);const tasks=await this.coordinator.list(owner),turns=await this.chatTurns.list(owner),saved=new Map(turns.map(turn=>[turn.taskId,turn]));let changed=false
   for(const task of tasks){if(!task.input.chatTurn)continue;const turn=saved.get(task.id);if(!turn||turn.status!==task.status||turn.execution!==task.execution||turn.answer!==task.answer||turn.updatedAt!==task.updatedAt){await this.chatTurns.observe(task);changed=true}}
   return changed?this.chatTurns.list(owner):turns
  })
  handle('continue-agent',input=>this.track((async()=>{object(input);validateAgentOwner(input.owner);const controller=new AbortController();this.startingRuns.add(controller);try{await this.owner(input.owner);return await this.coordinator.continue(input as unknown as AgentContinueInput,controller.signal)}finally{this.startingRuns.delete(controller)}})()))
  handle('cancel-agent',async(id,owner)=>{await this.owner(owner);return this.coordinator.cancel(id,owner)})
  handle('open-reference-source',async(paperId,referenceId,candidateId)=>{const record=await this.acquisitions.load(paperId,referenceId);const candidate=record?.candidates.find(c=>c.id===candidateId);if(!candidate)throw Error('Source candidate unavailable');await shell.openExternal(assertPublicUrl(candidate.sourceUrl).href)})
  handle('load-reference-acquisition',(paperId,referenceId)=>this.acquisitions.load(paperId,referenceId))
  handle('acquire-reference',(paperId,referenceId,candidateId)=>this.track((async()=>{const controller=new AbortController();this.referenceControllers.add(controller);try{const result=await this.acquisitions.run(paperId,referenceId,controller.signal,candidateId);this.libraryChanged();return result}finally{this.referenceControllers.delete(controller)}})()))
  handle('list-generated-drafts',id=>this.drafts.list(id))
  handle('read-generated-draft',(id,draftId)=>this.drafts.read(id,draftId))
  handle('append-generated-draft',(id,draftId)=>this.track((async()=>{const before=await this.capabilities.readText(id);await this.drafts.append(id,draftId,before.revision,this.capabilities);this.libraryChanged()})()))
  handle('export-generated-draft',(id,draftId)=>this.track((async()=>{const receipt=await this.exports.exportContent(id,{content:'reading-draft',format:'md',draftId},new AbortController().signal);return{canceled:receipt.status!=='succeeded',fileName:receipt.fileName}})()))
  handle('finish-automation-render',(reply:AutomationRenderReply)=>{if(!this.renderJobs.accept(reply))throw Error('Unowned or expired background job')})
  handle('commit-automation-text',id=>this.commitText(id))
  handle('speech-status',()=>this.speech.status());handle('speech-download-model',()=>this.track(this.speech.downloadModel()))
  handle('speech-import-model',()=>d.files.run(async()=>{const result=await dialog.showOpenDialog(this.host(),{title:'Import the multilingual ggml-base.bin model',properties:['openFile'],filters:[{name:'Whisper model',extensions:['bin']}]});return result.canceled?this.speech.status():this.speech.importModel(result.filePaths[0])}))
  handle('speech-start',request=>this.speech.start(request));handle('speech-append',request=>this.speech.append(request));handle('speech-finalize',request=>this.speech.finalize(request));handle('speech-cancel',request=>this.speech.cancel(request))
  handle('vision-assets',()=>this.assets.visionAssets())
  handle('enable-input-device',request=>{if(!request||!['microphone','camera'].includes(request.device)||typeof request.enabled!=='boolean')throw Error('Invalid local input capability');this.devices[request.device as 'microphone'|'camera']=request.enabled})
 }
}
export async function initialManagedDirectory():Promise<string|undefined>{
 if(process.env.PAPER_READER_PAPERS_DIR)return resolve(process.env.PAPER_READER_PAPERS_DIR)
 try{const value:unknown=JSON.parse(await readFile(join(__dirname,'../initial-library.json'),'utf8'));if(value&&typeof value==='object'&&'papersDirectory'in value&&typeof value.papersDirectory==='string')return resolve(value.papersDirectory)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('Invalid initial library location')}
 return undefined
}
