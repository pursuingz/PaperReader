import type { CanvasExportOptions } from '../../shared/notebookTypes'
interface NoteWorkspaceSave { finish(): void; flush(): Promise<void> }
interface CurrentOperation { isCurrent(): boolean }
export async function finishAndFlushNoteWorkspaces(workspaces: readonly NoteWorkspaceSave[]): Promise<void> {
  for (const workspace of workspaces) workspace.finish()
  const results = await Promise.allSettled(workspaces.map(workspace => Promise.resolve().then(() => workspace.flush())))
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
}
export async function switchNoteWorkspace({ flush, isCurrent, select }: CurrentOperation & { flush(): Promise<void>; select(): void }): Promise<boolean> {
  await flush()
  if (!isCurrent()) return false
  select(); return true
}
export async function copySavedSourceToNotebook({ flushSource, copy, isCurrent, showCanvas }: CurrentOperation & { flushSource(): Promise<void>; copy(): Promise<void>; showCanvas(): void | Promise<void> }): Promise<boolean> {
  await flushSource()
  if (!isCurrent()) return false
  await copy()
  if (!isCurrent()) return false
  await showCanvas(); return true
}
function requireCurrent(isCurrent: () => boolean) { if (!isCurrent()) throw new Error('Canvas export canceled because the paper or notebook page changed') }
export async function exportNotebookPage<Result>({ paperId, pageId, flush, raster, save, isCurrent }: CurrentOperation & { paperId: string; pageId: string; flush(): Promise<void>; raster(): Promise<Uint8Array>; save(paperId: string, pageId: string, bytes: Uint8Array): Promise<Result> }): Promise<Result> {
  await flush(); requireCurrent(isCurrent)
  const png = await raster(); requireCurrent(isCurrent)
  return save(paperId, pageId, png)
}
export async function exportStandaloneMap<Result>({ paperId, flush, selectMap, raster, save, isCurrent }: CurrentOperation & { paperId: string; flush(): Promise<void>; selectMap(): Promise<void>; raster(): Promise<Uint8Array>; save(paperId: string, bytes: Uint8Array): Promise<Result> }): Promise<Result> {
  await flush(); requireCurrent(isCurrent)
  await selectMap(); requireCurrent(isCurrent)
  const png = await raster(); requireCurrent(isCurrent)
  return save(paperId, png)
}

export async function exportNotebookRegion<Result>({ paperId, pageId, options, resolveOptions, flush, raster, save, isCurrent }: CurrentOperation & { paperId: string; pageId: string; resolveOptions?(captured:CanvasExportOptions):CanvasExportOptions; options: CanvasExportOptions; flush(): Promise<void>; raster(options:CanvasExportOptions):Promise<Uint8Array[]>; save(paperId:string,pageId:string,options:CanvasExportOptions,images:Uint8Array[]):Promise<Result> }):Promise<Result> {
  let captured=structuredClone(options)
  await flush(); requireCurrent(isCurrent)
  if(resolveOptions)captured=structuredClone(resolveOptions(captured))
  const images=await raster(captured); requireCurrent(isCurrent)
  return save(paperId,pageId,captured,images)
}
