import type {MindMapDocument} from '../../shared/diagramTypes'
import {computeMindMapLayout} from '../../main/mindMapGeometry'
import {drawMindMapModel,rasterMindMapPng} from './canvasRaster'
export async function rasterAutomationMap(map:MindMapDocument,format:'png'|'pdf'='png'):Promise<Uint8Array[]>{
 if(format==='png')return [await rasterMindMapPng(map)]
 const layout=computeMindMapLayout(map),width=Math.ceil(layout.width),height=Math.ceil(layout.height),images:Uint8Array[]=[]
 if(Math.ceil(width/794)*Math.ceil(height/1123)>128)throw Error('Mind map export exceeds the tile budget')
 await document.fonts.ready
 let total=0
 for(let y=0;y<height;y+=1123)for(let x=0;x<width;x+=794){
  const canvas=document.createElement('canvas');canvas.width=Math.min(794,width-x);canvas.height=Math.min(1123,height-y)
  try{const context=canvas.getContext('2d');if(!context)throw Error('Mind map rendering unavailable');context.translate(-x,-y);drawMindMapModel(context,map)
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(v=>v?resolve(v):reject(Error('Mind map PNG encoding failed')),'image/png'))
   total+=blob.size;if(blob.size>10*1024*1024||total>64*1024*1024)throw Error('Mind map raster exceeds resource budget');images.push(new Uint8Array(await blob.arrayBuffer()))
  }finally{canvas.width=0;canvas.height=0}
 }
 return images
}
