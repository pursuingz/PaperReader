import type { CanvasDiagram, MindMapDocument } from './diagramTypes'
import type { AIRequestOwner, AIRequestHistory, RecordedAIRequest, RetryAIRequest, AIReplayResult, GeneralChatState, GeneralAIRequest, GeneralAIResult, GeneralAIProgress } from './requestTypes'
export type * from './diagramTypes'
export type * from './requestTypes'

export interface Paper {
  id: string
  title: string
  fileName: string
  importedAt: string
  category: string
  pageCount?: number
  isDemo?: boolean
  authors?: string
  year?: number | null
}

export interface PaperMetadata { title: string; authors: string; year: number | null }
export type LibraryMetadata = Record<string, PaperMetadata>

export interface ChatMessage {
  id: string
  paperId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  isDemo?: boolean
}

export interface PaperState {
  note: string
  messages: ChatMessage[]
  lastPage: number
}

export interface AppSettings {
  provider: 'deepseek'
  model: string
  hasApiKey: boolean
}

export interface SettingsInput {
  model: string
  apiKey?: string
}

export type AIContextMode = 'page' | 'paper' | 'notes' | 'paper-notes'

export interface AIRequest {
  requestId: string
  paperId: string
  question: string
  action?: 'ask' | 'organize-notes'
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  context: {
    mode?: AIContextMode
    paperTitle: string
    page: number
    pageText: string
    selection?: string
    pages?: PdfTextPage[]
    note?: string
  }
}

export interface AIResult {
  requestId: string
  paperId: string
  content: string
  historyWarning?: string
}

export type AIProgress =
  | { requestId: string; paperId: string; attempt: 1 | 2; type: 'reset' }
  | { requestId: string; paperId: string; attempt: 1 | 2; type: 'delta'; content: string }

export interface PdfTextPage { page: number; text: string }
export interface SummarySection { id: string; title: string; content: string; pages: number[] }
export interface PaperSummary {
  paperId: string
  createdAt: string
  model: string
  pageCount: number
  coveredPages: number[]
  missingPages: number[]
  sections: SummarySection[]
}
export interface SummaryRequest { requestId: string; paperId: string; pages: PdfTextPage[] }
export interface NormalizedRect { x: number; y: number; width: number; height: number }
export interface Highlight {
  id: string; page: number; quote: string; comment: string; color: 'yellow' | 'coral' | 'mint'; rects: NormalizedRect[]; createdAt: string
}
export interface InkStroke { id: string; points: Array<{ x: number; y: number }>; color: string; width: number }
export interface ReadingMarks { highlights: Highlight[]; strokes: InkStroke[] }
export interface PaperCategory { id: string; name: string }
export interface LibraryOrganization { categories: PaperCategory[]; assignments: Record<string, string> }
export interface PdfInkStroke extends InkStroke { page: number }
export interface PdfInk { strokes: PdfInkStroke[] }
export interface NoteExportResult { canceled: boolean; fileName?: string }

export interface CanvasTextObject { id: string; type: 'text'; x: number; y: number; width: number; height: number; text: string; color: string; fontSize: number }
export interface CanvasImageObject { id: string; type: 'image'; x: number; y: number; width: number; height: number; assetId: string }
export interface CanvasStrokeObject { id: string; type: 'stroke'; points: Array<{ x: number; y: number }>; color: string; strokeWidth: number }
export type CanvasObject = CanvasTextObject | CanvasImageObject | CanvasStrokeObject
export interface CanvasDocument { version: 1; width: 1000; height: 1200; objects: CanvasObject[] }
export interface CanvasImageAsset { assetId: string; mimeType: 'image/png' | 'image/jpeg'; width: number; height: number }
export interface CanvasImageSource { page: number; rect: NormalizedRect }
export interface PdfCaptureInput extends CanvasImageSource { bytes: Uint8Array }
export interface CanvasImageData extends CanvasImageAsset { bytes: Uint8Array; source?: CanvasImageSource }
export type DesktopMenuName = 'file' | 'edit' | 'view' | 'help'
export type DesktopCommand = 'import' | 'save' | 'export-notes' | 'export-pdf' | 'export-canvas' | 'home' | 'reader' | 'summary' | 'toggle-assistant' | 'toggle-focus' | 'back' | 'forward' | 'find' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'read-mode' | 'pan-mode' | 'capture-mode' | 'settings' | 'help' | 'about' | 'close'
export interface DesktopMenuState {
  hasPaper: boolean; hasRealPaper: boolean; busy: boolean; canBack: boolean; canForward: boolean
  focusMode: boolean; rightOpen: boolean; canvasReady: boolean; readerView: 'reader' | 'summary'
  notesReady?: boolean; notesExportReady?: boolean; pdfExportReady?: boolean; canvasExportReady?: boolean
}
export interface PaperSourceEntry { id: string; kind: 'figure' | 'table' | 'reference' | 'reference-section'; label: string; text: string; pages: number[] }
export interface PaperSourceIndex {
  paperId: string; extractorVersion: 1; createdAt: string; pageCount: number
  indexedPages: number[]; textlessPages: number[]; failedPages: number[]; limitReached: boolean
  entries: PaperSourceEntry[]
}

export interface SummaryFigureCrop { entryId: string; caption: string; page: number; rect: NormalizedRect; assetId: string }
export interface SummaryFigures { paperId: string; version: 1; crops: SummaryFigureCrop[] }
export interface SummaryFigureCapture extends PdfCaptureInput { entryId: string; caption: string }
export interface TableColumn { id: string; header: string; unit: string | null }
export interface TableCell { raw: string }
export interface PaperTable {
  id: string; label: string; page: number; columns: TableColumn[]; rows: TableCell[][]
  notes: string[]; rawText: string; status: 'candidate' | 'unsupported'; reason?: string
}
export interface PaperTables {
  paperId: string; extractorVersion: 1; createdAt: string; pageCount: number
  indexedPages: number[]; textlessPages: number[]; failedPages: number[]; limitReached: boolean
  tables: PaperTable[]
}
export interface ReferenceFields { title?: string; authors?: string[]; year?: number; venue?: string; doi?: string }
export interface ReferenceCandidate { doi: string; title: string; authors: string[]; year?: number; venue?: string; assessment: 'consistent' | 'uncertain' | 'conflict'; reasons: string[] }
export interface ReferenceVerification { provider: 'crossref'; checkedAt: string; method: 'doi' | 'bibliographic'; status: 'matched' | 'ambiguous' | 'conflict' | 'not-found'; candidates: ReferenceCandidate[] }
export interface PaperReference { id: string; sourceEntryId: string; rawText: string; pages: number[]; segmentation: 'entry' | 'unsegmented'; fields: ReferenceFields; verification: ReferenceVerification | null }
export interface PaperReferences { paperId: string; version: 1; sourceRevision: string; sourceCreatedAt: string; builtAt: string; sourceLimitReached: boolean; records: PaperReference[] }

export interface DesktopAPI {
  listPapers(): Promise<Paper[]>
  importPaper(): Promise<Paper | null>
  readPaper(paperId: string): Promise<Uint8Array>
  loadPaperState(paperId: string): Promise<PaperState>
  savePaperState(paperId: string, state: PaperState): Promise<void>
  getSettings(): Promise<AppSettings>
  saveSettings(input: SettingsInput): Promise<AppSettings>
  askAI(request: AIRequest): Promise<AIResult>
  onAIProgress(listener: (progress: AIProgress) => void): () => void
  copyText(text: string): Promise<void>
  cancelAI(requestId: string): Promise<void>
  generateSummary(request: SummaryRequest): Promise<PaperSummary>
  loadSummary(paperId: string): Promise<PaperSummary | null>
  loadMarks(paperId: string): Promise<ReadingMarks>
  saveMarks(paperId: string, marks: ReadingMarks): Promise<void>
  loadLibraryOrganization(): Promise<LibraryOrganization>
  createCategory(name: string): Promise<LibraryOrganization>
  renameCategory(categoryId: string, name: string): Promise<LibraryOrganization>
  assignPaperCategory(paperId: string, categoryId: string | null): Promise<LibraryOrganization>
  loadLibraryMetadata(): Promise<LibraryMetadata>
  savePaperMetadata(paperId: string, input: PaperMetadata): Promise<LibraryMetadata>
  loadPdfInk(paperId: string): Promise<PdfInk>
  savePdfInk(paperId: string, ink: PdfInk): Promise<void>
  exportReadingNotes(paperId: string): Promise<NoteExportResult>
  exportAnnotatedPdf(paperId: string): Promise<NoteExportResult>
  loadCanvas(paperId: string): Promise<CanvasDocument>
  saveCanvas(paperId: string, canvas: CanvasDocument): Promise<void>
  importCanvasImage(paperId: string): Promise<CanvasImageAsset | null>
  saveCanvasCapture(paperId: string, capture: PdfCaptureInput): Promise<CanvasImageAsset>
  exportCanvasPng(paperId: string, bytes: Uint8Array): Promise<NoteExportResult>
  loadCanvasDiagram(paperId: string): Promise<CanvasDiagram>
  saveCanvasDiagram(paperId: string, value: CanvasDiagram): Promise<void>
  loadMindMap(paperId: string): Promise<MindMapDocument>
  saveMindMap(paperId: string, value: MindMapDocument): Promise<void>
  exportMindMapPng(paperId: string, bytes: Uint8Array): Promise<NoteExportResult>
  readCanvasImage(paperId: string, assetId: string): Promise<CanvasImageData>
  loadSourceIndex(paperId: string): Promise<PaperSourceIndex | null>
  saveSourceIndex(paperId: string, index: PaperSourceIndex): Promise<void>
  loadSummaryFigures(paperId: string): Promise<SummaryFigures>
  saveSummaryFigure(paperId: string, capture: SummaryFigureCapture): Promise<SummaryFigures>
  resetSummaryFigure(paperId: string, entryId: string): Promise<SummaryFigures>
  loadTables(paperId: string): Promise<PaperTables | null>
  saveTables(paperId: string, tables: PaperTables): Promise<void>
  exportTableCsv(paperId: string, tableId: string): Promise<NoteExportResult>
  loadReferences(paperId: string): Promise<PaperReferences | null>
  buildReferences(paperId: string): Promise<PaperReferences>
  verifyReference(paperId: string, referenceId: string): Promise<PaperReferences>
  loadGeneralChat(): Promise<GeneralChatState>
  saveGeneralChat(value: GeneralChatState): Promise<void>
  askGeneralAI(value: GeneralAIRequest): Promise<GeneralAIResult>
  onGeneralAIProgress(listener: (value: GeneralAIProgress) => void): () => void
  askRecordedAI(value: RecordedAIRequest): Promise<AIResult>
  loadAIRequests(owner: AIRequestOwner): Promise<AIRequestHistory>
  retryAIRequest(value: RetryAIRequest): Promise<AIReplayResult>
  windowControl(action: 'minimize' | 'maximize' | 'close'): Promise<void>
  setFullscreen(value: boolean): Promise<boolean>
  onFullscreenChange(listener: (value: boolean) => void): () => void
  openDesktopMenu(name: DesktopMenuName, x: number, y: number): Promise<void>
  setDesktopMenuState(state: DesktopMenuState): Promise<void>
  onDesktopCommand(listener: (command: DesktopCommand) => void): () => void
}

declare global {
  interface Window {
    paperReader: DesktopAPI
  }
}
