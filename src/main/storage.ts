import { mkdir, readFile, writeFile, rename, copyFile, readdir, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { LibraryMetadata, LibraryOrganization, Paper, PaperMetadata, PaperState, PaperSummary, PdfInk, ReadingMarks } from '../shared/types'
import { validId, validateMarks, validateState, validateSummary } from './validation'
import { validateAssignment, validateCategoryId, validateCategoryName, validateLibraryOrganization, validatePdfInk } from './workflowValidation'
import { normalizePaperMetadata, validateLibraryMetadata } from './metadataValidation'

function validateLibrary(value: unknown): void {
  if (!Array.isArray(value)) throw new Error('Invalid library')
  for (const paper of value) {
    if (!paper || typeof paper !== 'object') throw new Error('Invalid paper')
    validId(paper.id)
    if (typeof paper.title !== 'string' || typeof paper.fileName !== 'string' || typeof paper.category !== 'string' || typeof paper.importedAt !== 'string') throw new Error('Invalid paper')
  }
}

export class PaperStore {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(readonly root: string) {}
  async flush(): Promise<void> { await this.tail }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation); this.tail = next.catch(() => {}); return next
  }
  async atomicJson(path: string, value: unknown, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('Request cancelled')
    const temporary = `${path}.tmp-${randomUUID()}`
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
    try { await copyFile(path, `${path}.backup-${Date.now()}-${randomUUID()}`) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    // Cancellation before the commit preserves the previous file; retain temporary files for recovery.
    if (signal?.aborted) throw new Error('Request cancelled')
    await rename(temporary, path)
  }
  async readJson<T>(path: string, validate: (value: unknown) => void): Promise<T> {
    try { const value: unknown = JSON.parse(await readFile(path, 'utf8')); validate(value); return value as T } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error
      const directory = join(path, '..'); const prefix = basename(path) + '.backup-'
      const backups = (await readdir(directory)).filter(name => name.startsWith(prefix)).sort().reverse()
      for (const backup of backups) {
        try { const value: unknown = JSON.parse(await readFile(join(directory, backup), 'utf8')); validate(value); return value as T } catch { /* Keep damaged files and inspect older backups. */ }
      }
      throw new Error('Local data is damaged. Existing files were preserved for recovery.')
    }
  }
  private paperDirectory(id: string): string { validId(id); return join(this.root, 'papers', id) }
  async list(): Promise<Paper[]> {
    await this.tail
    try { return await this.readJson<Paper[]>(join(this.root, 'library.json'), validateLibrary) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  }
  private async requirePaper(id: string): Promise<Paper> {
    validId(id); const paper = (await this.list()).find(item => item.id === id)
    if (!paper) throw new Error('Paper not found. Import a local PDF first.'); return paper
  }
  private async requireStoredPaper(id: string): Promise<void> {
    let papers: Paper[] = []
    try { papers = await this.readJson<Paper[]>(join(this.root, 'library.json'), validateLibrary) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (!papers.some(paper => paper.id === id)) throw new Error('Paper not found. Import a local PDF first.')
  }
  async importPdf(source: string): Promise<Paper> {
    const metadata = await stat(source)
    if (!metadata.isFile() || metadata.size > 200 * 1024 * 1024) throw new Error('Choose a PDF smaller than 200 MB')
    const bytes = await readFile(source)
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('Selected file is not a PDF')
    const papers = await this.list()
    return this.serial(async () => {
      const paper: Paper = { id: randomUUID(), title: basename(source).replace(/\.pdf$/i, ''), fileName: basename(source), importedAt: new Date().toISOString(), category: 'Imported' }
      const directory = this.paperDirectory(paper.id); await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'document.pdf'), bytes)
      // Read inside the queue to avoid losing another concurrently imported paper.
      let current = papers
      try { current = await this.readJson<Paper[]>(join(this.root, 'library.json'), validateLibrary) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await this.atomicJson(join(this.root, 'library.json'), [...current, paper]); return paper
    })
  }
  async readPdf(id: string): Promise<Uint8Array> {
    await this.requirePaper(id)
    try { return new Uint8Array(await readFile(join(this.paperDirectory(id), 'document.pdf'))) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('The imported PDF copy is missing. Import the original again.'); throw error
    }
  }
  async loadState(id: string): Promise<PaperState> {
    validId(id)
    if (id !== 'demo-workspace') await this.requirePaper(id)
    else await this.tail
    try { return await this.readJson<PaperState>(join(this.paperDirectory(id), 'state.json'), value => validateState(value, id)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { note: '', messages: [], lastPage: 1 }; throw error
    }
  }
  async saveState(id: string, state: PaperState): Promise<void> {
    validId(id); validateState(state, id)
    const snapshot = structuredClone(state)
    await this.serial(async () => {
      if (id !== 'demo-workspace') await this.requireStoredPaper(id)
      await mkdir(this.paperDirectory(id), { recursive: true })
      await this.atomicJson(join(this.paperDirectory(id), 'state.json'), { ...snapshot, messages: snapshot.messages.filter(message => !message.isDemo) })
    })
  }
  async loadMarks(id: string): Promise<ReadingMarks> {
    validId(id)
    if (id !== 'demo-workspace') await this.requirePaper(id)
    else await this.tail
    try { return await this.readJson<ReadingMarks>(join(this.paperDirectory(id), 'marks.json'), validateMarks) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { highlights: [], strokes: [] }; throw error
    }
  }
  async saveMarks(id: string, marks: ReadingMarks): Promise<void> {
    validId(id); validateMarks(marks)
    const snapshot = structuredClone(marks)
    await this.serial(async () => {
      if (id !== 'demo-workspace') await this.requireStoredPaper(id)
      await mkdir(this.paperDirectory(id), { recursive: true })
      await this.atomicJson(join(this.paperDirectory(id), 'marks.json'), snapshot)
    })
  }
  async loadSummary(id: string): Promise<PaperSummary | null> {
    await this.requirePaper(id)
    try { return await this.readJson<PaperSummary>(join(this.paperDirectory(id), 'summary.json'), value => validateSummary(value, id)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error
    }
  }
  async saveSummary(id: string, summary: PaperSummary, signal?: AbortSignal): Promise<void> {
    validId(id); validateSummary(summary, id)
    const snapshot = structuredClone(summary)
    await this.serial(async () => {
      if (signal?.aborted) throw new Error('Request cancelled')
      await this.requireStoredPaper(id)
      await this.atomicJson(join(this.paperDirectory(id), 'summary.json'), snapshot, signal)
    })
  }
  // Internal readers do not await the queue: mutations call them from inside it.
  private async readStoredOrganization(): Promise<LibraryOrganization> {
    let papers: Paper[] = []
    try { papers = await this.readJson<Paper[]>(join(this.root, 'library.json'), validateLibrary) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const paperIds = new Set(papers.map(paper => paper.id))
    try {
      return await this.readJson<LibraryOrganization>(join(this.root, 'library-organization.json'), value => {
        validateLibraryOrganization(value)
        if (Object.keys(value.assignments).some(id => !paperIds.has(id))) throw new Error('Invalid assignment to missing paper')
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { categories: [], assignments: {} }; throw error
    }
  }
  async loadLibraryOrganization(): Promise<LibraryOrganization> {
    await this.tail
    return this.readStoredOrganization()
  }
  private async writeOrganization(organization: LibraryOrganization): Promise<LibraryOrganization> {
    validateLibraryOrganization(organization)
    await mkdir(this.root, { recursive: true })
    await this.atomicJson(join(this.root, 'library-organization.json'), organization)
    return organization
  }
  async createCategory(name: string): Promise<LibraryOrganization> {
    const normalized = validateCategoryName(name)
    return this.serial(async () => {
      const organization = await this.readStoredOrganization()
      if (organization.categories.some(category => category.name.toLowerCase() === normalized.toLowerCase())) throw new Error('A category with this name already exists')
      organization.categories.push({ id: randomUUID(), name: normalized })
      return this.writeOrganization(organization)
    })
  }
  async renameCategory(categoryId: string, name: string): Promise<LibraryOrganization> {
    validateCategoryId(categoryId); const normalized = validateCategoryName(name)
    return this.serial(async () => {
      const organization = await this.readStoredOrganization()
      const category = organization.categories.find(item => item.id === categoryId)
      if (!category) throw new Error('Category not found')
      if (organization.categories.some(item => item.id !== categoryId && item.name.toLowerCase() === normalized.toLowerCase())) throw new Error('A category with this name already exists')
      category.name = normalized
      return this.writeOrganization(organization)
    })
  }
  async assignPaperCategory(paperId: string, categoryId: string | null): Promise<LibraryOrganization> {
    validateAssignment(paperId, categoryId)
    return this.serial(async () => {
      await this.requireStoredPaper(paperId)
      const organization = await this.readStoredOrganization()
      if (categoryId !== null && !organization.categories.some(category => category.id === categoryId)) throw new Error('Category not found')
      if (categoryId === null) delete organization.assignments[paperId]
      else organization.assignments[paperId] = categoryId
      return this.writeOrganization(organization)
    })
  }
  private async readStoredMetadata(requiredPaperId?: string): Promise<LibraryMetadata> {
    let papers: Paper[] = []
    try { papers = await this.readJson<Paper[]>(join(this.root, 'library.json'), validateLibrary) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const paperIds = new Set(papers.filter(paper => !paper.isDemo).map(paper => paper.id))
    if (requiredPaperId && !paperIds.has(requiredPaperId)) throw new Error('Paper not found. Import a local PDF first.')
    try {
      return await this.readJson<LibraryMetadata>(join(this.root, 'library-metadata.json'), value => {
        validateLibraryMetadata(value)
        if (Object.keys(value).some(id => !paperIds.has(id))) throw new Error('Invalid metadata for a missing paper')
      })
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error }
  }
  async loadLibraryMetadata(): Promise<LibraryMetadata> {
    await this.tail
    return this.readStoredMetadata()
  }
  async savePaperMetadata(paperId: string, input: PaperMetadata): Promise<LibraryMetadata> {
    validateCategoryId(paperId)
    const snapshot = normalizePaperMetadata(input)
    return this.serial(async () => {
      // A damaged metadata file must never become a writable empty map.
      const metadata = await this.readStoredMetadata(paperId)
      const updated = { ...metadata, [paperId]: snapshot }
      validateLibraryMetadata(updated)
      await mkdir(this.root, { recursive: true })
      await this.atomicJson(join(this.root, 'library-metadata.json'), updated)
      return updated
    })
  }
  private async readStoredPdfInk(id: string): Promise<PdfInk> {
    try { return await this.readJson<PdfInk>(join(this.paperDirectory(id), 'pdf-ink.json'), validatePdfInk) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { strokes: [] }; throw error
    }
  }
  async loadPdfInk(id: string): Promise<PdfInk> {
    validateCategoryId(id); await this.requirePaper(id)
    return this.readStoredPdfInk(id)
  }
  async savePdfInk(id: string, ink: PdfInk): Promise<void> {
    validateCategoryId(id); validatePdfInk(ink)
    const snapshot = structuredClone(ink)
    await this.serial(async () => {
      await this.requireStoredPaper(id)
      // A failed load must never turn into a writable empty sidecar.
      await this.readStoredPdfInk(id)
      await mkdir(this.paperDirectory(id), { recursive: true })
      await this.atomicJson(join(this.paperDirectory(id), 'pdf-ink.json'), snapshot)
    })
  }
  async savePrivateSettings(value: unknown): Promise<void> {
    await this.serial(async () => { await mkdir(this.root, { recursive: true }); await this.atomicJson(join(this.root, 'settings.json'), value) })
  }
}

