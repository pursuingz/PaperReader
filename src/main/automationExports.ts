import { PDFDocument } from 'pdf-lib'
import type { MindMapDocument } from '../shared/diagramTypes'
import { validateMindMapDocument } from './diagramValidation'
import { inspectCanvasImage } from './canvasValidation'

const literal=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\`*_{}\[\]()#+.!|~-]/g,'\\$&')
export function formatMindMapHierarchy(document:MindMapDocument,title:string):string{
 validateMindMapDocument(document);if(typeof title!=='string'||title.length>1000)throw Error('Invalid mind-map title')
 const lines=['# '+literal(title.replace(/[\r\n\t]/g,' '))+' — Mind map','']
 const children=new Map<string|null,MindMapDocument['nodes']>();for(const node of document.nodes){const group=children.get(node.parentId)??[];group.push(node);children.set(node.parentId,group)}
 const visit=(parent:string|null,depth:number)=>{for(const node of (children.get(parent)??[]).sort((a,b)=>a.order-b.order)){const text=literal(node.text).split(/\r?\n/);lines.push('  '.repeat(depth)+'- '+text[0]);for(const line of text.slice(1))lines.push('  '.repeat(depth+1)+line);visit(node.id,depth+1)}};visit(null,0)
 if(!document.nodes.length)lines.push('No saved mind-map nodes.')
 return lines.join('\n')+'\n'
}
function snapshotPng(bytes:Uint8Array){if(!(bytes instanceof Uint8Array)||bytes.length>64*1024*1024)throw Error('Raster image exceeds resource budget');const copy=new Uint8Array(bytes),info=inspectCanvasImage(copy);if(info.mimeType!=='image/png')throw Error('Raster PDF requires PNG bytes');return {bytes:copy,width:info.width,height:info.height}}
export async function rasterImagesToPdf(images:Uint8Array[],sizes?:Array<{width:number;height:number}>):Promise<Uint8Array>{
 if(!Array.isArray(images)||images.length<1||images.length>64||sizes&&sizes.length!==images.length)throw Error('PDF requires between 1 and 64 image tiles')
 if(images.reduce((n,b)=>n+b.byteLength,0)>64*1024*1024)throw Error('PDF tile bytes exceed resource budget')
 const snapshots=images.map(snapshotPng),document=await PDFDocument.create()
 for(const [index,snapshot]of snapshots.entries()){const size=sizes?.[index]??snapshot;if(!Number.isFinite(size.width)||!Number.isFinite(size.height)||size.width<1||size.height<1||size.width>14400||size.height>14400)throw Error('Invalid PDF tile page dimensions');let image;try{image=await document.embedPng(snapshot.bytes)}catch{throw Error('PNG tile is malformed or cannot be decoded')};const page=document.addPage([size.width,size.height]);page.drawImage(image,{x:0,y:0,width:size.width,height:size.height})}
 return document.save()
}
export async function mindMapPngToPdf(bytes:Uint8Array,options:{pageWidth?:number;pageHeight?:number;margin?:number;pointsPerPixel?:number}={}):Promise<Uint8Array>{
 const snapshot=snapshotPng(bytes),pageWidth=options.pageWidth??841.89,pageHeight=options.pageHeight??595.28,margin=options.margin??24,scale=options.pointsPerPixel??0.5
 if(![pageWidth,pageHeight,margin,scale].every(Number.isFinite)||pageWidth<100||pageHeight<100||pageWidth>2000||pageHeight>2000||margin<0||margin>100||scale<0.1||scale>2)throw Error('Invalid mind-map PDF pagination options')
 const availableWidth=pageWidth-2*margin,availableHeight=pageHeight-2*margin,width=snapshot.width*scale,height=snapshot.height*scale,columns=Math.ceil(width/availableWidth),rows=Math.ceil(height/availableHeight)
 if(availableWidth<1||availableHeight<1||columns*rows>64)throw Error('Mind-map PDF exceeds the 64-page raster budget')
 const document=await PDFDocument.create();let image;try{image=await document.embedPng(snapshot.bytes)}catch{throw Error('Mind-map PNG is malformed or cannot be decoded')}
 for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){const tileWidth=Math.min(availableWidth,width-x*availableWidth),tileHeight=Math.min(availableHeight,height-y*availableHeight),page=document.addPage([tileWidth+margin*2,tileHeight+margin*2]);page.drawImage(image,{x:margin-x*availableWidth,y:margin+tileHeight-height+y*availableHeight,width,height})}
 return document.save()
}
