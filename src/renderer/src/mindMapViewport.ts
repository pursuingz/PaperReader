import type { CanvasViewport } from '../../shared/notebookTypes'
export type MindMapCamera = CanvasViewport
export const initialMindMapView: MindMapCamera = { x: 0, y: 0, zoom: 1 }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
export function zoomMindMap(camera: MindMapCamera, point: {x:number;y:number}, target: number): MindMapCamera {
  const zoom=clamp(target,.01,4)
  return {x:camera.x+point.x/camera.zoom-point.x/zoom,y:camera.y+point.y/camera.zoom-point.y/zoom,zoom}
}
export function panMindMap(camera: MindMapCamera, movement: {x:number;y:number}): MindMapCamera {
  return {...camera,x:camera.x-movement.x/camera.zoom,y:camera.y-movement.y/camera.zoom}
}
export function fitMindMap(layout:{width:number;height:number}, size:{width:number;height:number}): MindMapCamera {
  const zoom=clamp(Math.min(Math.max(1,size.width-24)/layout.width,Math.max(1,size.height-24)/layout.height),.01,1)
  return {x:(layout.width-size.width/zoom)/2,y:(layout.height-size.height/zoom)/2,zoom}
}
