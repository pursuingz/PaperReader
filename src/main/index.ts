import { SourceEvidenceEditsStore } from './sourceEvidenceEditsStore'
import {assertExportLocation} from './exportLocationPolicy'
import {AutomationRuntime,initialManagedDirectory} from './automationMain'
import { loadSummaryJob, loadSummaryDraft, resumePaperSummary } from './summary'
import { validateSummaryJobQuery, validateSummaryResumeRequest } from './summaryJobValidation'
import { AIImageStore } from './aiImageStore'
import { copyPdfCaptureImage, savePdfCaptureImage } from './captureActions'
import { saveInfiniteNotebookExport } from './infiniteNotebookExport'
import { assertSavedCanvasExport } from './infiniteExportScope'
import { canvasExportPlan } from '../shared/canvasViewport'
import type { CanvasExportOptions } from '../shared/notebookTypes'
import { NotebookStore } from './notebookStore'
import { saveNotebookPngExport } from './notebookPngExport'
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, safeStorage } from 'electron'
import type { IpcMainInvokeEvent,SaveDialogOptions,SaveDialogReturnValue } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PaperStore } from './storage'
import { LibraryActivityStore } from './libraryActivityStore'
import { AIJobs, askDeepSeek, generatePaperSummary } from './deepseek'
import { object, validId, validateMarks, validateRequest, validateSettings, validateState, validateSummaryRequest } from './validation'
import type { AppSettings, SettingsInput, AIRequest, PaperState } from '../shared/types'
import { validateAssignment, validateCategoryId, validateCategoryName, validatePdfInk } from './workflowValidation'
import { formatReadingExport, readingExportFileName } from './readingExport'
import { saveMarkdownExport } from './noteExportDialog'
import { exportAnnotatedPdf } from './annotatedPdfExport'
import { normalizePaperMetadata } from './metadataValidation'
import { CanvasStore } from './canvasStore'
import { SourceIndexStore } from './sourceIndexStore'
import { prepareCanvasImage } from './canvasImageImport'
import { localDataOperation } from './localDataErrors'
import { createDesktopMenus } from './desktopMenus'
import { validateDesktopMenuState } from './desktopMenuModel'
import { validatePdfCaptureInput } from './canvasCaptureValidation'
import { canvasPngFileName, saveCanvasPngExport } from './canvasPngExport'
import { watchNativeFullscreen } from './desktopFullscreen'
import { SummaryFigureStore } from './summaryFiguresStore'
import { SummaryEvidenceStore } from './summaryEvidenceStore'
import { TableStore } from './tableStore'
import { saveTableCsvExport, tableCsvFileName } from './tableCsvExport'
import { ReferenceStore } from './referenceStore'
import { FileOperationGate } from './fileOperations'
import { DiagramStore } from './diagramStore'
import { GeneralChatStore } from './generalChatStore'
import { RequestHistoryStore } from './requestHistoryStore'
import { RecordedAIService, validateRecordedAIRequest, validateRetryAIRequest } from './recordedAI'
import { validateGeneralAIRequest, validateGeneralChatState } from './generalChatValidation'
import { validateRequestOwner } from './requestHistoryValidation'
import { mindMapPngFileName, saveMindMapPngExport } from './mindMapPngExport'
import type { AIRequestOwner } from '../shared/types'
import type { EffectiveAIProgress } from './deepseek'

const decodeImage = (bytes: Uint8Array) => {
    const image = nativeImage.createFromBuffer(Buffer.from(bytes))
    return image.isEmpty() ? null : image.getSize()
  }

let window: BrowserWindow | null = null
let aiImageStore:AIImageStore
let automation: AutomationRuntime
let store: PaperStore
let libraryActivity: LibraryActivityStore
let notebookStore: NotebookStore
let legacyNotebookStore: NotebookStore
let canvasStore: CanvasStore
let sourceIndexStore: SourceIndexStore
let summaryFigureStore: SummaryFigureStore
let sourceEvidenceEditsStore: SourceEvidenceEditsStore
let summaryEvidenceStore: SummaryEvidenceStore
let tableStore: TableStore
let referenceStore: ReferenceStore
let diagramStore: DiagramStore
let generalStore: GeneralChatStore
let requestHistory: RequestHistoryStore
let recordedAI: RecordedAIService
const recordedOwners = new Map<string, AIRequestOwner>()
let loadedUrl = ''
let importing = false
let desktopMenus: ReturnType<typeof createDesktopMenus> | null = null
let exportingCanvas = false
let exportingTable = false
const activeRequests = new AIJobs()
const fileOperations = new FileOperationGate()
interface PrivateSettings { model: string; encryptedKey?: string }
let privateSettings: PrivateSettings = { model: 'deepseek-flash' }
let settingsTail: Promise<unknown> = Promise.resolve()
async function flushStores(): Promise<void> {
  await Promise.all([store.flush(), aiImageStore.flush(), libraryActivity.flush(), notebookStore.flush(), legacyNotebookStore.flush(), canvasStore.flush(), diagramStore.flush(), generalStore.flush(), requestHistory.flush(), sourceIndexStore.flush(), sourceEvidenceEditsStore.flush(), summaryFigureStore.flush(), summaryEvidenceStore.flush(), tableStore.flush(), referenceStore.flush(), fileOperations.flush(), settingsTail, automation?.flush()])
}
async function reconcileSaved(owner: AIRequestOwner): Promise<void> {
  try {
    const history = await requestHistory.reconcile(owner)
    for (const record of history.records) if (record.status !== 'pending' && record.status !== 'response-ready') recordedOwners.delete(record.requestId)
  } catch { /* A saved chat must remain saved even when its separate history is unavailable. */ }
}
async function releaseUnsaved(owner: AIRequestOwner, messages: { id: string }[]): Promise<void> {
  try {
    const history = await requestHistory.load(owner)
    for (const record of history.records) if (record.status === 'response-ready' && messages.some(message => message.id === record.assistantMessageId)) {
      await requestHistory.settle(owner, record.requestId, 'failed'); recordedOwners.delete(record.requestId)
    }
  } catch { /* Preserve the original save error. */ }
}
function recordedProgress(owner: AIRequestOwner, requestId: string, signal: AbortSignal): (value: EffectiveAIProgress) => void {
  const host = window
  if (!host) throw new Error('Window unavailable')
  const sender = host.webContents, frame = sender.mainFrame
  return value => {
    if (signal.aborted || window !== host || host.isDestroyed() || sender.isDestroyed() || sender.mainFrame !== frame || frame.url !== loadedUrl) return
    if (owner.scope === 'paper') sender.send('paper-reader:ai-progress', { ...value, requestId, paperId: owner.paperId })
    else sender.send('paper-reader:general-ai-progress', { ...value, requestId, conversationId: owner.conversationId })
  }
}
async function runRecorded<T>(owner: AIRequestOwner, id: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (recordedOwners.has(id)) throw new Error('This request identity is already active')
  recordedOwners.set(id, owner)
  try { return await activeRequests.run(id, owner.scope === 'paper' ? owner.paperId : owner.conversationId, 'chat', operation) }
  catch (error) { recordedOwners.delete(id); throw error }
}

function trustedSender(event: IpcMainInvokeEvent): void {
  if (!window || event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== loadedUrl) throw new Error('Untrusted IPC sender')
}
function publicSettings(): AppSettings {
  return { provider: 'deepseek', model: privateSettings.model, hasApiKey: Boolean(privateSettings.encryptedKey) }
}
function encryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
}
function decryptKey(): string {
  if (!privateSettings.encryptedKey) return ''
  if (!encryptionAvailable()) throw new Error('Secure key storage is unavailable on this computer. API access is disabled.')
  try { return safeStorage.decryptString(Buffer.from(privateSettings.encryptedKey, 'base64')) } catch { throw new Error('Cannot decrypt the saved API key. Enter it again in Settings.') }
}
async function saveSettings(input: SettingsInput): Promise<AppSettings> {
  validateSettings(input)
  const operation = settingsTail.then(async () => {
    const next: PrivateSettings = { ...privateSettings, model: input.model }
    if (input.apiKey !== undefined) {
      if (input.apiKey.trim()) {
        if (!encryptionAvailable()) throw new Error('Secure key storage is unavailable. The API key was not saved.')
        next.encryptedKey = safeStorage.encryptString(input.apiKey.trim()).toString('base64')
      } else delete next.encryptedKey
    }
    await store.savePrivateSettings(next); privateSettings = next; return publicSettings()
  })
  settingsTail = operation.catch(() => {}); return operation
}
async function protectedSaveDialog(owner:BrowserWindow,options:SaveDialogOptions):Promise<SaveDialogReturnValue>{
 const selected=await dialog.showSaveDialog(owner,options);
 if(!selected.canceled&&selected.filePath)await assertExportLocation(selected.filePath,[store.root,...await store.getManagedPdfDirectories()]);
 return selected;
}
function registerIPC(): void {
  const handle = (channel: string, handler: (...args: unknown[]) => unknown) => ipcMain.handle(`paper-reader:${channel}`, (event, ...args: unknown[]) => { trustedSender(event); return handler(...args) })
  automation.register(handle)
  handle('list', () => store.list())
  const requireRealPaper=async(id:unknown)=>{validId(id);if(!(await store.list()).some(p=>p.id===id&&!p.isDemo))throw Error('Import a PDF before using screenshots or AI images.')}
  handle('save-ai-image',async(id,input)=>{validId(id);return aiImageStore.save(id,input as import('../shared/types').AIImageInput)})
  handle('read-ai-image',async(id,imageId)=>{validId(id);validId(imageId);return aiImageStore.read(id,imageId)})
  handle('copy-pdf-capture',async(id,capture)=>{await requireRealPaper(id);copyPdfCaptureImage(capture as import('../shared/types').PdfCaptureInput,decodeImage,bytes=>clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(bytes))))})
  handle('export-pdf-capture',(id,capture)=>fileOperations.run(async()=>{await requireRealPaper(id);const owner=window;if(!owner)throw Error('Window unavailable');return savePdfCaptureImage(capture as import('../shared/types').PdfCaptureInput,store.root,defaultPath=>protectedSaveDialog(owner,{title:'Save PDF screenshot — choose a new file name',defaultPath,filters:[{name:'PNG image',extensions:['png']}],properties:['showOverwriteConfirmation','createDirectory']}),decodeImage)}))
  handle('import', () => automation.ensureDirectory().then(() => fileOperations.run(async () => {
    if (!window) throw new Error('Window unavailable')
    if (importing || exportingTable || exportingCanvas) throw new Error('Finish the current file dialog before importing a PDF.')
    importing = true
    try {
      const selection = await dialog.showOpenDialog(window, { title: 'Import PDF', properties: ['openFile'], filters: [{ name: 'PDF documents', extensions: ['pdf'] }] })
      return selection.canceled || !selection.filePaths[0] ? null : await store.importPdf(selection.filePaths[0])
    } finally { importing = false }
  })))
  handle('read', id => { validId(id); return store.readPdf(id) })
  handle('load-state', id => { validId(id); return store.loadState(id) })
  handle('save-state', async (id, state) => {
    validId(id); validateState(state, id)
    const owner: AIRequestOwner = { scope: 'paper', paperId: id }
    try { await store.saveState(id, state as PaperState) }
    catch (error) { await releaseUnsaved(owner, (state as PaperState).messages); throw error }
    await reconcileSaved(owner)
  })
  handle('load-summary', id => { validId(id); return store.loadSummary(id) })
  handle('load-marks', id => { validId(id); return store.loadMarks(id) })
  handle('save-marks', (id, marks) => { validId(id); validateMarks(marks); return store.saveMarks(id, marks) })
  handle('load-library-activity', () => libraryActivity.load())
  handle('record-paper-opened', id => { validId(id); return libraryActivity.record(id) })
  handle('load-library-organization', () => store.loadLibraryOrganization())
  handle('create-category', name => store.createCategory(validateCategoryName(name)))
  handle('rename-category', (id, name) => { validateCategoryId(id); return store.renameCategory(id, validateCategoryName(name)) })
  handle('assign-paper-category', (id, categoryId) => { validId(id); validateAssignment(id, categoryId); return store.assignPaperCategory(id, categoryId as string | null) })
  handle('load-library-metadata', () => store.loadLibraryMetadata())
  handle('save-paper-metadata', (id, input) => { validId(id); return store.savePaperMetadata(id, normalizePaperMetadata(input)) })
  handle('load-pdf-ink', id => { validId(id); return store.loadPdfInk(id) })
  handle('save-pdf-ink', (id, ink) => { validId(id); validatePdfInk(ink); return store.savePdfInk(id, ink) })
  handle('load-canvas-notebook', id => { validId(id); return localDataOperation('Canvas notebook', () => notebookStore.load(id)) })
  handle('save-canvas-notebook', (id, value) => { validId(id); return localDataOperation('Canvas notebook', () => notebookStore.save(id, value)) })
  handle('read-canvas-highlight', (id, highlightId) => { validId(id); validId(highlightId); return localDataOperation('Canvas highlight', () => notebookStore.readHighlight(id, highlightId)) })
  handle('load-canvas', id => { validId(id); return localDataOperation('Canvas', () => canvasStore.load(id)) })
  handle('save-canvas', (id, value) => { validId(id); return localDataOperation('Canvas', () => canvasStore.save(id, value)) })
  handle('load-canvas-diagram', id => { validId(id); return localDataOperation('Canvas diagram', () => diagramStore.loadDiagram(id)) })
  handle('save-canvas-diagram', (id, value) => { validId(id); return localDataOperation('Canvas diagram', () => diagramStore.saveDiagram(id, value)) })
  handle('load-mind-map', id => { validId(id); return localDataOperation('Mind map', () => diagramStore.loadMap(id)) })
  handle('save-mind-map', (id, value) => { validId(id); return localDataOperation('Mind map', () => diagramStore.saveMap(id, value)) })
  handle('read-canvas-image', (id, assetId) => { validId(id); validId(assetId); return localDataOperation('Canvas image', () => canvasStore.readImage(id, assetId)) })
  handle('import-canvas-image', id => fileOperations.run(() => localDataOperation('Canvas image', async () => {
    validId(id)
    const owner = window
    if (!owner) throw new Error('Window unavailable')
    await notebookStore.load(id)
    const selection = await dialog.showOpenDialog(owner, { title: 'Insert canvas image', properties: ['openFile'], filters: [{ name: 'PNG or JPEG images', extensions: ['png', 'jpg', 'jpeg'] }] })
    if (selection.canceled || !selection.filePaths[0]) return null
    const image = await prepareCanvasImage(selection.filePaths[0], bytes => {
      const decoded = nativeImage.createFromBuffer(Buffer.from(bytes))
      return decoded.isEmpty() ? null : decoded.getSize()
    })
    return canvasStore.importImage(id, image.bytes, image.info)
  })))
  handle('save-canvas-capture', (id, input) => localDataOperation('Canvas capture', async () => {
    validId(id); validatePdfCaptureInput(input)
    return canvasStore.importCapture(id, input, decodeImage)
  }))
  handle('export-canvas-png', (id, bytes) => fileOperations.run(() => localDataOperation('Canvas export', async () => {
    validId(id)
    if (!(bytes instanceof Uint8Array)) throw new Error('Invalid canvas PNG')
    const owner = window
    if (!owner) throw new Error('Window unavailable')
    if (exportingCanvas || exportingTable || importing) throw new Error('Finish the current file dialog before exporting Canvas.')
    exportingCanvas = true
    try {
      await canvasStore.flush(); await canvasStore.load(id)
      const paper = (await store.list()).find(item => item.id === id)
      if (!paper || paper.isDemo) throw new Error('Import a PDF before exporting Canvas.')
      const information = (await store.loadLibraryMetadata())[id]
      return await saveCanvasPngExport(bytes, canvasPngFileName(information?.title ?? paper.title), store.root, defaultPath => protectedSaveDialog(owner, {
        title: 'Export full Canvas PNG — choose a new file name', defaultPath,
        filters: [{ name: 'PNG image', extensions: ['png'] }], properties: ['showOverwriteConfirmation', 'createDirectory']
      }), decodeImage)
    } finally { exportingCanvas = false }
  })))
  handle('export-canvas-region', (id, pageId, rawOptions, rawImages) => fileOperations.run(() => localDataOperation('Canvas region export', async () => {
    validId(id); validId(pageId)
    const options=structuredClone(rawOptions) as CanvasExportOptions
    canvasExportPlan(options)
    if(!Array.isArray(rawImages) || rawImages.length>50 || rawImages.some(value=>!(value instanceof Uint8Array)) || rawImages.reduce((total,value)=>total+value.byteLength,0)>64*1024*1024) throw new Error('Invalid or oversized Canvas export images')
    const images=rawImages.map(value=>new Uint8Array(value))
    const owner=window
    if(!owner) throw new Error('Window unavailable')
    if(exportingCanvas || exportingTable || importing) throw new Error('Finish the current file dialog before exporting Canvas.')
    exportingCanvas=true
    try {
      await notebookStore.flush()
      const notebook=await notebookStore.load(id),page=notebook.pages.find(value=>value.id===pageId)
      if(!page) throw new Error('Canvas board not found. Export was stopped.')
      await assertSavedCanvasExport(page,options,assetId=>canvasStore.readImage(id,assetId))
      const paper=(await store.list()).find(value=>value.id===id&&!value.isDemo)
      if(!paper) throw new Error('Import a PDF before exporting Canvas.')
      const metadata=(await store.loadLibraryMetadata())[id]
      const suggested=canvasPngFileName(metadata?.title??paper.title).replace(/-canvas\.png$/,'-canvas-'+options.scope+'.'+options.format)
      return await saveInfiniteNotebookExport(images,suggested,store.root,page,options,defaultPath=>protectedSaveDialog(owner,{
        title:'Export Canvas '+options.format.toUpperCase()+' — choose a new file name',defaultPath,
        filters:[{name:options.format==='pdf'?'PDF document':'PNG image',extensions:[options.format]}],properties:['showOverwriteConfirmation','createDirectory']
      }),decodeImage)
    } finally {exportingCanvas=false}
  })))
  handle('export-canvas-page-png', (id, pageId, bytes) => fileOperations.run(() => localDataOperation('Canvas page export', async () => {
    validId(id); validId(pageId)
    if (!(bytes instanceof Uint8Array)) throw new Error('Invalid canvas page PNG')
    const owner = window
    if (!owner) throw new Error('Window unavailable')
    if (exportingCanvas || exportingTable || importing) throw new Error('Finish the current file dialog before exporting Canvas.')
    exportingCanvas = true
    try {
      await notebookStore.flush()
      const notebook = await notebookStore.load(id)
      const page = notebook.pages.find(value => value.id === pageId)
      if (!page) throw new Error('Canvas page not found. Export was stopped.')
      const paper = (await store.list()).find(value => value.id === id && !value.isDemo)
      if (!paper) throw new Error('Import a PDF before exporting Canvas.')
      const metadata = (await store.loadLibraryMetadata())[id]
      const suggested = canvasPngFileName(metadata?.title ?? paper.title).replace(/-canvas\.png$/, '-canvas-page-' + (notebook.pages.indexOf(page) + 1) + '.png')
      return await saveNotebookPngExport(bytes, suggested, store.root, page, defaultPath => protectedSaveDialog(owner, {
        title: 'Export complete Canvas page PNG — choose a new file name', defaultPath,
        filters: [{ name: 'PNG image', extensions: ['png'] }], properties: ['showOverwriteConfirmation', 'createDirectory']
      }), decodeImage)
    } finally { exportingCanvas = false }
  })))
  handle('load-source-index', id => { validId(id); return localDataOperation('Source index', () => sourceIndexStore.load(id)) })
  handle('export-mind-map-png', (id, bytes) => fileOperations.run(() => localDataOperation('Mind map export', async () => {
    validId(id)
    if (!(bytes instanceof Uint8Array)) throw new Error('Invalid mind map PNG')
    const owner = window
    if (!owner) throw new Error('Window unavailable')
    if (exportingCanvas || exportingTable || importing) throw new Error('Finish the current file dialog before exporting Mind map.')
    exportingCanvas = true
    try {
      await diagramStore.flush(); await diagramStore.loadMap(id)
      const paper = (await store.list()).find(item => item.id === id && !item.isDemo)
      if (!paper) throw new Error('Import a PDF before exporting Mind map.')
      const information = (await store.loadLibraryMetadata())[id]
      return await saveMindMapPngExport(bytes, mindMapPngFileName(information?.title ?? paper.title), store.root, defaultPath => protectedSaveDialog(owner, {
        title: 'Export complete Mind map PNG — choose a new file name', defaultPath,
        filters: [{ name: 'PNG image', extensions: ['png'] }], properties: ['showOverwriteConfirmation', 'createDirectory']
      }), decodeImage)
    } finally { exportingCanvas = false }
  })))
  handle('save-source-index', (id, value) => { validId(id); return localDataOperation('Source index', () => sourceIndexStore.save(id, value)) })
  handle('load-source-evidence-edits', id => { validId(id); return localDataOperation('Source evidence edits', () => sourceEvidenceEditsStore.load(id)) })
  handle('save-source-evidence-caption', (id, input) => { validId(id); return localDataOperation('Source evidence edits', () => sourceEvidenceEditsStore.saveCaption(id, input)) })
  handle('set-source-evidence-hidden', (id, input) => { validId(id); return localDataOperation('Source evidence edits', () => sourceEvidenceEditsStore.setHidden(id, input)) })
  handle('load-summary-evidence', id => { validId(id); return localDataOperation('Summary evidence', () => summaryEvidenceStore.load(id)) })
  handle('save-summary-evidence-capture', (id, input) => { validId(id); return localDataOperation('Summary evidence', () => summaryEvidenceStore.save(id, input, decodeImage)) })
  handle('reset-summary-evidence-crop', (id, entryId) => { validId(id); validId(entryId); return localDataOperation('Summary evidence', () => summaryEvidenceStore.reset(id, entryId)) })
  handle('load-summary-figures', id => { validId(id); return localDataOperation('Summary figures', () => summaryFigureStore.load(id)) })
  handle('save-summary-figure', (id, input) => { validId(id); return localDataOperation('Summary figure', () => summaryFigureStore.save(id, input, decodeImage)) })
  handle('reset-summary-figure', (id, entryId) => { validId(id); validId(entryId); return localDataOperation('Summary figure', () => summaryFigureStore.reset(id, entryId)) })
  handle('load-tables', id => { validId(id); return localDataOperation('Tables', () => tableStore.load(id)) })
  handle('save-tables', (id, input) => { validId(id); return localDataOperation('Tables', () => tableStore.save(id, input)) })
  handle('export-table-csv', (id, tableId) => fileOperations.run(() => localDataOperation('Table export', async () => {
    validId(id); validId(tableId)
    const owner = window
    if (!owner) throw new Error('Window unavailable')
    if (exportingTable || exportingCanvas || importing) throw new Error('Finish the current file dialog before exporting a table.')
    exportingTable = true
    try {
      const tables = await tableStore.load(id)
      const table = tables?.tables.find(value => value.id === tableId)
      if (!table) throw new Error('This saved table is unavailable. Extract tables before exporting.')
      const paper = (await store.list()).find(value => value.id === id && !value.isDemo)
      if (!paper) throw new Error('Import a PDF before exporting tables.')
      const metadata = (await store.loadLibraryMetadata())[id]
      return await saveTableCsvExport(table, tableCsvFileName(metadata?.title ?? paper.title, table.label), store.root, defaultPath => protectedSaveDialog(owner, {
        title: 'Export experimental table CSV — choose a new file name', defaultPath,
        filters: [{ name: 'CSV table', extensions: ['csv'] }], properties: ['showOverwriteConfirmation', 'createDirectory']
      }))
    } finally { exportingTable = false }
  })))
  handle('load-references', id => { validId(id); return localDataOperation('References', () => referenceStore.load(id)) })
  handle('build-references', id => { validId(id); return localDataOperation('References', () => referenceStore.build(id)) })
  handle('verify-reference', (id, referenceId) => { validId(id); validId(referenceId); return localDataOperation('Reference verification', () => referenceStore.verify(id, referenceId)) })
  handle('export-reading-notes', id => fileOperations.run(async () => {
    validId(id)
    const owner = window
    if (!owner) throw new Error('Window unavailable')
    await store.flush()
    const paper = (await store.list()).find(item => item.id === id)
    if (!paper) throw new Error('Import a PDF before exporting reading notes.')
    const [state, marks, summary, ink] = await Promise.all([store.loadState(id), store.loadMarks(id), store.loadSummary(id), store.loadPdfInk(id)])
    const information = (await store.loadLibraryMetadata())[id]
    const effectivePaper = information ? { ...paper, ...information } : paper
    const content = formatReadingExport(effectivePaper, state, marks, summary, ink)
    return saveMarkdownExport(content, readingExportFileName(effectivePaper.title), defaultPath => protectedSaveDialog(owner, {
      title: 'Export reading notes', defaultPath,
      filters: [{ name: 'Markdown document', extensions: ['md'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory']
    }))
  }))
  handle('export-annotated-pdf', id => fileOperations.run(async () => {
    validId(id)
    const owner = window
    if (!owner) throw new Error('Window unavailable')
    return exportAnnotatedPdf(store, id, defaultPath => protectedSaveDialog(owner, {
      title: 'Export annotated PDF — choose a new file name', defaultPath,
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory']
    }))
  }))
  handle('get-settings', () => publicSettings())
  handle('save-settings', input => { validateSettings(input); return saveSettings(input) })
  handle('copy-text', value => {
    if (typeof value !== 'string' || !value.trim() || value.length > 200_000) throw new Error('Nothing readable to copy, or the answer is too long.')
    clipboard.writeText(value)
  })
  handle('ask-ai', async value => {
    validateRequest(value); const request: AIRequest = value
    const model = privateSettings.model
    const owner = window
    if (!owner) throw new Error('Window unavailable')
    const sender = owner.webContents
    const frame = sender.mainFrame
    return activeRequests.run(request.requestId, request.paperId, 'chat', async signal => {
      await store.loadState(request.paperId)
      return askDeepSeek(request, model, decryptKey(), signal, fetch, progress => {
        if (!signal.aborted && window === owner && !owner.isDestroyed() && !sender.isDestroyed() && sender.mainFrame === frame && frame.url === loadedUrl) sender.send('paper-reader:ai-progress', progress)
      },(paperId,imageId)=>aiImageStore.read(paperId,imageId))
    })
  })
  handle('load-general-chat', () => localDataOperation('General chat', () => generalStore.load()))
  handle('save-general-chat', async value => {
    validateGeneralChatState(value)
    try { await generalStore.save(value) }
    catch (error) {
      await releaseUnsaved({ scope: 'general', conversationId: value.conversationId }, value.messages)
      throw error
    }
    await reconcileSaved({ scope: 'general', conversationId: value.conversationId })
  })
  handle('load-ai-requests', owner => { validateRequestOwner(owner); return localDataOperation('Request history', () => requestHistory.load(owner)) })
  handle('ask-recorded-ai', value => {
    validateRecordedAIRequest(value)
    const owner: AIRequestOwner = { scope: 'paper', paperId: value.request.paperId }, model = privateSettings.model
    return runRecorded(owner, value.request.requestId, signal => recordedAI.askPaper(value, model, decryptKey(), signal, recordedProgress(owner, value.request.requestId, signal)))
  })
  handle('ask-general-ai', value => {
    validateGeneralAIRequest(value)
    const owner: AIRequestOwner = { scope: 'general', conversationId: value.conversationId }, model = privateSettings.model
    return runRecorded(owner, value.requestId, signal => recordedAI.askGeneral(value, model, decryptKey(), signal, recordedProgress(owner, value.requestId, signal)))
  })
  handle('retry-ai-request', value => {
    validateRetryAIRequest(value)
    return runRecorded(value.owner, value.requestId, signal => recordedAI.retry(value, decryptKey(), signal, recordedProgress(value.owner, value.requestId, signal)))
  })
  handle('generate-summary', value => {
    validateSummaryRequest(value)
    return activeRequests.run(value.requestId, value.paperId, 'summary', signal => generatePaperSummary(store, value, privateSettings.model, decryptKey(), signal))
  })
  handle('load-summary-job', value => loadSummaryJob(store, validateSummaryJobQuery(value), privateSettings.model))
  handle('load-summary-draft', value => loadSummaryDraft(store, validateSummaryJobQuery(value), privateSettings.model))
  handle('resume-summary', value => {
    const request = validateSummaryResumeRequest(value)
    return activeRequests.run(request.requestId, request.paperId, 'summary', signal => resumePaperSummary(store, request, privateSettings.model, decryptKey(), signal))
  })
  handle('cancel-ai', async (id,options) => {
    validId(id); activeRequests.cancel(id)
    if(options!==undefined){object(options);if(Object.keys(options).some(k=>k!=='keepAgent')||typeof options.keepAgent!=='boolean')throw Error('Invalid cancellation options')}
    if(!options?.keepAgent)await automation.cancelClient(id)
    const owner = recordedOwners.get(id)
    if (owner) { await requestHistory.settle(owner, id, 'cancelled').catch(() => undefined); recordedOwners.delete(id) }
  })
  handle('set-fullscreen', value => {
    if (typeof value !== 'boolean') throw new Error('Invalid fullscreen state')
    if (!window || window.isDestroyed()) throw new Error('Window unavailable')
    window.setFullScreen(value)
    return value
  })
  handle('set-desktop-menu-state', state => { const value = validateDesktopMenuState(state); desktopMenus?.update(value) })
  handle('open-desktop-menu', async (name, x, y) => {
    if (!['file', 'edit', 'view', 'help'].includes(name as string)) throw new Error('Invalid desktop menu')
    if (!window || !desktopMenus) throw new Error('Desktop menus unavailable')
    const [width, height] = window.getContentSize()
    if (!Number.isInteger(x) || !Number.isInteger(y) || (x as number) < 0 || (y as number) < 0 || (x as number) >= width || (y as number) >= height) throw new Error('Invalid desktop menu position')
    await desktopMenus.popup(name as import('../shared/types').DesktopMenuName, x as number, y as number)
  })
  handle('window-control', async action => {
    if (!['minimize', 'maximize', 'close'].includes(action as string)) throw new Error('Invalid window action')
    if (action === 'minimize') window?.minimize()
    if (action === 'maximize') { if (window?.isMaximized()) window.unmaximize(); else window?.maximize() }
    if (action === 'close') { window?.close() }
  })
}
async function createWindow(): Promise<void> {
  const productionPath = join(__dirname, '../renderer/index.html')
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  loadedUrl = developmentUrl ? new URL(developmentUrl).href : pathToFileURL(productionPath).href
  window = new BrowserWindow({ width: 1500, height: 940, minWidth: 1020, minHeight: 700, frame: false, show: false, backgroundColor: '#f5f4f1', title: 'Paper Reader', webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const owner = window
  desktopMenus = createDesktopMenus(owner, command => {
    if (window === owner && !owner.isDestroyed() && !owner.webContents.isDestroyed() && owner.webContents.mainFrame.url === loadedUrl) owner.webContents.send('paper-reader:desktop-command', command)
  })
  const stopFullscreen = watchNativeFullscreen(owner, value => {
    if (window === owner && !owner.isDestroyed()) owner.webContents.send('paper-reader:fullscreen-change', value)
  })
  owner.webContents.session.setPermissionCheckHandler((contents,permission,_origin,details)=>{
    if(contents!==owner.webContents||permission!=='media'||owner.webContents.mainFrame.url!==loadedUrl||details.isMainFrame===false)return false
    const kind=(details as unknown as {mediaType?:string}).mediaType
    return kind==='audio'?automation.devices.microphone:kind==='video'?automation.devices.camera:automation.devices.microphone||automation.devices.camera
  })
  owner.webContents.session.setPermissionRequestHandler((contents,permission,callback,details)=>{
    const media=(details as unknown as {mediaTypes?:string[]}).mediaTypes
    callback(contents===owner.webContents&&owner.webContents.mainFrame.url===loadedUrl&&permission==='media'&&details.isMainFrame!==false&&Array.isArray(media)&&media.length>0&&media.every(kind=>kind==='audio'?automation.devices.microphone:kind==='video'?automation.devices.camera:false))
  })
  owner.once('closed', stopFullscreen)
  window.webContents.on('will-navigate', (event, url) => { if (url !== loadedUrl) event.preventDefault() })
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  window.once('ready-to-show', () => window?.show())
  let closeReady = false
  window.on('close', event => {
    if (closeReady) return
    event.preventDefault()
    automation?.cancelAll()
    activeRequests.cancelAll()
    referenceStore.cancelAll()
    void flushStores().then(() => { closeReady = true; window?.close() }).catch(() => { dialog.showErrorBox('Save before closing', 'Local edits could not be saved. Keep this window open and try again. Existing files were preserved.') })
  })
  window.on('closed', () => { activeRequests.cancelAll(); referenceStore.cancelAll(); desktopMenus?.dispose(); desktopMenus = null; window = null })
  if (developmentUrl) await window.loadURL(developmentUrl); else await window.loadFile(productionPath)
}
app.whenReady().then(async () => {
  store = new PaperStore(process.env.PAPER_READER_DATA_DIR || app.getPath('userData'), {managedDirectory:await initialManagedDirectory()})
  aiImageStore = new AIImageStore(store.root, async id=>{if(!(await store.list()).some(p=>p.id===id&&!p.isDemo))throw Error('AI image paper not found')},bytes=>{const size=decodeImage(bytes);if(!size)throw Error('AI image could not be decoded');return size})
  libraryActivity = new LibraryActivityStore(store)
  canvasStore = new CanvasStore(store)
  diagramStore = new DiagramStore(store)
  legacyNotebookStore = new NotebookStore(store, canvasStore, diagramStore)
  notebookStore = new NotebookStore(store, canvasStore, diagramStore, { infinite: true, legacy: legacyNotebookStore })
  generalStore = new GeneralChatStore(store)
  const readMessages = async (owner: AIRequestOwner) => {
    if (owner.scope === 'paper') return (await store.loadState(owner.paperId)).messages
    const state = await generalStore.load()
    if (state.conversationId !== owner.conversationId) throw new Error('General conversation not found')
    return state.messages
  }
  requestHistory = new RequestHistoryStore(store, readMessages)
  recordedAI = new RecordedAIService({ history: requestHistory, readMessages, readGeneral: () => generalStore.load(), readAIImage:(paperId,imageId)=>aiImageStore.read(paperId,imageId) })
  sourceIndexStore = new SourceIndexStore(store)
  sourceEvidenceEditsStore = new SourceEvidenceEditsStore(store, sourceIndexStore)
  summaryFigureStore = new SummaryFigureStore(store, canvasStore, sourceIndexStore)
  summaryEvidenceStore = new SummaryEvidenceStore(store, canvasStore, sourceIndexStore, summaryFigureStore)
  tableStore = new TableStore(store)
  referenceStore = new ReferenceStore(store, sourceIndexStore, (input, init) => fetch(input, init))
  try {
    privateSettings = await store.readJson<PrivateSettings>(join(store.root, 'settings.json'), value => {
      object(value)
      validateSettings({ model: value.model })
      if (value.encryptedKey !== undefined && (typeof value.encryptedKey !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(value.encryptedKey))) throw new Error('Invalid encrypted settings')
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') dialog.showErrorBox('Settings recovery', 'Saved settings could not be read. Files were preserved. Enter your settings again.')
  }
  automation = new AutomationRuntime({store,notebookStore,diagramStore,canvasStore,images:aiImageStore,references:referenceStore,general:generalStore,requests:activeRequests,files:fileOperations,window:()=>window,loadedUrl:()=>loadedUrl,model:()=>privateSettings.model,key:decryptKey})
  registerIPC(); await createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
}).catch(() => { dialog.showErrorBox('Paper Reader', 'The desktop application could not start. Verify the local build and data directory.'); app.quit() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
