import type { LibraryMetadata, Paper, PaperMetadata } from '../../shared/types'

export function overlayLibraryMetadata(papers: Paper[], metadata: LibraryMetadata): Paper[] {
  return papers.map(paper => applyPaperMetadata(paper, metadata))
}
export function applyPaperMetadata(paper: Paper, metadata: LibraryMetadata): Paper { return !paper.isDemo && Object.hasOwn(metadata, paper.id) ? { ...paper, ...metadata[paper.id] } : paper }
function localDateKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
export function groupRecentLibrary(papers: Paper[], now = new Date()): Array<{ id: string; name: string; papers: Paper[] }> {
  const today = localDateKey(now), yesterdayDate = new Date(now)
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = localDateKey(yesterdayDate), groups = new Map<string, { id: string; name: string; papers: Paper[] }>()
  const dated = papers.filter(paper => !paper.isDemo).map(paper => ({ paper, date: new Date(paper.importedAt) })).sort((left, right) => (Number.isFinite(right.date.getTime()) ? right.date.getTime() : -Infinity) - (Number.isFinite(left.date.getTime()) ? left.date.getTime() : -Infinity))
  for (const { paper, date } of dated) {
    const valid = Number.isFinite(date.getTime()), key = valid ? localDateKey(date) : 'unknown'
    const name = !valid ? 'Unknown import date' : key === today ? 'Today' : key === yesterday ? 'Yesterday' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    if (!groups.has(key)) groups.set(key, { id: `date-${key}`, name, papers: [] })
    groups.get(key)!.papers.push(paper)
  }
  const demo = papers.filter(paper => paper.isDemo)
  return [...groups.values(), ...(demo.length ? [{ id: 'demo', name: 'Demonstration', papers: demo }] : [])]
}
export function paperInformationInput(titleInput: string, authorsInput: string, yearInput: string): PaperMetadata {
  const title = titleInput.trim(), authors = authorsInput.trim(), yearText = yearInput.trim()
  if (!title || title.length > 300 || /[\u0000-\u001f\u007f-\u009f]/.test(titleInput)) throw new Error('Paper title must contain 1–300 characters on one line.')
  if (authors.length > 1000 || /[\u0000-\u001f\u007f-\u009f]/.test(authorsInput)) throw new Error('Paper authors must contain at most 1,000 characters on one line.')
  if (yearText && (!/^[1-9]\d{3}$/.test(yearText))) throw new Error('Publication year must be four digits, or leave it blank.')
  return { title, authors, year: yearText ? Number(yearText) : null }
}
