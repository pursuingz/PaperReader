import type { PaperSourceEntry } from '../../shared/types'
import type { SourceEvidenceEdits, SourceEvidenceEdit, SourceEvidenceEditsAPI } from '../../shared/sourceEvidenceEditsTypes'
import { resolveEvidenceSource, sameEvidenceSource } from '../../shared/sourceEvidenceEditsIdentity'

export function evidenceEditFor(value: SourceEvidenceEdits | null, entry: PaperSourceEntry, sources: PaperSourceEntry[]): SourceEvidenceEdit | null {
  if (!sources.some(source => sameEvidenceSource(source, entry))) return null
  const matches = value?.edits.filter(edit => { const actual = resolveEvidenceSource(edit.source, sources); return actual !== null && resolveEvidenceSource(entry, [actual]) !== null }) ?? []
  return matches.length === 1 ? matches[0] : null
}
export function evidenceCaption(value: SourceEvidenceEdits | null, entry: PaperSourceEntry, sources: PaperSourceEntry[]): string { return evidenceEditFor(value, entry, sources)?.caption ?? entry.text }
export function evidenceHidden(value: SourceEvidenceEdits | null, entry: PaperSourceEntry, sources: PaperSourceEntry[]): boolean { return evidenceEditFor(value, entry, sources)?.hidden ?? false }
export function captionPageNumber(value: string, count: number): number | null { const page = Number(value); return value.trim() && Number.isSafeInteger(page) && page >= 1 && page <= count ? page : null }
export function captionCopySelection(value: string, anchorInside: boolean, focusInside: boolean): string | null { return anchorInside && focusInside && value.trim() && value.length <= 16000 ? value : null }
export class SourceEvidenceEditsSession {
  private paperId = ''
  private epoch = 0
  ready = false
  busy = false
  constructor(private api: SourceEvidenceEditsAPI) {}
  async open(paperId: string): Promise<SourceEvidenceEdits | null> {
    const epoch = ++this.epoch; this.paperId = paperId; this.ready = false; this.busy = false
    try { const value = await this.api.loadSourceEvidenceEdits(paperId); if (epoch !== this.epoch) return null; if (value.paperId !== paperId) throw Error('Source evidence edit ownership does not match this paper.'); this.ready = true; return value }
    catch (error) { if (epoch === this.epoch) throw error; return null }
  }
  close() { ++this.epoch; this.paperId = ''; this.ready = false; this.busy = false }
  private async mutate(operation: (paperId: string) => Promise<SourceEvidenceEdits>): Promise<SourceEvidenceEdits | null> {
    if (!this.ready || !this.paperId) throw Error('Load saved source evidence edits successfully before editing.')
    if (this.busy) throw Error('A source evidence change is already in progress.')
    const epoch = this.epoch, paperId = this.paperId; this.busy = true
    try { const value = await operation(paperId); if (epoch !== this.epoch) return null; if (value.paperId !== paperId) throw Error('Source evidence edit ownership does not match this paper.'); return value }
    catch (error) { if (epoch === this.epoch) throw error; return null }
    finally { if (epoch === this.epoch) this.busy = false }
  }
  saveCaption(entry: PaperSourceEntry, caption: string) { const snapshot = structuredClone(entry); return this.mutate(id => this.api.saveSourceEvidenceCaption(id, { entry: snapshot, caption })) }
  setHidden(entry: PaperSourceEntry, hidden: boolean) { const snapshot = structuredClone(entry); return this.mutate(id => this.api.setSourceEvidenceHidden(id, { entry: snapshot, hidden })) }
}
