import type { CanvasExportOptions, NotebookPage } from '../shared/notebookTypes'
import { canvasExportPlan } from '../shared/canvasViewport'
import { assertNotebookWorldBounds, notebookContentBounds } from '../renderer/src/notebookGeometry'
export async function assertSavedCanvasExport(page:NotebookPage,options:CanvasExportOptions,readAsset:(assetId:string)=>Promise<unknown>):Promise<void> {
  canvasExportPlan(options); assertNotebookWorldBounds(page)
  if(options.scope==='all') {
    const bounds=notebookContentBounds(page)
    if((['x','y','width','height']as const).some(key=>Math.abs(bounds[key]-options.region[key])>.001)) throw Error('Saved Canvas content bounds changed. Retry the export to include all content.')
  }
  const checked=new Set<string>()
  for(const object of page.objects) if(object.type==='image'&&!checked.has(object.assetId)) {await readAsset(object.assetId);checked.add(object.assetId)}
}
