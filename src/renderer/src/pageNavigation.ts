import type { PaperState } from '../../shared/types'
import type { ReadingLocation } from './readingHistory'

/** A saved Summary can load later than the PDF/state; keep its scroll target until then. */
export function historyContentReady(location: Pick<ReadingLocation, 'paperId' | 'view'>, status: { paperId: string | null; summaryReady: boolean }): boolean {
  return location.view !== 'summary' || (location.paperId === status.paperId && status.summaryReady)
}

/** Save before committing the visible page; include a completed AI answer arriving during I/O. */
export async function saveNavigationPage(page: number, read: () => PaperState, save: (state: PaperState) => Promise<void>, current: () => boolean): Promise<PaperState | null> {
  for (let pass = 0; pass < 4; pass++) {
    if (!current()) return null
    const before = { ...read() }, target = { ...before, lastPage: page }
    await save(target)
    if (!current()) return null
    const latest = read()
    if (latest.note === before.note && latest.messages === before.messages && latest.lastPage === before.lastPage) return { ...latest, lastPage: page }
  }
  throw new Error('Reading state kept changing. Keep this page open and try navigation again.')
}
interface HistoryPdfTask { promise: Promise<{ numPages: number }>; destroy(): Promise<void> }
/** Own a short-lived, independent PDF task; the mounted Reader never shares this proxy. */
export async function checkHistoryPdf(bytes: Uint8Array, page: number, load: (bytes: Uint8Array) => HistoryPdfTask): Promise<void> {
  const task = load(new Uint8Array(bytes))
  try {
    const document = await task.promise
    if (!Number.isSafeInteger(document.numPages) || document.numPages < 1 || !Number.isSafeInteger(page) || page < 1 || page > document.numPages) throw new Error('The history page is unavailable in this PDF.')
  } finally { await task.destroy() }
}
