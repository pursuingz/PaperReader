import type { AIImageReference, CanvasNotebook, ChatNotesSelection, ChatNotesSnapshot, MindMapDocument, NotebookPage, ReadingMarks } from '../../shared/types'
import { AI_IMAGE_LIMIT, AI_IMAGES_TOTAL_BYTES_LIMIT } from '../../shared/aiSourceTypes'
import { notebookItemBounds } from './notebookGeometry'
import type { CanvasRegion } from '../../shared/notebookTypes'

export interface ChatNotesInput { paperId:string;note:string;marks:ReadingMarks;mindMap:MindMapDocument;notebook:CanvasNotebook;selection:ChatNotesSelection;attachments?:AIImageReference[] }
const TILE=1600, WORLD=10000000
export function resolveChatNotesPages(book:CanvasNotebook,selection:ChatNotesSelection):NotebookPage[]{
 if(!selection.canvas)return []
 if(selection.canvasScope==='all')return book.pages
 if(selection.canvasScope==='current'){
  const page=book.pages.find(p=>p.id===book.activePageId);if(!page)throw Error('The current Canvas page is unavailable. Reload Canvas before sending.');return [page]
 }
 if(selection.canvasScope!=='selected'||!selection.canvasPageIds.length)throw Error('Select at least one Canvas page before sending.')
 const ids=new Set(selection.canvasPageIds)
 if(ids.size!==selection.canvasPageIds.length||[...ids].some(id=>!book.pages.some(p=>p.id===id)))throw Error('A selected Canvas page is no longer available. Choose the pages again.')
 return book.pages.filter(p=>ids.has(p.id))
}
export function chatNotesVisualTiles(page:NotebookPage,maxImages=AI_IMAGE_LIMIT):CanvasRegion[]{
 const items=[...page.objects.filter(o=>o.type==='image'||o.type==='stroke'),...page.diagram.shapes,...page.diagram.arrows,...page.diagram.connections]
 const tiles=new Map<string,CanvasRegion>()
 for(const item of items){
  const b=notebookItemBounds(page,item);if(!b)throw Error('Canvas contains a connection with missing endpoints. Repair it or choose other note sources.')
  const sx=Math.floor(Math.max(-WORLD,b.x-12)/TILE),ex=Math.floor(Math.min(WORLD-1,b.x+b.width+12)/TILE),sy=Math.floor(Math.max(-WORLD,b.y-12)/TILE),ey=Math.floor(Math.min(WORLD-1,b.y+b.height+12)/TILE)
  if(!Number.isFinite(sx+ex+sy+ey)||(ex-sx+1)*(ey-sy+1)>maxImages)throw Error('Canvas visual scope is too large. Select fewer pages or remove image attachments before sending.')
  for(let y=sy;y<=ey;y++)for(let x=sx;x<=ex;x++){
   const key=x+':'+y,left=Math.max(-WORLD,x*TILE),top=Math.max(-WORLD,y*TILE)
   tiles.set(key,{x:left,y:top,width:Math.min(WORLD,(x+1)*TILE)-left,height:Math.min(WORLD,(y+1)*TILE)-top})
   if(tiles.size>maxImages)throw Error('Canvas needs too many images. Select fewer pages or note sources before sending.')
  }
 }
 return [...tiles.values()].sort((a,b)=>a.y-b.y||a.x-b.x)
}
function serializePage(page:NotebookPage):string {
 const objects=page.objects.map(object=>{
  if(object.type==='text')return {id:object.id,type:object.type,x:object.x,y:object.y,width:object.width,height:object.height,text:object.text,richText:object.richText}
  if(object.type==='quote')return {id:object.id,type:object.type,x:object.x,y:object.y,width:object.width,height:object.height,quote:object.quote,comment:object.comment,source:object.source}
  if(object.type==='mindmap')return {id:object.id,type:'copied-mind-map',x:object.x,y:object.y,width:object.width,height:object.height,nodes:object.nodes,source:object.source}
  if(object.type==='image')return {id:object.id,type:object.type,x:object.x,y:object.y,width:object.width,height:object.height,visual:'Included in the matching Canvas image regions'}
  return {id:object.id,type:'handwriting',visual:'Included in the matching Canvas image regions'}
 })
 if(!objects.length&&!page.diagram.shapes.length&&!page.diagram.arrows.length&&!page.diagram.connections.length)return ''
 return JSON.stringify({objects,shapes:page.diagram.shapes,arrows:page.diagram.arrows,connections:page.diagram.connections})
}
export function hasChatNotesContent(value:ChatNotesSnapshot):boolean{return Boolean(value.text?.trim()||value.highlights?.length||value.mindMap?.nodes.length||value.canvas?.some(p=>p.content.trim())||value.images.length)}
export async function buildChatNotesSnapshot(input:ChatNotesInput,capture:(page:NotebookPage,region:CanvasRegion)=>Promise<AIImageReference>,isCurrent:()=>boolean):Promise<ChatNotesSnapshot>{
 const frozen=structuredClone(input),s=frozen.selection
 const check=()=>{if(!isCurrent())throw Error('The paper changed or the request was cancelled while preparing notes. Nothing was sent.')}
 check();if(frozen.notebook.paperId!==frozen.paperId||frozen.mindMap.paperId!==frozen.paperId)throw Error('Note sources belong to a different paper. Reload the notes before sending.')
 const pages=resolveChatNotesPages(frozen.notebook,s)
 const snapshot:ChatNotesSnapshot={version:1,selection:{...s,canvasPageIds:pages.map(p=>p.id)},images:[],coverage:{canvasPageIds:pages.map(p=>p.id),imageCount:0}}
 if(s.text)snapshot.text=frozen.note
 if(s.highlights)snapshot.highlights=frozen.marks.highlights.map(({id,page,quote,comment})=>({id,page,quote,comment}))
 if(s.mindMap)snapshot.mindMap={nodes:frozen.mindMap.nodes.map(n=>({...n}))}
 if(s.canvas)snapshot.canvas=pages.map(p=>({pageId:p.id,name:p.name,content:serializePage(p)}))
 if(JSON.stringify({...snapshot,images:[]}).length>100000)throw Error('Selected notes exceed the 100,000 character AI limit. Select fewer sources or Canvas pages; nothing was sent.')
 const attachments=[...new Map((frozen.attachments||[]).map(i=>[i.imageId,i])).values()]
 const allowance=AI_IMAGE_LIMIT-attachments.length,plans=pages.map(page=>({page,regions:chatNotesVisualTiles(page,Math.max(0,allowance))}))
 if(plans.reduce((n,p)=>n+p.regions.length,0)>allowance)throw Error('Selected notes and attachments exceed 8 images. Select fewer Canvas pages or sources before sending.')
 let bytes=attachments.reduce((n,i)=>n+i.byteLength,0)
 if(bytes>AI_IMAGES_TOTAL_BYTES_LIMIT)throw Error('Image attachments exceed the 16 MiB request budget.')
 for(const plan of plans)for(const region of plan.regions){check();const image=await capture(plan.page,region);check();bytes+=image.byteLength;if(bytes>AI_IMAGES_TOTAL_BYTES_LIMIT)throw Error('Selected Canvas images exceed the 16 MiB request budget. Choose fewer sources; nothing was sent.');snapshot.images.push(image)}
 snapshot.coverage.imageCount=snapshot.images.length;check();return snapshot
}
