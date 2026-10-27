import test from 'node:test'
import assert from 'node:assert/strict'
import type { NotebookPage } from '../../shared/notebookTypes'
import * as raster from './notebookRaster'
const page=():NotebookPage=>({id:'board',name:'Board',width:1000,height:1200,objects:[],diagram:{version:1,paperId:'paper-a',shapes:[],arrows:[],connections:[]}})
function context(){const translations:number[][]=[],fills:number[][]=[],texts:string[]=[];const ctx={save(){},restore(){},scale(){},translate(x:number,y:number){translations.push([x,y])},fillRect(...values:number[]){fills.push(values)},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){},ellipse(){},rect(){},strokeRect(){},fillText(text:string){texts.push(text)},drawImage(){},measureText(text:string){return {width:text.length*8}}} as unknown as CanvasRenderingContext2D;return {ctx,translations,fills,texts}}
test('region drawing translates negative world content and excludes resources and overflow outside that finite extent',async()=>{
 const p=page();p.objects=[{id:'visible',type:'text',x:-50000,y:-80000,width:400,height:200,text:'Far negative',fontSize:20,color:'#334155'},{id:'unrelated',type:'image',x:50000,y:50000,width:100,height:100,assetId:'00000000-0000-4000-8000-000000000001'},{id:'overflow',type:'text',x:60000,y:60000,width:1,height:1,text:'Unrelated overflow',fontSize:24,color:'#334155'}]
 const c=context();await raster.drawNotebookRegion(c.ctx,p,{x:-50024,y:-80024,width:448,height:248},async()=>{throw Error('must not read outside region')},2)
 assert.deepEqual(c.translations[0],[50024,80024]);assert.ok(c.fills.some(values=>values[0]===-50024&&values[1]===-80024&&values[2]===448&&values[3]===248));assert.ok(c.texts.includes('Far negative'));assert.ok(!c.texts.includes('Unrelated overflow'))
})
test('region drawing rejects overflowing included text and dangling connections before drawing',async()=>{
 const p=page(),c=context();p.objects=[{id:'overflow',type:'text',x:-10,y:-10,width:40,height:20,text:'Does not fit',fontSize:24,color:'#334155'}]
 await assert.rejects(raster.drawNotebookRegion(c.ctx,p,{x:-100,y:-100,width:200,height:200},async()=>{throw Error('unexpected')}),/overflow|fit|text/i)
 assert.equal(c.fills.length,0)
 p.objects=[];p.diagram.connections=[{id:'lost',from:{domain:'base',objectId:'missing',anchor:'auto'},to:{domain:'shape',objectId:'missing2',anchor:'auto'},color:'#334155',lineWidth:2}]
 await assert.rejects(raster.drawNotebookRegion(c.ctx,p,{x:0,y:0,width:100,height:100},async()=>{throw Error('unexpected')}),/endpoint|connection/i)
})
test('region PNG and PDF allocate only each bounded tile, preserve row major extents and release bitmaps',async()=>{
 const p=page(),allocations:Array<{width:number;height:number;translations:number[][]}>=[]
 const previousDocument=Object.getOwnPropertyDescriptor(globalThis,'document')
 Object.defineProperty(globalThis,'document',{configurable:true,value:{fonts:{ready:Promise.resolve()},createElement(){const c=context(),canvas={width:0,height:0,getContext:()=>c.ctx,toBlob(done:(value:Blob)=>void){allocations.push({width:canvas.width,height:canvas.height,translations:c.translations});done(new Blob([new Uint8Array([1,2,3])]))}};return canvas}}})
 try{
  const images=await raster.rasterNotebookRegion('paper-a',p,{format:'pdf',scope:'selection',region:{x:-4000,y:-8000,width:1300,height:1700}},async()=>{throw Error('unexpected')})
  assert.equal(images.length,4);assert.deepEqual(allocations.map(a=>[a.width,a.height]),[[1200,1600],[100,1600],[1200,100],[100,100]]);assert.deepEqual(allocations.map(a=>a.translations[0]),[[4000,8000],[2800,8000],[4000,6400],[2800,6400]])
  allocations.length=0;await raster.rasterNotebookRegion('paper-a',p,{format:'png',scope:'viewport',region:{x:-100000,y:200000,width:100000,height:200000}},async()=>{throw Error('unexpected')})
  assert.deepEqual(allocations.map(a=>[a.width,a.height]),[[2048,4096]])
 }finally{if(previousDocument)Object.defineProperty(globalThis,'document',previousDocument);else Reflect.deleteProperty(globalThis,'document')}
})

test('all export refuses visible ink beyond the world guard before allocating any bitmap',async()=>{
 const p=page();p.objects=[{id:'edge',type:'stroke',points:[{x:10000000,y:0},{x:10000000,y:1}],strokeWidth:20,color:'#334155'}]
 const c=context();await assert.rejects(raster.drawNotebookRegion(c.ctx,p,{x:9999900,y:-100,width:100,height:200},async()=>{throw Error('unexpected')}),/world|bound|visible/i);assert.equal(c.fills.length,0)
})
test('fractional PDF edge tiles stretch their complete finite extent to the integer bitmap without a seam stripe',async()=>{
 const p=page(),scales:number[][]=[];const previous=Object.getOwnPropertyDescriptor(globalThis,'document')
 Object.defineProperty(globalThis,'document',{configurable:true,value:{fonts:{ready:Promise.resolve()},createElement(){const c=context();c.ctx.scale=(x:number,y:number)=>{scales.push([x,y])};return {width:0,height:0,getContext:()=>c.ctx,toBlob(done:(blob:Blob)=>void){done(new Blob([new Uint8Array([1])]))}}}}})
 try{await raster.rasterNotebookRegion('paper-a',p,{format:'pdf',scope:'selection',region:{x:0,y:0,width:100.25,height:200.5}},async()=>{throw Error('unexpected')});assert.deepEqual(scales[0],[101/100.25,201/200.5])}finally{if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document')}
})
