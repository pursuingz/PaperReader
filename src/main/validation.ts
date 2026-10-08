import type { AIRequest, PaperState, PaperSummary, ReadingMarks, SettingsInput, SummaryRequest, SummarySection } from '../shared/types'
export function validId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) throw new Error('Invalid identifier')
}
export function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid input')
}
export function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid text input')
}
export function validateState(value: unknown, paperId: string): asserts value is PaperState {
  object(value); text(value.note, 2_000_000)
  if (!Number.isInteger(value.lastPage) || (value.lastPage as number) < 1 || (value.lastPage as number) > 100_000 || !Array.isArray(value.messages) || value.messages.length > 1000) throw new Error('Invalid paper state')
  for (const message of value.messages) {
    object(message); validId(message.id)
    if (message.paperId !== paperId || !['user', 'assistant'].includes(message.role as string)) throw new Error('Invalid message identity')
    text(message.content, 200_000); text(message.createdAt, 80)
    if (message.isDemo !== undefined && typeof message.isDemo !== 'boolean') throw new Error('Invalid demo flag')
  }
}
export function validateSettings(value: unknown): asserts value is SettingsInput {
  object(value); text(value.model, 100)
  if (!/^[a-zA-Z0-9._-]+$/.test(value.model)) throw new Error('Invalid model name')
  if (value.apiKey !== undefined) text(value.apiKey, 1000)
}
export function validateRequest(value: unknown): asserts value is AIRequest {
  object(value); validId(value.requestId); validId(value.paperId); text(value.question, 20_000)
  if (!value.question.trim()) throw new Error('Enter a question')
  if (value.action !== undefined && !['ask', 'organize-notes'].includes(value.action as string)) throw new Error('Invalid AI action')
  object(value.context); text(value.context.paperTitle, 1000); text(value.context.pageText, 100_000)
  if (value.context.selection !== undefined) text(value.context.selection, 30_000)
  if (!Number.isInteger(value.context.page) || (value.context.page as number) < 1 || (value.context.page as number) > 100_000) throw new Error('Invalid page')
  const mode = value.context.mode === undefined ? 'page' : value.context.mode
  if (!['page', 'paper', 'notes', 'paper-notes'].includes(mode as string)) throw new Error('Invalid AI context mode')
  if (value.action === 'organize-notes' && mode !== 'notes') throw new Error('Organize notes requires notes-only mode')
  if (value.context.note !== undefined) {
    if (typeof value.context.note !== 'string' || value.context.note.length > 100_000) throw new Error('Notes exceed the 100000 character AI limit or are invalid')
  }
  let hasPaperText = false
  if (value.context.pages !== undefined || mode === 'paper' || mode === 'paper-notes') {
    if (!Array.isArray(value.context.pages) || value.context.pages.length < 1 || value.context.pages.length > 200) throw new Error('Whole-paper context requires between 1 and 200 PDF pages')
    let characters = 0
    for (const [index, page] of value.context.pages.entries()) {
      object(page)
      if (page.page !== index + 1) throw new Error('Whole-paper context must include every PDF page in order, including textless pages')
      text(page.text, 240_000); characters += page.text.length
      if (page.text.trim()) hasPaperText = true
    }
    if (characters > 240_000) throw new Error('Paper text exceeds the 240000 character AI limit')
  }
  const hasNotes = typeof value.context.note === 'string' && Boolean(value.context.note.trim())
  if (mode === 'page' && !value.context.pageText.trim() && !(value.context.selection as string | undefined)?.trim()) throw new Error('Select text or wait for the current PDF page text before asking AI.')
  if (mode === 'notes' && !hasNotes) throw new Error('Write a text note before asking AI about notes.')
  if ((mode === 'notes' || mode === 'paper-notes') && typeof value.context.note !== 'string') throw new Error('Notes context requires a text note')
  if (mode === 'paper' && !hasPaperText) throw new Error('This paper has no extracted text. OCR is not available.')
  if (mode === 'paper-notes' && !hasPaperText && !hasNotes) throw new Error('This paper has no extracted text and the notes are empty.')
  if (!Array.isArray(value.history) || value.history.length > 100) throw new Error('Invalid chat history')
  for (const message of value.history) {
    object(message); text(message.content, 200_000)
    if (!['user', 'assistant'].includes(message.role as string)) throw new Error('Invalid history role')
    if (message.isDemo !== undefined && typeof message.isDemo !== 'boolean') throw new Error('Invalid demo flag')
  }
}

function fields(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid input fields')
}
function finite(value: unknown, min: number, max: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid geometry')
}
function timestamp(value: unknown): asserts value is string {
  text(value, 40)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid timestamp')
}
export function validateMarks(value: unknown): asserts value is ReadingMarks {
  object(value); fields(value, ['highlights', 'strokes'])
  if (!Array.isArray(value.highlights) || value.highlights.length > 2000 || !Array.isArray(value.strokes) || value.strokes.length > 1000) throw new Error('Invalid reading marks or mark limit exceeded')
  const ids = new Set<string>(); let rectangles = 0; let points = 0; let characters = 0
  const identity = (id: unknown) => { validId(id); if (ids.has(id)) throw new Error('Invalid duplicate mark identifier'); ids.add(id) }
  for (const highlight of value.highlights) {
    object(highlight); fields(highlight, ['id', 'page', 'quote', 'comment', 'color', 'rects', 'createdAt']); identity(highlight.id)
    if (!Number.isInteger(highlight.page) || (highlight.page as number) < 1 || (highlight.page as number) > 100_000) throw new Error('Invalid highlight page')
    text(highlight.quote, 20_000); text(highlight.comment, 20_000); timestamp(highlight.createdAt)
    characters += highlight.quote.length + highlight.comment.length
    if (!['yellow', 'coral', 'mint'].includes(highlight.color as string)) throw new Error('Invalid highlight color')
    if (!Array.isArray(highlight.rects) || !highlight.rects.length || highlight.rects.length > 1000) throw new Error('Invalid highlight rectangles')
    rectangles += highlight.rects.length
    for (const rect of highlight.rects) {
      object(rect); fields(rect, ['x', 'y', 'width', 'height'])
      finite(rect.x, 0, 1); finite(rect.y, 0, 1); finite(rect.width, Number.MIN_VALUE, 1); finite(rect.height, Number.MIN_VALUE, 1)
      if (rect.x + rect.width > 1 + 1e-6 || rect.y + rect.height > 1 + 1e-6) throw new Error('Invalid rectangle outside PDF page')
    }
  }
  for (const stroke of value.strokes) {
    object(stroke); fields(stroke, ['id', 'points', 'color', 'width']); identity(stroke.id)
    if (typeof stroke.color !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(stroke.color)) throw new Error('Invalid ink color')
    finite(stroke.width, Number.MIN_VALUE, 0.1)
    if (!Array.isArray(stroke.points) || stroke.points.length < 2 || stroke.points.length > 10_000) throw new Error('Invalid ink points or point limit exceeded')
    points += stroke.points.length
    for (const point of stroke.points) { object(point); fields(point, ['x', 'y']); finite(point.x, 0, 1); finite(point.y, 0, 1) }
  }
  if (rectangles > 20_000 || points > 200_000 || characters > 2_000_000) throw new Error('Reading marks limit exceeded')
}

export const SUMMARY_SECTION_IDS = ['keywords', 'overview', 'background', 'methods', 'results', 'limitations'] as const
export function validateSummaryRequest(value: unknown): asserts value is SummaryRequest {
  object(value); fields(value, ['requestId', 'paperId', 'pages']); validId(value.requestId); validId(value.paperId)
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 200) throw new Error('Summary requires between 1 and 200 PDF pages')
  let characters = 0
  for (const [index, page] of value.pages.entries()) {
    object(page); fields(page, ['page', 'text'])
    if (page.page !== index + 1) throw new Error('Summary pages must include every PDF page in order, including textless pages')
    text(page.text, 240_000); characters += page.text.length
  }
  if (characters > 240_000) throw new Error('Paper text exceeds the 240000 character summary limit')
}
function pageReferences(value: unknown, allowed: ReadonlySet<number>, message: string): asserts value is number[] {
  if (!Array.isArray(value) || value.length > 200 || new Set(value).size !== value.length || value.some(page => !Number.isInteger(page) || !allowed.has(page))) throw new Error(message)
}
export function validateSummarySections(value: unknown, coveredPages: ReadonlySet<number>): asserts value is SummarySection[] {
  if (!Array.isArray(value) || value.length !== SUMMARY_SECTION_IDS.length) throw new Error('Invalid summary sections')
  const ids = new Set<string>(); let characters = 0
  for (const section of value) {
    object(section); fields(section, ['id', 'title', 'content', 'pages'])
    if (!(SUMMARY_SECTION_IDS as readonly unknown[]).includes(section.id) || ids.has(section.id as string)) throw new Error('Invalid summary section identifier')
    ids.add(section.id as string); text(section.title, 120); text(section.content, 10_000)
    if (!section.title.trim() || !section.content.trim()) throw new Error('Invalid empty summary section')
    characters += section.content.length
    pageReferences(section.pages, coveredPages, 'Invalid summary source page: cite only pages with extracted text')
  }
  if (characters > 36_000) throw new Error('Summary sections exceed the text limit')
}
export function validateSummary(value: unknown, paperId: string): asserts value is PaperSummary {
  object(value); fields(value, ['paperId', 'createdAt', 'model', 'pageCount', 'coveredPages', 'missingPages', 'sections'])
  validId(value.paperId)
  if (value.paperId !== paperId) throw new Error('Invalid summary paper identity')
  timestamp(value.createdAt); validateSettings({ model: value.model })
  if (!Number.isInteger(value.pageCount) || (value.pageCount as number) < 1 || (value.pageCount as number) > 200) throw new Error('Invalid summary page count')
  const pages = new Set(Array.from({ length: value.pageCount as number }, (_, index) => index + 1))
  pageReferences(value.coveredPages, pages, 'Invalid summary page coverage'); pageReferences(value.missingPages, pages, 'Invalid summary page coverage')
  const coverage = [...value.coveredPages, ...value.missingPages]
  if (!value.coveredPages.length || coverage.length !== pages.size || new Set(coverage).size !== pages.size) throw new Error('Invalid summary page coverage')
  validateSummarySections(value.sections, new Set(value.coveredPages))
}
