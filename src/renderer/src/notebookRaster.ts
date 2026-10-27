import type { CanvasImageData } from '../../shared/types'
import type { CanvasExportOptions, CanvasRegion, NotebookPage, NotebookQuoteObject, NotebookTextObject } from '../../shared/notebookTypes'
import { notebookPngSize, validateCanvasNotebook } from '../../main/notebookValidation'
import { canvasImageLimit, validateCanvasImageInfo } from '../../main/canvasValidation'
import { computeMindMapLayout } from '../../main/mindMapGeometry'
import { arrowHead } from './diagramModel'
import { assertNotebookVisibleBounds, assertNotebookWorldBounds, notebookConnection, notebookIntersects, notebookItemBounds } from './notebookGeometry'
import { canvasExportPlan, validateCanvasRegion } from '../../shared/canvasViewport'
import { layoutRichText, measureNotebookText, plainRichText, richFont, type RichMeasure } from './notebookRichText'
import type { DecodedCanvasImage } from './canvasRaster'

export function notebookTextMetrics(object: NotebookTextObject | NotebookQuoteObject, measure: RichMeasure = measureNotebookText) {
  if (object.type === 'text') {
    const layout = layoutRichText(object.richText ?? plainRichText(object.text), object.fontSize, object.width - 24, measure)
    return { height: layout.height + 24, overflowWidth: layout.overflowWidth, quote: layout, comment: null, quoteY: 12, commentY: 0 }
  }
  const quote = layoutRichText({ blocks: [{ kind: 'paragraph', runs: [{ text: object.quote, italic: true }] }] }, object.fontSize, object.width - 32, measure)
  const comment = layoutRichText(plainRichText(object.comment), object.fontSize, object.width - 32, measure)
  const quoteY = 42, commentY = quoteY + quote.height + 28
  return { height: commentY + comment.height + 16, overflowWidth: quote.overflowWidth || comment.overflowWidth || measure('SOURCE · PDF p. ' + object.source.page, {text:''}, 13) > object.width - 32 || measure('PERSONAL COMMENT', {text:''}, 11) > object.width - 32, quote, comment, quoteY, commentY }
}
function drawLayout(context: CanvasRenderingContext2D, value: ReturnType<typeof layoutRichText>, x: number, y: number, color: string) {
  context.textBaseline = 'top'
  for (const line of value.lines) for (const run of line.fragments) {
    context.font = richFont(run, run.fontSize)
    if (run.highlight) { context.fillStyle = run.highlight; context.fillRect(x + run.x, y + line.y, run.width, line.height) }
    context.fillStyle = run.color ?? color; context.fillText(run.text, x + run.x, y + line.y + run.fontSize * .2)
    if (run.underline) { context.strokeStyle = run.color ?? color; context.lineWidth = Math.max(1, run.fontSize / 16); context.beginPath(); context.moveTo(x + run.x, y + line.y + run.fontSize * 1.25); context.lineTo(x + run.x + run.width, y + line.y + run.fontSize * 1.25); context.stroke() }
  }
}
function validateText(context: CanvasRenderingContext2D, object: NotebookTextObject | NotebookQuoteObject) {
  const measure: RichMeasure = (text, run, size) => { context.font = richFont(run, size); return context.measureText(text).width }, metrics = notebookTextMetrics(object, measure)
  if (metrics.height > object.height + .01 || metrics.overflowWidth) throw Error('Text overflow in "' + (object.type === 'text' ? object.text.slice(0,30) : object.quote.slice(0,30)) + '". Fit content or enlarge the text box before exporting.')
  return metrics
}
function drawText(context: CanvasRenderingContext2D, object: NotebookTextObject | NotebookQuoteObject) {
  const metrics = validateText(context, object)
  context.fillStyle = object.type === 'quote' ? '#fff9e9' : '#fffbf2'; context.fillRect(object.x,object.y,object.width,object.height)
  if (object.type === 'quote') {
    context.fillStyle = '#8a785c'; context.font = richFont({text:''},13); context.textBaseline = 'top'; context.fillText('SOURCE · PDF p. ' + object.source.page,object.x+16,object.y+13)
    drawLayout(context,metrics.quote,object.x+16,object.y+metrics.quoteY,'#536373')
    context.font = richFont({text:''},11); context.fillStyle = '#a47764'; context.fillText('PERSONAL COMMENT',object.x+16,object.y+metrics.commentY-18)
    drawLayout(context,metrics.comment!,object.x+16,object.y+metrics.commentY,'#334155')
  } else drawLayout(context,metrics.quote,object.x+12,object.y+12,object.color)
}
function drawArrow(context: CanvasRenderingContext2D,start:{x:number;y:number},end:{x:number;y:number},color:string,width:number) {
  const [a,b] = arrowHead(start,end,width); context.strokeStyle=color;context.lineWidth=width;context.lineCap='round';context.lineJoin='round';context.beginPath();context.moveTo(start.x,start.y);context.lineTo(end.x,end.y);context.lineTo(a.x,a.y);context.moveTo(end.x,end.y);context.lineTo(b.x,b.y);context.stroke()
}
async function drawNotebookContents(context:CanvasRenderingContext2D,page:NotebookPage,loadImage:(id:string)=>Promise<DecodedCanvasImage>,region?:CanvasRegion):Promise<void> {
  const visible = (item:Parameters<typeof notebookItemBounds>[1]) => { const bounds = notebookItemBounds(page,item); return !region || Boolean(bounds && notebookIntersects(bounds,region)) }
    for(const object of page.objects.filter(visible)) {
      if(object.type==='text'||object.type==='quote'){drawText(context,object);continue}
      if(object.type==='image') {
        const image=await loadImage(object.assetId)
        try { if(!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width>4096||image.height>4096)throw Error('Saved image dimensions are unavailable');const ratio=Math.min(object.width/image.width,object.height/image.height),width=image.width*ratio,height=image.height*ratio;context.drawImage(image.image,object.x+(object.width-width)/2,object.y+(object.height-height)/2,width,height) } finally {image.close?.()}
        continue
      }
      if(object.type==='mindmap') {
        const map=computeMindMapLayout({version:1,paperId:page.diagram.paperId,nodes:object.nodes}),sx=object.width/map.width,sy=object.height/map.height
        if(Math.min(sx,sy)<.75)throw Error('Map text is below the readable size. Enlarge the map group before export.')
        context.save()
        try { context.translate(object.x,object.y);context.scale(sx,sy);context.strokeStyle='#4b8f82';context.lineWidth=2;for(const edge of map.edges){context.beginPath();context.moveTo(edge.start.x,edge.start.y);context.lineTo(edge.end.x,edge.end.y);context.stroke()}
          for(const node of map.nodes){context.fillStyle='#fffbf2';context.fillRect(node.x,node.y,node.width,node.height);context.strokeStyle='#4b8f82';context.lineWidth=2;context.strokeRect(node.x,node.y,node.width,node.height);context.font='16px "Cascadia Mono", Consolas, monospace';context.fillStyle='#334155';context.textBaseline='top';node.lines.forEach((line,i)=>context.fillText(line,node.x+12,node.y+12+i*22))}
        }finally{context.restore()}
        continue
      }
      context.strokeStyle=object.color;context.fillStyle=object.color;context.lineWidth=object.strokeWidth;context.lineCap='round';context.lineJoin='round';context.beginPath();const first=object.points[0]
      if(object.points.every(point=>point.x===first.x&&point.y===first.y)){context.arc(first.x,first.y,object.strokeWidth/2,0,Math.PI*2);context.fill()}
      else{context.moveTo(first.x,first.y);for(const point of object.points.slice(1))context.lineTo(point.x,point.y);context.stroke()}
    }
    for(const shape of page.diagram.shapes.filter(visible)){context.beginPath();if(shape.kind==='circle')context.ellipse(shape.x+shape.width/2,shape.y+shape.height/2,shape.width/2,shape.height/2,0,0,Math.PI*2);else context.rect(shape.x,shape.y,shape.width,shape.height);if(shape.fill!=='transparent'){context.fillStyle=shape.fill;context.fill()}context.strokeStyle=shape.color;context.lineWidth=shape.lineWidth;context.stroke()}
    for(const arrow of page.diagram.arrows.filter(visible))drawArrow(context,arrow.start,arrow.end,arrow.color,arrow.lineWidth)
    for(const connection of page.diagram.connections.filter(visible)){const geometry=notebookConnection(page,connection);if(geometry)drawArrow(context,geometry.start,geometry.end,connection.color,connection.lineWidth)}
}
function assertConnections(page:NotebookPage) {
  if(page.diagram.connections.some(item=>!notebookConnection(page,item)))throw Error('A connection has missing endpoints. Restore its objects or remove the connection before exporting; its saved record remains available for undo.')
}
function preflightText(context:CanvasRenderingContext2D,page:NotebookPage,region?:CanvasRegion) {
  for(const object of page.objects)if((object.type==='text'||object.type==='quote')&&(!region||notebookIntersects(object,region)))validateText(context,object)
  for(const object of page.objects)if(object.type==='mindmap'&&(!region||notebookIntersects(object,region))){const map=computeMindMapLayout({version:1,paperId:page.diagram.paperId,nodes:object.nodes});if(Math.min(object.width/map.width,object.height/map.height)<.75)throw Error('Map text is below the readable size. Enlarge the map group before export.')}
}
export async function drawNotebookPage(context:CanvasRenderingContext2D,page:NotebookPage,loadImage:(id:string)=>Promise<DecodedCanvasImage>,scale=1):Promise<void> {
  validateCanvasNotebook({version:1,paperId:page.diagram.paperId,activePageId:page.id,pages:[page]},page.diagram.paperId);assertConnections(page);assertNotebookVisibleBounds(page);preflightText(context,page)
  context.save()
  try{context.scale(scale,scale);context.fillStyle='#fffdf8';context.fillRect(0,0,page.width,page.height);context.fillStyle='#e9e6df';context.beginPath();for(let y=2;y<page.height;y+=24)for(let x=2;x<page.width;x+=24){context.moveTo(x+1,y);context.arc(x,y,1,0,Math.PI*2)}context.fill();await drawNotebookContents(context,page,loadImage)}finally{context.restore()}
}
export async function drawNotebookRegion(context:CanvasRenderingContext2D,page:NotebookPage,region:CanvasRegion,loadImage:(id:string)=>Promise<DecodedCanvasImage>,scale=1):Promise<void> {
  validateCanvasRegion(region);validateCanvasNotebook({version:1,surface:'infinite',paperId:page.diagram.paperId,activePageId:page.id,pages:[page]},page.diagram.paperId);assertConnections(page);assertNotebookWorldBounds(page);preflightText(context,page,region)
  if(!Number.isFinite(scale)||scale<=0)throw Error('Invalid Canvas raster scale')
  context.save()
  try{
    context.scale(scale,scale);context.translate(-region.x,-region.y);context.fillStyle='#fffdf8';context.fillRect(region.x,region.y,region.width,region.height)
    const step=Math.max(24,24/scale),startX=Math.ceil((region.x-2)/step)*step+2,startY=Math.ceil((region.y-2)/step)*step+2
    context.fillStyle='#e9e6df';context.beginPath();for(let y=startY;y<region.y+region.height;y+=step)for(let x=startX;x<region.x+region.width;x+=step){context.moveTo(x+1,y);context.arc(x,y,1,0,Math.PI*2)}context.fill()
    await drawNotebookContents(context,page,loadImage,region)
  }finally{context.restore()}
}
export async function rasterNotebookPng(paperId:string,page:NotebookPage,readImage:(paperId:string,assetId:string)=>Promise<CanvasImageData>):Promise<Uint8Array> {
  const size=notebookPngSize(page),canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height
  const context=canvas.getContext('2d');if(!context)throw Error('Canvas rendering is unavailable')
  await document.fonts.ready
  await drawNotebookPage(context,page,assetId=>decodeNotebookImage(paperId,assetId,readImage),size.scale)
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('PNG encoding failed')),'image/png'))
  if(blob.size>canvasImageLimit)throw Error('Current page PNG exceeds 10 MiB; reduce image content before exporting')
  return new Uint8Array(await blob.arrayBuffer())
}



async function decodeNotebookImage(paperId:string,assetId:string,readImage:(paperId:string,assetId:string)=>Promise<CanvasImageData>):Promise<DecodedCanvasImage> {
    const value=await readImage(paperId,assetId);if(value.assetId!==assetId)throw Error('Saved image ownership changed')
    validateCanvasImageInfo({mimeType:value.mimeType,width:value.width,height:value.height});if(!(value.bytes instanceof Uint8Array)||value.bytes.length>canvasImageLimit)throw Error('Saved image exceeds the 10 MiB limit')
    const bitmap=await createImageBitmap(new Blob([new Uint8Array(value.bytes).buffer],{type:value.mimeType}))
    if(bitmap.width!==value.width||bitmap.height!==value.height){bitmap.close();throw Error('Saved image dimensions do not match')}
    return {image:bitmap,width:bitmap.width,height:bitmap.height,close:()=>bitmap.close()}

}
export async function rasterNotebookRegion(paperId:string,page:NotebookPage,options:CanvasExportOptions,readImage:(paperId:string,assetId:string)=>Promise<CanvasImageData>):Promise<Uint8Array[]> {
  if(page.diagram.paperId!==paperId)throw Error('Canvas page ownership changed')
  const plan=canvasExportPlan(options),images:Uint8Array[]=[];let total=0
  await document.fonts.ready
  for(const tile of plan){
    const canvas=document.createElement('canvas');canvas.width=tile.width;canvas.height=tile.height
    try{
      const context=canvas.getContext('2d');if(!context)throw Error('Canvas rendering is unavailable')
      context.scale(tile.width/(tile.region.width*tile.scale),tile.height/(tile.region.height*tile.scale))
      await drawNotebookRegion(context,page,tile.region,assetId=>decodeNotebookImage(paperId,assetId,readImage),tile.scale)
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('PNG encoding failed')),'image/png'))
      if(blob.size>canvasImageLimit)throw Error('Canvas export tile exceeds 10 MiB; choose a smaller region')
      total+=blob.size;if(total>64*1024*1024)throw Error('Canvas export exceeds the 64 MiB image budget')
      images.push(new Uint8Array(await blob.arrayBuffer()))
    }finally{canvas.width=0;canvas.height=0}
  }
  return images
}
