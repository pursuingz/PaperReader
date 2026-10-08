import type { LibraryMetadata, PaperMetadata } from '../shared/types'
import { object } from './validation'
import { validateCategoryId } from './workflowValidation'

export const metadataLimits = { title: 300, authors: 1000, papers: 100_000, characters: 20_000_000 } as const
function field(value: unknown, name: 'title' | 'authors', maximum: number, required: boolean): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new Error(`Invalid paper ${name}`)
  const text = value.trim()
  if ((required && !text) || text.length > maximum) throw new Error(`Paper ${name} must contain ${required ? '1–' : 'at most '}${maximum} characters`)
  return text
}
/** Validate IPC input and return a fresh normalized snapshot before it enters the write queue. */
export function normalizePaperMetadata(value: unknown): PaperMetadata {
  object(value)
  if (Object.keys(value).some(key => !['title', 'authors', 'year'].includes(key))) throw new Error('Invalid paper metadata fields')
  const title = field(value.title, 'title', metadataLimits.title, true), authors = field(value.authors, 'authors', metadataLimits.authors, false)
  if (value.year !== null && (!Number.isInteger(value.year) || (value.year as number) < 1000 || (value.year as number) > 9999)) throw new Error('Publication year must be a four-digit integer or blank')
  return { title, authors, year: value.year as number | null }
}
export function validateLibraryMetadata(value: unknown): asserts value is LibraryMetadata {
  object(value)
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Invalid metadata map')
  if (Object.keys(value).length > metadataLimits.papers) throw new Error('Library metadata paper limit exceeded')
  let characters = 0
  for (const [id, input] of Object.entries(value)) {
    validateCategoryId(id)
    object(input)
    const normalized = normalizePaperMetadata(input)
    if (input.title !== normalized.title || input.authors !== normalized.authors) throw new Error('Invalid untrimmed paper metadata')
    characters += id.length + normalized.title.length + normalized.authors.length
    if (characters > metadataLimits.characters) throw new Error('Library metadata character limit exceeded')
  }
}
