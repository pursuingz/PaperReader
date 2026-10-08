import type { Paper, PaperState, PaperSummary, PdfInk, ReadingMarks } from '../shared/types'

function literal(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()#+\-.!|]/g, '\\$&')
}
const heading = (value: string): string => literal(value.replace(/[\r\n\t]+/g, ' ').trim())
const pages = (value: readonly number[]): string => value.length ? value.join(', ') : 'none'

export function formatReadingExport(paper: Paper, state: PaperState, marks: ReadingMarks, summary: PaperSummary | null, ink: PdfInk): string {
  const sections = [
    `# ${heading(paper.title) || 'Untitled paper'}`,
    `Source PDF: ${heading(paper.fileName)}`,
    '## Text notes',
    state.note.trim() ? state.note : 'No text notes.',
    '## Highlights and comments'
  ]
  if (!marks.highlights.length) sections.push('No saved highlights.')
  for (const highlight of [...marks.highlights].sort((left, right) => left.page - right.page)) {
    sections.push(`### Page ${highlight.page}`)
    if (highlight.quote) sections.push(literal(highlight.quote).split(/\r?\n/).map(line => `> ${line}`).join('\n'))
    if (highlight.comment) sections.push(`Comment:\n\n${literal(highlight.comment)}`)
  }
  sections.push('## Saved summary')
  if (!summary) sections.push('No saved summary.')
  else {
    sections.push(
      'AI-generated summary. Page references do not establish factual correctness.',
      `Model: ${heading(summary.model)}\n\nGenerated at: ${summary.createdAt}`,
      `Total PDF pages: ${summary.pageCount}\n\nPages with extracted text: ${pages(summary.coveredPages)}\n\nPages without extracted text: ${pages(summary.missingPages)}`
    )
    for (const section of summary.sections) {
      sections.push(`### ${heading(section.title)}`, section.content, `Source pages: ${pages(section.pages)}`)
    }
  }
  sections.push(
    '## Visual ink',
    `Visual ink is not included in this Markdown export (PDF ink: ${ink.strokes.length} strokes; note ink: ${marks.strokes.length} strokes). Open Paper Reader to view the saved drawings.`
  )
  return sections.join('\n\n') + '\n'
}

export function readingExportFileName(title: string): string {
  let name = title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, '-').replace(/\s+/g, ' ').trim()
  name = name.replace(/^[.\s-]+|[.\s-]+$/g, '')
  if (!name) name = 'paper'
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) name = '_' + name
  // Keep Unicode code points intact while respecting Windows filename length.
  let bounded = ''
  for (const character of name) {
    if (bounded.length + character.length > 120) break
    bounded += character
  }
  return `${bounded.replace(/[.\s]+$/g, '')}-reading-notes.md`
}
