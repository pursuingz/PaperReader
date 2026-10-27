import type { PaperSourceEntry } from './types'
import { canonicalEvidenceKey, compatibleCaption } from './evidenceIdentity'

export function sameEvidenceSource(first: PaperSourceEntry, second: PaperSourceEntry): boolean {
  return first.id === second.id && first.kind === second.kind && first.label === second.label && first.text === second.text && first.pages.length === second.pages.length && first.pages.every((page, index) => page === second.pages[index])
}

function compatibleSource(first: PaperSourceEntry, second: PaperSourceEntry): boolean {
  const firstKey = canonicalEvidenceKey(first.label, first.kind), secondKey = canonicalEvidenceKey(second.label, second.kind)
  return (first.kind === 'figure' || first.kind === 'table') && first.kind === second.kind && first.pages.length === second.pages.length && first.pages.every((page, index) => page === second.pages[index]) && (firstKey !== null && firstKey === secondKey || first.label === second.label) && compatibleCaption(first.text, second.text)
}

/** Prefer the original ID, and refuse recycled IDs or ambiguous refresh aliases. */
export function resolveEvidenceSource(source: PaperSourceEntry, entries: PaperSourceEntry[]): PaperSourceEntry | null {
  const exact = entries.find(entry => entry.id === source.id)
  if (exact) return compatibleSource(source, exact) ? exact : null
  const candidates = entries.filter(entry => compatibleSource(source, entry))
  return candidates.length === 1 ? candidates[0] : null
}
