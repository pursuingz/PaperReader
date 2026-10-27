import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import type { Paper } from '../shared/types'
import type { ManagedConsolidationResult, ManagedDirectoryStatus, ManagedPaperFileStatus, ManagedPaperIdentifiers, ManagedPaperImportOptions, ManagedPaperImportResult, ManagedScanOptions, ManagedScanResult } from '../shared/managedPaperTypes'
import { validId } from './validation'

const MAX_PDF = 200 * 1024 * 1024
const MAX_ENTRIES = 10000
const MAX_SCAN = 1000
interface FileEntry {
  paperId: string
  paper: Paper
  directory: string
  fileName: string
  sha256: string
  byteLength: number
  identifiers: ManagedPaperIdentifiers
}
interface FileMap { version: 1; files: Record<string, FileEntry> }
interface ManagedHost {
  readPapers(): Promise<Paper[]>
  savePapers(papers: Paper[], signal?: AbortSignal): Promise<void>
  atomicJson(path: string, value: unknown, signal?: AbortSignal): Promise<void>
}
interface ScanToken { directory: string; source: string; sha256: string; byteLength: number; expires: number }

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function exact(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid managed file mapping')
}
function samePath(a: string, b: string): boolean { return process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b) }
function contains(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child))
  return !path || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}
function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
function cancelled(signal?: AbortSignal): void { if (signal?.aborted) throw new Error('Request cancelled') }
function errorText(error: unknown): string { return error instanceof Error ? error.message : 'Managed PDF operation failed' }
function filename(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\\/\u0000-\u001f]/.test(value) || value === '.' || value === '..') throw new Error('Invalid PDF file name')
  return value
}
function identifiers(value: unknown): ManagedPaperIdentifiers {
  if (value === undefined) return {}
  if (!record(value)) throw new Error('Invalid paper identifiers')
  exact(value, ['doi', 'arxiv'])
  const output: ManagedPaperIdentifiers = {}
  if (value.doi !== undefined) {
    if (typeof value.doi !== 'string') throw new Error('Invalid DOI identifier')
    const doi = value.doi.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase()
    if (doi.length > 256 || !/^10\.\d{4,9}\/[^\s<>"\\]+$/i.test(doi)) throw new Error('Invalid DOI identifier')
    output.doi = doi
  }
  if (value.arxiv !== undefined) {
    if (typeof value.arxiv !== 'string') throw new Error('Invalid arXiv identifier')
    const arxiv = value.arxiv.trim().replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, '').replace(/\.pdf$/i, '').replace(/^arxiv:\s*/i, '').toLowerCase()
    if (!/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v[1-9]\d*)?$/.test(arxiv)) throw new Error('Invalid arXiv identifier')
    output.arxiv = arxiv
  }
  return output
}
function identityMatch(a: ManagedPaperIdentifiers, b: ManagedPaperIdentifiers): boolean {
  return !!(a.doi && a.doi === b.doi) || !!(a.arxiv && b.arxiv && a.arxiv.replace(/v\d+$/, '') === b.arxiv.replace(/v\d+$/, ''))
}

export class ManagedPaperFiles {
  private readonly tokens = new Map<string, ScanToken>()
  constructor(private readonly root: string, private readonly host: ManagedHost, private readonly defaultDirectory?: string) {}

  private validateDirectory(value: unknown): string {
    if (typeof value !== 'string' || value.length > 4096 || !isAbsolute(value) || value.includes('\0')) throw new Error('Choose an absolute managed directory outside internal application data')
    const directory = resolve(value)
    if (contains(this.root, directory) || contains(directory, this.root)) throw new Error('Managed directory must not overlap internal application data')
    return directory
  }
  private async readSidecar(path: string, maxBytes: number): Promise<unknown | null> {
    try {
      const metadata = await lstat(path)
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maxBytes) throw new Error('Invalid managed storage sidecar')
      return JSON.parse(await readFile(path, 'utf8')) as unknown
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        let entries: string[] = []
        try { entries = await readdir(join(path, '..')) } catch (directoryError) { if ((directoryError as NodeJS.ErrnoException).code !== 'ENOENT') throw directoryError }
        const name = basename(path)
        if (entries.some(entry => entry.startsWith(`${name}.backup-`) || entry.startsWith(`${name}.tmp-`) || entry.startsWith(`${name}.retained`))) throw new Error('Managed directory configuration or file mapping is missing with retained recovery files. Existing files were preserved.')
        return null
      }
      throw new Error('Managed directory configuration or file mapping is damaged. Existing files were preserved.')
    }
  }
  async getDirectory(): Promise<ManagedDirectoryStatus> {
    const value = await this.readSidecar(join(this.root, 'managed-directory.json'), 16384)
    if (value === null) return this.defaultDirectory ? { configured: true, directory: this.validateDirectory(this.defaultDirectory) } : { configured: false, directory: null }
    if (!record(value) || value.version !== 1 || Object.keys(value).length !== 2) throw new Error('Managed directory configuration is damaged')
    return { configured: true, directory: this.validateDirectory(value.directory) }
  }
  async protectedDirectories(): Promise<string[]> {
    const directory = (await this.getDirectory()).directory, map = await this.readMap()
    return [...new Set([...(directory ? [directory] : []), ...Object.values(map.files).map(entry => entry.directory)])]
  }
  async configure(directory: string): Promise<ManagedDirectoryStatus> {
    const requested = this.validateDirectory(directory)
    await mkdir(requested, { recursive: true })
    const canonical = this.validateDirectory(await realpath(requested))
    const metadata = await lstat(requested)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Managed directory cannot be a symbolic link')
    await mkdir(this.root, { recursive: true })
    await this.host.atomicJson(join(this.root, 'managed-directory.json'), { version: 1, directory: canonical })
    this.tokens.clear()
    return { configured: true, directory: canonical }
  }
  private async directory(): Promise<string> {
    const status = await this.getDirectory()
    if (!status.directory) throw new Error('Choose a managed PDF directory first')
    const stored = await this.readSidecar(join(this.root, 'managed-directory.json'), 16384)
    if (stored === null) return (await this.configure(status.directory)).directory!
    if (!samePath(await realpath(status.directory), status.directory) || !(await lstat(status.directory)).isDirectory()) throw new Error('The original PDF folder changed or is unavailable. Notes and annotations were preserved.')
    return status.directory
  }
  private async readMap(): Promise<FileMap> {
    const value = await this.readSidecar(join(this.root, 'paper-files.json'), 16 * 1024 * 1024)
    if (value === null) return { version: 1, files: {} }
    try {
      if (!record(value) || value.version !== 1 || !record(value.files)) throw new Error('Invalid mapping')
      exact(value, ['version', 'files'])
      if (Object.keys(value.files).length > MAX_ENTRIES) throw new Error('Too many mapped papers')
      for (const [id, entry] of Object.entries(value.files)) {
        validId(id)
        if (!record(entry)) throw new Error('Invalid file entry')
        exact(entry, ['paperId', 'paper', 'directory', 'fileName', 'sha256', 'byteLength', 'identifiers'])
        if (entry.paperId !== id || !record(entry.paper) || entry.paper.id !== id || typeof entry.paper.title !== 'string' || typeof entry.paper.fileName !== 'string' || typeof entry.paper.category !== 'string' || typeof entry.paper.importedAt !== 'string' || !Number.isFinite(Date.parse(entry.paper.importedAt))) throw new Error('Invalid mapped paper identity')
        this.validateDirectory(entry.directory)
        const name = filename(entry.fileName)
        if (/[<>:\"|?*]/.test(name) || /[. ]$/.test(name) || !name.toLowerCase().endsWith('.pdf') || !name.includes(`--${id}`) || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.byteLength) || Number(entry.byteLength) < 1 || Number(entry.byteLength) > MAX_PDF) throw new Error('Invalid mapped file')
        const normalized = identifiers(entry.identifiers)
        if (JSON.stringify(normalized) !== JSON.stringify(entry.identifiers)) throw new Error('Unnormalized identifiers')
      }
      return value as unknown as FileMap
    } catch { throw new Error('Managed file mapping is damaged. Existing files were preserved.') }
  }
  private async saveMap(map: FileMap, signal?: AbortSignal): Promise<void> {
    if (Object.keys(map.files).length > MAX_ENTRIES || Buffer.byteLength(JSON.stringify(map), 'utf8') > 16 * 1024 * 1024) throw new Error('Managed paper mapping size limit reached')
    await mkdir(this.root, { recursive: true })
    await this.host.atomicJson(join(this.root, 'paper-files.json'), map, signal)
  }
  private async fileBytes(path: string, expectedDirectory?: string): Promise<Uint8Array> {
    const before = await lstat(path)
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > MAX_PDF) throw new Error('Choose a regular PDF smaller than 200 MB')
    if (expectedDirectory && (!samePath(await realpath(expectedDirectory), expectedDirectory) || !samePath(await realpath(path), path))) throw new Error('Managed PDF location changed or is a symbolic link')
    const handle = await open(path, constants.O_RDONLY)
    try {
      const metadata = await handle.stat()
      if (metadata.size !== before.size || metadata.ino !== before.ino || metadata.dev !== before.dev || metadata.mtimeMs !== before.mtimeMs) throw new Error('PDF changed while reading')
      const bounded = Buffer.allocUnsafe(before.size + 1)
      let length = 0
      while (length < bounded.length) {
        const read = await handle.read(bounded, length, bounded.length - length, null)
        if (!read.bytesRead) break
        length += read.bytesRead
      }
      const bytes = new Uint8Array(bounded.subarray(0, length))
      const after = await lstat(path)
      if (!after.isFile() || after.isSymbolicLink() || after.ino !== before.ino || after.dev !== before.dev || after.size !== before.size || after.mtimeMs !== before.mtimeMs || bytes.length !== before.size) throw new Error('PDF changed while reading')
      return bytes
    } finally { await handle.close() }
  }
  private async validatePdf(bytes: Uint8Array): Promise<void> {
    if (!bytes.length || bytes.length > MAX_PDF || !Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from('%PDF-'))) throw new Error('Choose a valid PDF smaller than 200 MB')
    try {
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true })
      if (pdf.getPageCount() < 1) throw new Error('Empty PDF')
    } catch { throw new Error('The file could not be parsed as a valid PDF. Encrypted or damaged documents are unsupported.') }
  }
  private async verify(entry: FileEntry): Promise<{ path: string; bytes: Uint8Array }> {
    const path = join(entry.directory, entry.fileName)
    try {
      const bytes = await this.fileBytes(path, entry.directory)
      if (bytes.length !== entry.byteLength || hash(bytes) !== entry.sha256) throw new Error('Managed PDF content changed. The original PDF is unavailable; notes and annotations were preserved.')
      return { path, bytes }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Managed PDF is missing. The original PDF is unavailable; notes and annotations were preserved.')
      if (/changed|symbolic link/i.test(errorText(error))) throw error
      throw new Error('Managed PDF content changed or cannot be read. Notes and annotations were preserved.')
    }
  }
  async read(id: string): Promise<{ path: string; bytes: Uint8Array; managed: boolean }> {
    validId(id)
    const entry = (await this.readMap()).files[id]
    if (entry) return { ...await this.verify(entry), managed: true }
    const path = join(this.root, 'papers', id, 'document.pdf')
    try { return { path, bytes: new Uint8Array(await readFile(path)), managed: false } } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('The imported PDF copy is missing. Import the original again.'); throw error
    }
  }
  async fileStatus(id: string): Promise<ManagedPaperFileStatus> {
    const map = await this.readMap()
    try { const file = await this.read(id); return { paperId: id, status: 'ready', managed: file.managed } } catch (error) {
      const message = errorText(error)
      if (/missing/i.test(message)) return { paperId: id, status: 'missing', managed: !!map.files[id] }
      if (/changed|symbolic link/i.test(message)) return { paperId: id, status: 'changed', managed: !!map.files[id] }
      throw error
    }
  }
  private async place(directory: string, paper: Paper, bytes: Uint8Array, alternate = false): Promise<string> {
    let stem = paper.fileName.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 100) || 'paper'
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`
    for (let attempt = 0; attempt < 8; attempt++) {
      const name = `${stem}--${paper.id}${alternate || attempt ? `--${randomUUID()}` : ''}.pdf`
      const path = join(directory, name)
      if (!samePath(await realpath(directory), directory)) throw new Error('Managed directory changed')
      try {
        await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
        const placed = await this.fileBytes(path, directory)
        if (hash(placed) !== hash(bytes)) throw new Error('Managed PDF copy hash verification failed')
        return name
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    throw new Error('Could not create an exclusive managed PDF name')
  }
  async importFile(source: string, options: ManagedPaperImportOptions = {}): Promise<ManagedPaperImportResult> {
    return this.importBytes(await this.fileBytes(source), basename(source), options)
  }
  async importBytes(input: Uint8Array, originalName: string, options: ManagedPaperImportOptions = {}): Promise<ManagedPaperImportResult> {
    filename(originalName)
    if (!(input instanceof Uint8Array) || input.length < 1 || input.length > MAX_PDF) throw new Error('Choose valid PDF bytes smaller than 200 MB')
    const bytes = new Uint8Array(input), ids = identifiers(options.identifiers), sha256 = hash(bytes)
    if (options.allowNewVersion !== undefined && typeof options.allowNewVersion !== 'boolean') throw new Error('Invalid PDF version choice')
    cancelled(options.signal)
    await this.validatePdf(bytes)
    const map = await this.readMap(), papers = await this.host.readPapers()
    const duplicate = Object.values(map.files).find(entry => entry.sha256 === sha256)
    if (duplicate) {
      await this.verify(duplicate)
      cancelled(options.signal)
      const enriched = identifiers({ doi: duplicate.identifiers.doi ?? ids.doi, arxiv: duplicate.identifiers.arxiv ?? ids.arxiv })
      if (JSON.stringify(enriched) !== JSON.stringify(duplicate.identifiers)) {
        duplicate.identifiers = enriched
        await this.saveMap(map, options.signal)
      }
      if (!papers.some(paper => paper.id === duplicate.paperId)) {
        await this.host.savePapers([...papers, duplicate.paper], options.signal)
        return { status: 'imported', paper: duplicate.paper, sha256, relatedPaperIds: [] }
      }
      return { status: 'duplicate', paper: papers.find(paper => paper.id === duplicate.paperId)!, sha256, relatedPaperIds: [] }
    }
    for (const paper of papers) {
      if (map.files[paper.id]) continue
      const source = join(this.root, 'papers', paper.id, 'document.pdf')
      let legacyBytes: Uint8Array
      try {
        if ((await lstat(source)).size !== bytes.length) continue
        legacyBytes = await this.fileBytes(source)
      } catch { continue }
      cancelled(options.signal)
      if (hash(legacyBytes) !== sha256) continue
      const directory = await this.directory(), fileName = await this.place(directory, paper, bytes)
      map.files[paper.id] = { paperId: paper.id, paper, directory, fileName, sha256, byteLength: bytes.length, identifiers: ids }
      await this.saveMap(map, options.signal)
      return { status: 'duplicate', paper, sha256, relatedPaperIds: [] }
    }
    const relatedPaperIds = Object.values(map.files).filter(entry => identityMatch(entry.identifiers, ids)).map(entry => entry.paperId)
    if (relatedPaperIds.length && !options.allowNewVersion) return { status: 'version-conflict', paper: null, sha256, relatedPaperIds }
    const directory = await this.directory()
    cancelled(options.signal)
    const paper: Paper = { id: randomUUID(), title: originalName.replace(/\.pdf$/i, ''), fileName: originalName, importedAt: new Date().toISOString(), category: 'Imported' }
    const fileName = await this.place(directory, paper, bytes)
    map.files[paper.id] = { paperId: paper.id, paper, directory, fileName, sha256, byteLength: bytes.length, identifiers: ids }
    await this.saveMap(map, options.signal)
    await mkdir(join(this.root, 'papers', paper.id), { recursive: true })
    await this.host.savePapers([...papers, paper], options.signal)
    return { status: 'imported', paper, sha256, relatedPaperIds }
  }
  async consolidate(ids?: string[]): Promise<ManagedConsolidationResult> {
    const papers = await this.host.readPapers(), chosen = ids ?? papers.map(paper => paper.id)
    if (!Array.isArray(chosen) || chosen.length > MAX_ENTRIES || new Set(chosen).size !== chosen.length) throw new Error('Invalid consolidation selection')
    for (const id of chosen) { validId(id); if (!papers.some(paper => paper.id === id)) throw new Error('Paper not found') }
    const directory = await this.directory(), map = await this.readMap(), results: ManagedConsolidationResult['results'] = []
    for (const paperId of chosen) {
      try {
        const mapped = map.files[paperId]
        if (mapped && samePath(mapped.directory, directory)) { await this.verify(mapped); results.push({ paperId, status: 'already-managed' }); continue }
        const paper = papers.find(item => item.id === paperId)!
        const bytes = mapped ? (await this.verify(mapped)).bytes : await this.fileBytes(join(this.root, 'papers', paperId, 'document.pdf'))
        await this.validatePdf(bytes)
        const sha256 = hash(bytes), fileName = await this.place(directory, paper, bytes)
        const entry: FileEntry = { paperId, paper, directory, fileName, sha256, byteLength: bytes.length, identifiers: { ...mapped?.identifiers } }
        const next: FileMap = { version: 1, files: { ...map.files, [paperId]: entry } }
        await this.saveMap(next)
        map.files[paperId] = entry
        results.push({ paperId, status: 'copied' })
      } catch (error) { results.push({ paperId, status: 'failed', error: errorText(error) }) }
    }
    return { results }
  }
  async relink(id: string, source: string): Promise<ManagedPaperFileStatus> {
    validId(id)
    const map = await this.readMap(), entry = map.files[id]
    if (!entry) throw new Error('Only a mapped PDF with a known content hash can be relinked. Preserve and consolidate the original first.')
    const bytes = await this.fileBytes(source)
    if (bytes.length !== entry.byteLength || hash(bytes) !== entry.sha256) throw new Error('The located PDF does not match the original content hash')
    const directory = await this.directory(), fileName = await this.place(directory, entry.paper, bytes, true)
    await this.saveMap({ version: 1, files: { ...map.files, [id]: { ...entry, directory, fileName } } })
    return { paperId: id, status: 'ready', managed: true }
  }
  async scan(options: ManagedScanOptions = {}): Promise<ManagedScanResult> {
    if (options.recursive !== undefined && typeof options.recursive !== 'boolean') throw new Error('Invalid recursive scan option')
    const limit = options.limit ?? 500
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SCAN) throw new Error(`Scan limit must be between 1 and ${MAX_SCAN}`)
    const directory = await this.directory(), map = await this.readMap(), papers = await this.host.readPapers()
    const registered = new Set(papers.map(paper => paper.id))
    const result: ManagedScanResult = { scanId: randomUUID(), scanned: 0, limited: false, recursive: options.recursive ?? false, candidates: [] }
    for (const [token, owned] of this.tokens) if (owned.expires < Date.now()) this.tokens.delete(token)
    let visited = 0
    const walk = async (folder: string, depth: number): Promise<void> => {
      const entries = await readdir(folder, { withFileTypes: true })
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (++visited > 10000) { result.limited = true; return }
        if (entry.isSymbolicLink()) continue
        const source = join(folder, entry.name)
        if (entry.isDirectory() && result.recursive) {
          if (depth >= 16) { result.limited = true; continue }
          await walk(source, depth + 1)
          if (result.limited && result.scanned >= limit) return
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) continue
        if (result.scanned >= limit) { result.limited = true; return }
        result.scanned++
        const token = randomUUID(), candidate: ManagedScanResult['candidates'][number] = { token, fileName: entry.name, relativePath: relative(directory, source), byteLength: 0, sha256: '', status: 'invalid' }
        try {
          const bytes = await this.fileBytes(source, directory)
          await this.validatePdf(bytes)
          candidate.byteLength = bytes.length; candidate.sha256 = hash(bytes)
          const matched = Object.values(map.files).find(file => file.sha256 === candidate.sha256 && registered.has(file.paperId))
          if (matched) { await this.verify(matched); candidate.status = 'registered'; candidate.paperId = matched.paperId }
          else candidate.status = 'unregistered'
          while (this.tokens.size >= 5000) this.tokens.delete(this.tokens.keys().next().value!)
          this.tokens.set(token, { directory, source, sha256: candidate.sha256, byteLength: bytes.length, expires: Date.now() + 30 * 60 * 1000 })
        } catch (error) { candidate.error = errorText(error) }
        result.candidates.push(candidate)
      }
    }
    await walk(directory, 0)
    return result
  }
  async importToken(token: string): Promise<ManagedPaperImportResult> {
    if (typeof token !== 'string') throw new Error('Invalid scan token')
    const owned = this.tokens.get(token)
    if (!owned || owned.expires < Date.now() || !samePath(await this.directory(), owned.directory)) throw new Error('Scan token expired or is not owned by this session. Scan again.')
    const bytes = await this.fileBytes(owned.source, owned.directory)
    if (bytes.length !== owned.byteLength || hash(bytes) !== owned.sha256) throw new Error('Scanned PDF changed. Scan again before importing.')
    return this.importBytes(bytes, basename(owned.source))
  }
}