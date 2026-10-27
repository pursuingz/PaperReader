import { contextBridge, ipcRenderer } from 'electron'
import type { AIProgress, GeneralAIProgress, DesktopAPI, DesktopCommand } from '../shared/types'
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(`paper-reader:${channel}`, ...args)
function subscribe<T>(name:string,listener:(value:T)=>void):()=>void { const handler=(_event:Electron.IpcRendererEvent,value:T)=>listener(value); ipcRenderer.on('paper-reader:'+name,handler);return()=>{ipcRenderer.removeListener('paper-reader:'+name,handler)} }
const api: DesktopAPI = {
  getManagedDirectory:()=>invoke('managed-directory'),
  chooseManagedDirectory:()=>invoke('choose-managed-directory'),
  scanManagedPapers:options=>invoke('scan-managed-papers',options),
  importScannedPapers:tokens=>invoke('import-scanned-papers',tokens),
  consolidatePapers:ids=>invoke('consolidate-papers',ids),
  showPaperInFolder:id=>invoke('show-paper-in-folder',id),
  loadAgentArtifactFiles:(owner,taskId,index)=>invoke('load-agent-artifact-files',owner,taskId,index),
  openAgentArtifact:(owner,taskId,index,fileIndex,action)=>invoke('open-agent-artifact',owner,taskId,index,fileIndex,action),
  reanswerAgentChat:input=>invoke('reanswer-agent-chat',input),
  runAgent:input=>invoke('run-agent',input),
  loadAgentTasks:owner=>invoke('load-agent-tasks',owner),
  continueAgent:input=>invoke('continue-agent',input),
  cancelAgent:(id,owner)=>invoke('cancel-agent',id,owner),
  onAgentTask:listener=>subscribe('agent-task',listener),
  loadAgentChatTurns:owner=>invoke('load-agent-chat-turns',owner),
  onAgentChatTurn:listener=>subscribe('agent-chat-turn',listener),
  onAgentChatProgress:listener=>subscribe('agent-chat-progress',listener),
  onLibraryChanged:listener=>subscribe('library-changed',listener),
  onReferenceAcquisition:listener=>subscribe('reference-acquisition',listener),
  openReferenceSource:(paperId,referenceId,candidateId)=>invoke('open-reference-source',paperId,referenceId,candidateId),
  acquireReference:(paperId,referenceId,candidateId)=>invoke('acquire-reference',paperId,referenceId,candidateId),
  loadReferenceAcquisition:(paperId,referenceId)=>invoke('load-reference-acquisition',paperId,referenceId),
  listGeneratedDrafts:paperId=>invoke('list-generated-drafts',paperId),
  readGeneratedDraft:(paperId,draftId)=>invoke('read-generated-draft',paperId,draftId),
  appendGeneratedDraft:(paperId,draftId)=>invoke('append-generated-draft',paperId,draftId),
  exportGeneratedDraft:(paperId,draftId)=>invoke('export-generated-draft',paperId,draftId),
  localSpeech:{
    visionAssets:()=>invoke('vision-assets'),status:()=>invoke('speech-status'),downloadModel:()=>invoke('speech-download-model'),importModel:()=>invoke('speech-import-model'),
    start:request=>invoke('speech-start',request),append:request=>invoke('speech-append',request),finalize:request=>invoke('speech-finalize',request),cancel:request=>invoke('speech-cancel',request),enableDevice:request=>invoke('enable-input-device',request)
  },
  onAutomationRenderJob:listener=>subscribe('automation-render-job',listener),
  onAutomationRenderCancel:listener=>subscribe('automation-render-cancel',listener),
  finishAutomationRender:reply=>invoke('finish-automation-render',reply),
  commitAutomationText:jobId=>invoke('commit-automation-text',jobId),

  listPapers: () => invoke('list'),
  saveAIImage: (paperId,input) => invoke('save-ai-image',paperId,input),
  readAIImage: (paperId,imageId) => invoke('read-ai-image',paperId,imageId),
  copyPdfCapture: (paperId,capture) => invoke('copy-pdf-capture',paperId,capture),
  exportPdfCapture: (paperId,capture) => invoke('export-pdf-capture',paperId,capture),
  importPaper: () => invoke('import'),
  readPaper: paperId => invoke('read', paperId),
  loadPaperState: paperId => invoke('load-state', paperId),
  savePaperState: (paperId, state) => invoke('save-state', paperId, state),
  getSettings: () => invoke('get-settings'),
  saveSettings: input => invoke('save-settings', input),
  askAI: request => invoke('ask-ai', request),
  askRecordedAI: request => invoke('ask-recorded-ai', request),
  loadAIRequests: owner => invoke('load-ai-requests', owner),
  retryAIRequest: request => invoke('retry-ai-request', request),
  loadGeneralChat: () => invoke('load-general-chat'),
  saveGeneralChat: value => invoke('save-general-chat', value),
  askGeneralAI: request => invoke('ask-general-ai', request),
  onGeneralAIProgress: listener => {
    const handler = (_event: Electron.IpcRendererEvent, progress: GeneralAIProgress) => listener(progress)
    ipcRenderer.on('paper-reader:general-ai-progress', handler)
    return () => ipcRenderer.removeListener('paper-reader:general-ai-progress', handler)
  },
  onAIProgress: listener => {
    const handler = (_event: Electron.IpcRendererEvent, progress: AIProgress) => listener(progress)
    ipcRenderer.on('paper-reader:ai-progress', handler)
    return () => ipcRenderer.removeListener('paper-reader:ai-progress', handler)
  },
  copyText: text => invoke('copy-text', text),
  cancelAI: (requestId,options) => invoke('cancel-ai', requestId,options),
  generateSummary: request => invoke('generate-summary', request),
  loadSummary: paperId => invoke('load-summary', paperId),
  loadSummaryJob: query => invoke('load-summary-job', query),
  loadSummaryDraft: query => invoke('load-summary-draft', query),
  resumeSummary: request => invoke('resume-summary', request),
  loadMarks: paperId => invoke('load-marks', paperId),
  saveMarks: (paperId, marks) => invoke('save-marks', paperId, marks),
  loadLibraryActivity: () => invoke('load-library-activity'),
  recordPaperOpened: paperId => invoke('record-paper-opened', paperId),
  loadLibraryOrganization: () => invoke('load-library-organization'),
  createCategory: name => invoke('create-category', name),
  renameCategory: (categoryId, name) => invoke('rename-category', categoryId, name),
  assignPaperCategory: (paperId, categoryId) => invoke('assign-paper-category', paperId, categoryId),
  loadLibraryMetadata: () => invoke('load-library-metadata'),
  savePaperMetadata: (paperId, input) => invoke('save-paper-metadata', paperId, input),
  loadPdfInk: paperId => invoke('load-pdf-ink', paperId),
  savePdfInk: (paperId, ink) => invoke('save-pdf-ink', paperId, ink),
  exportReadingNotes: paperId => invoke('export-reading-notes', paperId),
  exportAnnotatedPdf: paperId => invoke('export-annotated-pdf', paperId),
  loadCanvasNotebook: paperId => invoke('load-canvas-notebook', paperId),
  saveCanvasNotebook: (paperId, value) => invoke('save-canvas-notebook', paperId, value),
  readCanvasHighlight: (paperId, highlightId) => invoke('read-canvas-highlight', paperId, highlightId),
  exportCanvasRegion: (paperId,pageId,options,images) => invoke('export-canvas-region',paperId,pageId,options,images),
  exportCanvasPagePng: (paperId, pageId, bytes) => invoke('export-canvas-page-png', paperId, pageId, bytes),
  loadCanvas: paperId => invoke('load-canvas', paperId),
  saveCanvas: (paperId, value) => invoke('save-canvas', paperId, value),
  importCanvasImage: paperId => invoke('import-canvas-image', paperId),
  saveCanvasCapture: (paperId, capture) => invoke('save-canvas-capture', paperId, capture),
  exportCanvasPng: (paperId, bytes) => invoke('export-canvas-png', paperId, bytes),
  loadCanvasDiagram: paperId => invoke('load-canvas-diagram', paperId),
  saveCanvasDiagram: (paperId, value) => invoke('save-canvas-diagram', paperId, value),
  loadMindMap: paperId => invoke('load-mind-map', paperId),
  saveMindMap: (paperId, value) => invoke('save-mind-map', paperId, value),
  exportMindMapPng: (paperId, bytes) => invoke('export-mind-map-png', paperId, bytes),
  readCanvasImage: (paperId, assetId) => invoke('read-canvas-image', paperId, assetId),
  loadSourceIndex: paperId => invoke('load-source-index', paperId),
  saveSourceIndex: (paperId, value) => invoke('save-source-index', paperId, value),
  loadSourceEvidenceEdits: paperId => invoke('load-source-evidence-edits', paperId),
  saveSourceEvidenceCaption: (paperId, input) => invoke('save-source-evidence-caption', paperId, input),
  setSourceEvidenceHidden: (paperId, input) => invoke('set-source-evidence-hidden', paperId, input),
  loadSummaryEvidence: paperId => invoke('load-summary-evidence', paperId),
  saveSummaryEvidenceCapture: (paperId, capture) => invoke('save-summary-evidence-capture', paperId, capture),
  resetSummaryEvidenceCrop: (paperId, entryId) => invoke('reset-summary-evidence-crop', paperId, entryId),
  loadSummaryFigures: paperId => invoke('load-summary-figures', paperId),
  saveSummaryFigure: (paperId, capture) => invoke('save-summary-figure', paperId, capture),
  resetSummaryFigure: (paperId, entryId) => invoke('reset-summary-figure', paperId, entryId),
  loadTables: paperId => invoke('load-tables', paperId),
  saveTables: (paperId, tables) => invoke('save-tables', paperId, tables),
  exportTableCsv: (paperId, tableId) => invoke('export-table-csv', paperId, tableId),
  loadReferences: paperId => invoke('load-references', paperId),
  buildReferences: paperId => invoke('build-references', paperId),
  verifyReference: (paperId, referenceId) => invoke('verify-reference', paperId, referenceId),
  windowControl: action => invoke('window-control', action),
  setFullscreen: value => invoke('set-fullscreen', value),
  onFullscreenChange: listener => {
    const handler = (_event: Electron.IpcRendererEvent, value: boolean) => { if (typeof value === 'boolean') listener(value) }
    ipcRenderer.on('paper-reader:fullscreen-change', handler)
    return () => ipcRenderer.removeListener('paper-reader:fullscreen-change', handler)
  },
  openDesktopMenu: (name, x, y) => invoke('open-desktop-menu', name, x, y),
  setDesktopMenuState: state => invoke('set-desktop-menu-state', state),
  onDesktopCommand: listener => {
    const handler = (_event: Electron.IpcRendererEvent, command: DesktopCommand) => listener(command)
    ipcRenderer.on('paper-reader:desktop-command', handler)
    return () => ipcRenderer.removeListener('paper-reader:desktop-command', handler)
  }
}
contextBridge.exposeInMainWorld('paperReader', api)
