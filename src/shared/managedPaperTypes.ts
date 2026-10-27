import type { Paper } from './types'

export interface ManagedDirectoryStatus { configured: boolean; directory: string | null }
export interface ManagedPaperIdentifiers { doi?: string; arxiv?: string }
export interface ManagedPaperImportOptions {
  identifiers?: ManagedPaperIdentifiers
  allowNewVersion?: boolean
  signal?: AbortSignal
}
export interface ManagedPaperImportResult {
  status: 'imported' | 'duplicate' | 'version-conflict'
  paper: Paper | null
  sha256: string
  relatedPaperIds: string[]
}
export interface ManagedPaperFileStatus {
  paperId: string
  status: 'ready' | 'missing' | 'changed'
  managed: boolean
}
export interface ManagedScanOptions { recursive?: boolean; limit?: number }
export interface ManagedScanCandidate {
  token: string
  fileName: string
  relativePath: string
  byteLength: number
  sha256: string
  status: 'unregistered' | 'registered' | 'invalid'
  paperId?: string
  error?: string
}
export interface ManagedScanResult {
  scanId: string
  scanned: number
  limited: boolean
  recursive: boolean
  candidates: ManagedScanCandidate[]
}
export interface ManagedConsolidationResult {
  results: Array<{ paperId: string; status: 'copied' | 'already-managed' | 'failed'; error?: string }>
}