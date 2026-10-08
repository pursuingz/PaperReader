import { contextBridge, ipcRenderer } from 'electron'
import type { AIProgress, GeneralAIProgress, DesktopAPI, DesktopCommand } from '../shared/types'
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(`paper-reader:${channel}`, ...args)
const api: DesktopAPI = {
  listPapers: () => invoke('list'),
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
  cancelAI: requestId => invoke('cancel-ai', requestId),
  generateSummary: request => invoke('generate-summary', request),
  loadSummary: paperId => invoke('load-summary', paperId),
  loadMarks: paperId => invoke('load-marks', paperId),
  saveMarks: (paperId, marks) => invoke('save-marks', paperId, marks),
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
