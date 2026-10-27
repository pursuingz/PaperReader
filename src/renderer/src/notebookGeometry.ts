import type { DiagramArrow, DiagramConnection, DiagramEndpoint, DiagramShape } from '../../shared/diagramTypes'
import type { CanvasRegion, CanvasViewport, NotebookObject, NotebookPage } from '../../shared/notebookTypes'
import { arrowHead } from './diagramModel'
export interface NotebookGeometry { x: number; y: number; width: number; height: number; kind?: string }
export interface NotebookPoint { x: number; y: number }
export type NotebookItem = NotebookObject | DiagramShape | DiagramArrow | DiagramConnection
export const notebookWorldLimit = 10000000
const clamp = (value:number,min:number,max:number) => Math.max(min,Math.min(max,value))
function target(page: NotebookPage, endpoint: DiagramEndpoint): NotebookGeometry | undefined {
  if (endpoint.domain === 'shape') return page.diagram.shapes.find(shape => shape.id === endpoint.objectId)
  const object = page.objects.find(object => object.id === endpoint.objectId)
  return object && object.type !== 'stroke' ? object : undefined
}
function anchor(rect: NotebookGeometry, name: DiagramEndpoint['anchor'], toward: NotebookPoint): NotebookPoint {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  if (name === 'top') return { x: center.x, y: rect.y }
  if (name === 'right') return { x: rect.x + rect.width, y: center.y }
  if (name === 'bottom') return { x: center.x, y: rect.y + rect.height }
  if (name === 'left') return { x: rect.x, y: center.y }
  const dx = toward.x - center.x, dy = toward.y - center.y
  if (!dx && !dy) return { x: rect.x + rect.width, y: center.y }
  const ratio = rect.kind === 'circle' ? 1 / Math.sqrt((dx / (rect.width / 2)) ** 2 + (dy / (rect.height / 2)) ** 2) : 1 / Math.max(Math.abs(dx) / (rect.width / 2), Math.abs(dy) / (rect.height / 2))
  return { x: center.x + dx * ratio, y: center.y + dy * ratio }
}
export function notebookConnection(page: NotebookPage, connection: DiagramConnection): { start: NotebookPoint; end: NotebookPoint } | null {
  const from = target(page, connection.from), to = target(page, connection.to)
  return from && to ? { start: anchor(from, connection.from.anchor, { x: to.x + to.width/2, y: to.y + to.height/2 }), end: anchor(to, connection.to.anchor, { x: from.x + from.width/2, y: from.y + from.height/2 }) } : null
}
function pointsBounds(points:NotebookPoint[],radius=0):CanvasRegion|null {
  if(!points.length)return null
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity
  for(const p of points){left=Math.min(left,p.x-radius);top=Math.min(top,p.y-radius);right=Math.max(right,p.x+radius);bottom=Math.max(bottom,p.y+radius)}
  return {x:left,y:top,width:right-left,height:bottom-top}
}
export function notebookItemBounds(page:NotebookPage,item:NotebookItem):CanvasRegion|null {
  if('type' in item && item.type==='stroke')return pointsBounds(item.points,item.strokeWidth/2)
  if('x' in item){const radius='lineWidth' in item?item.lineWidth/2:0;return {x:item.x-radius,y:item.y-radius,width:item.width+radius*2,height:item.height+radius*2}}
  const line='start' in item?item:notebookConnection(page,item)
  return line?pointsBounds([line.start,line.end,...arrowHead(line.start,line.end,item.lineWidth)],item.lineWidth/2):null
}
function paddedBounds(bounds:CanvasRegion,padding:number):CanvasRegion {
  const x=Math.min(bounds.x,Math.max(-notebookWorldLimit,bounds.x-padding)),y=Math.min(bounds.y,Math.max(-notebookWorldLimit,bounds.y-padding)),right=Math.max(bounds.x+bounds.width,Math.min(notebookWorldLimit,bounds.x+bounds.width+padding)),bottom=Math.max(bounds.y+bounds.height,Math.min(notebookWorldLimit,bounds.y+bounds.height+padding))
  return {x,y,width:right-x,height:bottom-y}
}
export function notebookContentBounds(page:NotebookPage,padding=24):CanvasRegion {
  const bounds=[...page.objects,...page.diagram.shapes,...page.diagram.arrows,...page.diagram.connections].map(item=>notebookItemBounds(page,item)).filter((value):value is CanvasRegion=>value!==null)
  if(!bounds.length)return {x:0,y:0,width:1000,height:1200}
  const x=Math.min(...bounds.map(b=>b.x)),y=Math.min(...bounds.map(b=>b.y)),right=Math.max(...bounds.map(b=>b.x+b.width)),bottom=Math.max(...bounds.map(b=>b.y+b.height))
  return paddedBounds({x,y,width:right-x,height:bottom-y},padding)
}
export function notebookSelectionBounds(page:NotebookPage,selectedId:string|null,padding=24):CanvasRegion|null {
  const item=[...page.objects,...page.diagram.shapes,...page.diagram.arrows,...page.diagram.connections].find(item=>item.id===selectedId),bounds=item?notebookItemBounds(page,item):null
  return bounds?paddedBounds(bounds,padding):null
}
export function notebookIntersects(a:CanvasRegion,b:CanvasRegion):boolean { return a.x<=b.x+b.width&&a.x+a.width>=b.x&&a.y<=b.y+b.height&&a.y+a.height>=b.y }
export function cullNotebookItems(page:NotebookPage,region:CanvasRegion,selectedId?:string|null):NotebookPage {
  const visible=(item:NotebookItem)=>item.id===selectedId||Boolean((bounds=>bounds&&notebookIntersects(bounds,region))(notebookItemBounds(page,item)))
  return {...page,objects:page.objects.filter(visible),diagram:{...page.diagram,shapes:page.diagram.shapes.filter(visible),arrows:page.diagram.arrows.filter(visible),connections:page.diagram.connections.filter(visible)}}
}
export function worldToViewport(point:NotebookPoint,viewport:CanvasViewport):NotebookPoint { return {x:(point.x-viewport.x)*viewport.zoom,y:(point.y-viewport.y)*viewport.zoom} }
export function viewportToWorld(point:NotebookPoint,viewport:CanvasViewport):NotebookPoint { return {x:viewport.x+point.x/viewport.zoom,y:viewport.y+point.y/viewport.zoom} }
export function notebookViewportRegion(viewport:CanvasViewport,size:{width:number;height:number}):CanvasRegion { return {x:viewport.x,y:viewport.y,width:size.width/viewport.zoom,height:size.height/viewport.zoom} }
export function fitNotebookBounds(bounds:CanvasRegion,size:{width:number;height:number},padding=48):CanvasViewport {
  const zoom=clamp(Math.min(Math.max(1,size.width-padding*2)/Math.max(1,bounds.width),Math.max(1,size.height-padding*2)/Math.max(1,bounds.height)),.000001,4)
  return {x:clamp(bounds.x+bounds.width/2-size.width/(2*zoom),-notebookWorldLimit,notebookWorldLimit),y:clamp(bounds.y+bounds.height/2-size.height/(2*zoom),-notebookWorldLimit,notebookWorldLimit),zoom}
}
export function zoomNotebookViewport(viewport:CanvasViewport,screenPoint:NotebookPoint,zoom:number):CanvasViewport {
  const anchor=viewportToWorld(screenPoint,viewport),next=clamp(zoom,.000001,4)
  return {x:clamp(anchor.x-screenPoint.x/next,-notebookWorldLimit,notebookWorldLimit),y:clamp(anchor.y-screenPoint.y/next,-notebookWorldLimit,notebookWorldLimit),zoom:next}
}
export function assertNotebookVisibleBounds(page: NotebookPage): void {
  for(const item of [...page.objects,...page.diagram.shapes,...page.diagram.arrows,...page.diagram.connections]){
    const bounds=notebookItemBounds(page,item)
    if(bounds&&(bounds.x<-.01||bounds.y<-.01||bounds.x+bounds.width>page.width+.01||bounds.y+bounds.height>page.height+.01))throw Error('Visible content "'+item.id+'" extends outside the page. Move it inside or enlarge the page before exporting or shrinking.')
  }
}

export function assertNotebookWorldBounds(page:NotebookPage):void {
  for(const item of [...page.objects,...page.diagram.shapes,...page.diagram.arrows,...page.diagram.connections]){const bounds=notebookItemBounds(page,item);if(bounds&&(bounds.x < -notebookWorldLimit || bounds.y < -notebookWorldLimit || bounds.x+bounds.width > notebookWorldLimit || bounds.y+bounds.height > notebookWorldLimit))throw Error('Visible content "'+item.id+'" extends beyond Canvas world bounds. Move it inward before exporting.')}
}
