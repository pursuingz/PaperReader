import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, safeStorage } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PaperStore } from './storage'
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

let window: BrowserWindow | null = null
let store: PaperStore
let canvasStore: CanvasStore
let sourceIndexStore: SourceIndexStore
let summaryFigureStore: SummaryFigureStore
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
  await Promise.all([store.flush(), canvasStore.flush(), diagramStore.flush(), generalStore.flush(), requestHistory.flush(), sourceIndexStore.flush(), summaryFigureStore.flush(), tableStore.flush(), referenceStore.flush(), fileOperations.flush(), settingsTail])
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
function registerIPC(): void {
  const handle = (channel: string, handler: (...args: unknown[]) => unknown) => ipcMain.handle(`paper-reader:${channel}`, (event, ...args: unknown[]) => { trustedSender(event); return handler(...args) })
  handle('list', () => store.list())
  handle('import', () => fileOperations.run(async () => {
    if (!window) throw new Error('Window unavailable')
    if (importing || exportingTable || exportingCanvas) throw new Error('Finish the current file dialog before importing a PDF.')
    importing = true
    try {
      const selection = await dialog.showOpenDialog(window, { title: 'Import PDF', properties: ['openFile'], filters: [{ name: 'PDF documents', extensions: ['pdf'] }] })
      return selection.canceled || !selection.filePaths[0] ? null : await store.importPdf(selection.filePaths[0])
    } finally { importing = false }
  }))
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
  handle('load-library-organization', () => store.loadLibraryOrganization())
  handle('create-category', name => store.createCategory(validateCategoryName(name)))
  handle('rename-category', (id, name) => { validateCategoryId(id); return store.renameCategory(id, validateCategoryName(name)) })
  handle('assign-paper-category', (id, categoryId) => { validId(id); validateAssignment(id, categoryId); return store.assignPaperCategory(id, categoryId as string | null) })
  handle('load-library-metadata', () => store.loadLibraryMetadata())
  handle('save-paper-metadata', (id, input) => { validId(id); return store.savePaperMetadata(id, normalizePaperMetadata(input)) })
  handle('load-pdf-ink', id => { validId(id); return store.loadPdfInk(id) })
  handle('save-pdf-ink', (id, ink) => { validId(id); validatePdfInk(ink); return store.savePdfInk(id, ink) })
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
    await canvasStore.load(id)
    const selection = await dialog.showOpenDialog(owner, { title: 'Insert canvas image', properties: ['openFile'], filters: [{ name: 'PNG or JPEG images', extensions: ['png', 'jpg', 'jpeg'] }] })
    if (selection.canceled || !selection.filePaths[0]) return null
    const image = await prepareCanvasImage(selection.filePaths[0], bytes => {
      const decoded = nativeImage.createFromBuffer(Buffer.from(bytes))
      return decoded.isEmpty() ? null : decoded.getSize()
    })
    return canvasStore.importImage(id, image.bytes, image.info)
  })))
  const decodeImage = (bytes: Uint8Array) => {
    const image = nativeImage.createFromBuffer(Buffer.from(bytes))
    return image.isEmpty() ? null : image.getSize()
  }
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
      return await saveCanvasPngExport(bytes, canvasPngFileName(information?.title ?? paper.title), store.root, defaultPath => dialog.showSaveDialog(owner, {
        title: 'Export full Canvas PNG — choose a new file name', defaultPath,
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
      return await saveMindMapPngExport(bytes, mindMapPngFileName(information?.title ?? paper.title), store.root, defaultPath => dialog.showSaveDialog(owner, {
        title: 'Export complete Mind map PNG — choose a new file name', defaultPath,
        filters: [{ name: 'PNG image', extensions: ['png'] }], properties: ['showOverwriteConfirmation', 'createDirectory']
      }), decodeImage)
    } finally { exportingCanvas = false }
  })))
  handle('save-source-index', (id, value) => { validId(id); return localDataOperation('Source index', () => sourceIndexStore.save(id, value)) })
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
      return await saveTableCsvExport(table, tableCsvFileName(metadata?.title ?? paper.title, table.label), store.root, defaultPath => dialog.showSaveDialog(owner, {
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
    return saveMarkdownExport(content, readingExportFileName(effectivePaper.title), defaultPath => dialog.showSaveDialog(owner, {
      title: 'Export reading notes', defaultPath,
      filters: [{ name: 'Markdown document', extensions: ['md'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory']
    }))
  }))
  handle('export-annotated-pdf', id => fileOperations.run(async () => {
    validId(id)
    const owner = window
    if (!owner) throw new Error('Window unavailable')
    return exportAnnotatedPdf(store, id, defaultPath => dialog.showSaveDialog(owner, {
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
      })
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
  handle('cancel-ai', async id => {
    validId(id); activeRequests.cancel(id)
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
    if (action === 'close') { referenceStore.cancelAll(); await flushStores(); window?.close() }
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
  owner.once('closed', stopFullscreen)
  window.webContents.on('will-navigate', (event, url) => { if (url !== loadedUrl) event.preventDefault() })
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  window.once('ready-to-show', () => window?.show())
  let closeReady = false
  window.on('close', event => {
    if (closeReady) return
    event.preventDefault()
    activeRequests.cancelAll()
    referenceStore.cancelAll()
    void flushStores().then(() => { closeReady = true; window?.close() }).catch(() => { dialog.showErrorBox('Save before closing', 'Local edits could not be saved. Keep this window open and try again. Existing files were preserved.') })
  })
  window.on('closed', () => { activeRequests.cancelAll(); referenceStore.cancelAll(); desktopMenus?.dispose(); desktopMenus = null; window = null })
  if (developmentUrl) await window.loadURL(developmentUrl); else await window.loadFile(productionPath)
}
app.whenReady().then(async () => {
  store = new PaperStore(process.env.PAPER_READER_DATA_DIR || app.getPath('userData'))
  canvasStore = new CanvasStore(store)
  diagramStore = new DiagramStore(store)
  generalStore = new GeneralChatStore(store)
  const readMessages = async (owner: AIRequestOwner) => {
    if (owner.scope === 'paper') return (await store.loadState(owner.paperId)).messages
    const state = await generalStore.load()
    if (state.conversationId !== owner.conversationId) throw new Error('General conversation not found')
    return state.messages
  }
  requestHistory = new RequestHistoryStore(store, readMessages)
  recordedAI = new RecordedAIService({ history: requestHistory, readMessages, readGeneral: () => generalStore.load() })
  sourceIndexStore = new SourceIndexStore(store)
  summaryFigureStore = new SummaryFigureStore(store, canvasStore, sourceIndexStore)
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
  registerIPC(); await createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
}).catch(() => { dialog.showErrorBox('Paper Reader', 'The desktop application could not start. Verify the local build and data directory.'); app.quit() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
