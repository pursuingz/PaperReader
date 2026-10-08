import { lstat, mkdir, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { PaperStore } from './storage'
import type { CanvasDiagram, MindMapDocument } from '../shared/diagramTypes'
import { diagramFileLimit, emptyDiagram, emptyMindMap, validateCanvasDiagram, validateMindMapDocument } from './diagramValidation'
import { validateCanvasPaperId } from './canvasValidation'
export class DiagramStore {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly papers: PaperStore) {}
  async flush(): Promise<void> { await this.tail }
  private serial<T>(operation: () => Promise<T>): Promise<T> { const task = this.tail.then(operation); this.tail = task.catch(() => undefined); return task }
  private async directory(paperId: string): Promise<string> {
    validateCanvasPaperId(paperId)
    if (!(await this.papers.list()).some(paper => paper.id === paperId && !paper.isDemo)) throw new Error('Paper not found. Import a local PDF first.')
    return join(this.papers.root, 'papers', paperId)
  }
  private async read<T>(directory: string, name: string, validate: (value: unknown) => void, fallback: () => T): Promise<T> {
    const path = join(directory, name)
    try {
      const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > diagramFileLimit) throw new Error('Diagram/map sidecar is invalid or too large')
      const handle = await open(path, 'r')
      try {
        const buffer = Buffer.alloc(diagramFileLimit + 1); let total = 0
        while (total < buffer.length) { const result = await handle.read(buffer, total, buffer.length - total, total); if (!result.bytesRead) break; total += result.bytesRead }
        if (total > diagramFileLimit) throw new Error('Diagram/map sidecar is too large')
        const value: unknown = JSON.parse(buffer.subarray(0, total).toString('utf8')); validate(value); return value as T
      }
      finally { await handle.close() }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const names = await readdir(directory).catch((reason: NodeJS.ErrnoException) => { if (reason.code === 'ENOENT') return []; throw reason })
        if (names.some(file => file.startsWith(`${name}.backup-`) || file.startsWith(`${name}.tmp-`))) throw new Error('Diagram/map primary file is missing. Retained recovery files are protected; a new empty board cannot replace them.')
        return fallback()
      }
      throw new Error(`Diagram/map data is damaged or invalid; original bytes are protected. ${error instanceof Error ? error.message : 'Read failed'}`)
    }
  }
  async loadDiagram(paperId: string): Promise<CanvasDiagram> { await this.tail; return this.read(await this.directory(paperId), 'canvas-diagram.json', value => validateCanvasDiagram(value, paperId), () => emptyDiagram(paperId)) }
  async loadMap(paperId: string): Promise<MindMapDocument> { await this.tail; return this.read(await this.directory(paperId), 'mind-map.json', value => validateMindMapDocument(value, paperId), () => emptyMindMap(paperId)) }
  async saveDiagram(paperId: string, value: unknown): Promise<void> {
    validateCanvasPaperId(paperId); validateCanvasDiagram(value, paperId); const snapshot = structuredClone(value)
    await this.serial(async () => { const directory = await this.directory(paperId); await this.read(directory, 'canvas-diagram.json', data => validateCanvasDiagram(data, paperId), () => emptyDiagram(paperId)); await mkdir(directory, { recursive: true }); await this.papers.atomicJson(join(directory, 'canvas-diagram.json'), snapshot) })
  }
  async saveMap(paperId: string, value: unknown): Promise<void> {
    validateCanvasPaperId(paperId); validateMindMapDocument(value, paperId); const snapshot = structuredClone(value)
    await this.serial(async () => { const directory = await this.directory(paperId); await this.read(directory, 'mind-map.json', data => validateMindMapDocument(data, paperId), () => emptyMindMap(paperId)); await mkdir(directory, { recursive: true }); await this.papers.atomicJson(join(directory, 'mind-map.json'), snapshot) })
  }
}
