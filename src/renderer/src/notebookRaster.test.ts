import test from 'node:test'
import assert from 'node:assert/strict'
import type { NotebookPage } from '../../shared/notebookTypes'
const modulePromise = import('./notebookRaster').catch(() => ({}))
const page = (): NotebookPage => ({ id: 'page', name: 'Page', width: 1600, height: 900, objects: [], diagram: { version: 1, paperId: 'paper', shapes: [], arrows: [], connections: [] } })
test('complete page raster uses the actual dimensions and preserves rich marks, quote comments and map edges', async () => {
  const r = await modulePromise as typeof import('./notebookRaster'); assert.equal(typeof r.drawNotebookPage, 'function', 'Notebook raster feature is missing')
  const drawn: string[] = [], fills: string[] = []; let color = ''
  const ctx = { save() {}, restore() {}, scale() {}, translate() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, ellipse() {}, rect() {}, fillRect(_x:number,_y:number,w:number,h:number) { fills.push(w + 'x' + h + ':' + color) }, fillText(text:string) { drawn.push(text) }, measureText(text:string) { return { width: Array.from(text).length * 8 } }, set fillStyle(value:string) { color = value }, get fillStyle() { return color } } as unknown as CanvasRenderingContext2D
  const p = page(); p.objects = [{ id: 'text', type: 'text', x: 40, y: 40, width: 400, height: 200, text: 'Marked', color: '#334155', fontSize: 20, richText: { blocks: [{ kind: 'paragraph', runs: [{ text: 'Marked', bold: true, highlight: '#f3d653' }] }] } }, { id: 'quote', type: 'quote', x: 450, y: 40, width: 400, height: 250, quote: 'Evidence', comment: 'My thought', fontSize: 18, source: { paperId: 'paper', highlightId: 'highlight', page: 4, rects: [{ x:.1,y:.2,width:.3,height:.1 }], importedAt:'2026-10-08T12:00:00.000Z' } }, { id:'map',type:'mindmap',x:40,y:350,width:584,height:134,nodes:[{id:'root',text:'Root',parentId:null,order:0},{id:'child',text:'Child',parentId:'root',order:0}],source:{paperId:'paper',importedAt:'2026-10-08T12:00:00.000Z'}}]
  await r.drawNotebookPage(ctx, p, async () => { throw Error('unexpected image') }, 1)
  assert.ok(fills.some(fill => fill.startsWith('1600x900:'))); assert.ok(fills.some(fill => fill.endsWith('#f3d653')))
  for(const expected of ['Marked','Evidence','My thought','Root','Child']) assert.ok(drawn.some(text => text.includes(expected)), expected + ' must appear in PNG')
})
test('raster refuses overflowing text and missing images instead of yielding clipped successful PNG', async () => {
  const r = await modulePromise as typeof import('./notebookRaster'); assert.equal(typeof r.drawNotebookPage, 'function')
  const p = page(); p.objects = [{ id:'text',type:'text',x:0,y:0,width:50,height:20,text:'This text cannot fit',color:'#334155',fontSize:24 }]
  const ctx = { save() {},restore() {},scale() {},fillRect() {},beginPath() {},moveTo() {},arc() {},fill() {},measureText(text:string) { return { width: text.length * 14 } } } as unknown as CanvasRenderingContext2D
  await assert.rejects(r.drawNotebookPage(ctx,p,async()=>{throw Error('missing')},1), /overflow|fit|text/i)
  p.objects=[{id:'image',type:'image',x:0,y:0,width:200,height:100,assetId:'00000000-0000-4000-8000-000000000001'}]
  await assert.rejects(r.drawNotebookPage(ctx,p,async()=>{throw Error('missing owned image')},1), /missing owned image/)
})



test('PNG resource path accepts complete owned image metadata and renders it at actual bounded page size', async () => {
  const r = await modulePromise as typeof import('./notebookRaster'); assert.equal(typeof r.rasterNotebookPng,'function')
  const p = page();p.objects=[{id:'image',type:'image',x:10,y:20,width:200,height:100,assetId:'00000000-0000-4000-8000-000000000001'}]
  let rendered=false,closed=false
  const ctx={save(){},restore(){},scale(){},fillRect(){},beginPath(){},moveTo(){},arc(){},fill(){},drawImage(){rendered=true}} as unknown as CanvasRenderingContext2D
  const canvas={width:0,height:0,getContext:()=>ctx,toBlob:(done:(value:Blob)=>void)=>done(new Blob([new Uint8Array([1,2,3])]))}
  const previousDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),previousBitmap=Object.getOwnPropertyDescriptor(globalThis,'createImageBitmap')
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>canvas,fonts:{ready:Promise.resolve()}}})
  Object.defineProperty(globalThis,'createImageBitmap',{configurable:true,value:async()=>({width:200,height:100,close(){closed=true}})})
  try{
    const bytes=await r.rasterNotebookPng('paper',p,async()=>({assetId:'00000000-0000-4000-8000-000000000001',mimeType:'image/png',width:200,height:100,bytes:new Uint8Array([1]),source:{page:5,rect:{x:.1,y:.1,width:.2,height:.2}}}))
    assert.equal(rendered,true);assert.equal(closed,true);assert.equal(canvas.width,3200);assert.equal(canvas.height,1800);assert.deepEqual(bytes,new Uint8Array([1,2,3]))
  }finally{
    if(previousDocument)Object.defineProperty(globalThis,'document',previousDocument);else Reflect.deleteProperty(globalThis,'document')
    if(previousBitmap)Object.defineProperty(globalThis,'createImageBitmap',previousBitmap);else Reflect.deleteProperty(globalThis,'createImageBitmap')
  }
})


test('quote raster refuses a narrow card whose source and comment labels would escape',async()=>{
  const r=await modulePromise as typeof import('./notebookRaster'),p=page()
  p.objects=[{id:'quote',type:'quote',x:100,y:20,width:40,height:220,quote:'',comment:'',fontSize:18,source:{paperId:'paper',highlightId:'highlight',page:12,rects:[{x:.1,y:.1,width:.2,height:.2}],importedAt:'2026-10-08T12:00:00.000Z'}}]
  const ctx={save(){},restore(){},scale(){},fillRect(){},beginPath(){},moveTo(){},arc(){},fill(){},fillText(){},measureText(text:string){return {width:text.length*8}}} as unknown as CanvasRenderingContext2D
  await assert.rejects(r.drawNotebookPage(ctx,p,async()=>{throw Error('unexpected')}),/overflow|fit|label/i)
})
test('PNG refuses visible arrow heads, connections, shape outlines and stroke radii outside the page',async()=>{
  const r=await modulePromise as typeof import('./notebookRaster'),p=page();p.width=256;p.height=256
  const ctx={save(){},restore(){},scale(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){},rect(){},ellipse(){}} as unknown as CanvasRenderingContext2D
  p.diagram.arrows=[{id:'arrow',start:{x:20,y:5},end:{x:250,y:5},color:'#334155',lineWidth:12}]
  await assert.rejects(r.drawNotebookPage(ctx,p,async()=>{throw Error('unexpected')}),/outside|bounds|enlarge|move/i)
  p.diagram.arrows=[];p.objects=[{id:'stroke',type:'stroke',points:[{x:0,y:100},{x:50,y:100}],color:'#334155',strokeWidth:12}]
  await assert.rejects(r.drawNotebookPage(ctx,p,async()=>{throw Error('unexpected')}),/outside|bounds|enlarge|move/i)
  p.objects=[];p.diagram.shapes=[{id:'shape',kind:'rectangle',x:0,y:20,width:50,height:50,fill:'transparent',color:'#334155',lineWidth:12}]
  await assert.rejects(r.drawNotebookPage(ctx,p,async()=>{throw Error('unexpected')}),/outside|bounds|enlarge|move/i)
  p.diagram.shapes=[{id:'a',kind:'rectangle',x:20,y:4,width:40,height:40,fill:'transparent',color:'#334155',lineWidth:2},{id:'b',kind:'rectangle',x:190,y:4,width:40,height:40,fill:'transparent',color:'#334155',lineWidth:2}]
  p.diagram.connections=[{id:'connection',from:{domain:'shape',objectId:'a',anchor:'top'},to:{domain:'shape',objectId:'b',anchor:'top'},color:'#334155',lineWidth:12}]
  await assert.rejects(r.drawNotebookPage(ctx,p,async()=>{throw Error('unexpected')}),/outside|bounds|enlarge|move/i)
})


test('PNG rejects a connection with missing endpoints without deleting its recoverable record',async()=>{
  const r=await modulePromise as typeof import('./notebookRaster'),p=page()
  p.diagram.connections=[{id:'lost',from:{domain:'base',objectId:'removed',anchor:'auto'},to:{domain:'shape',objectId:'removed-too',anchor:'auto'},color:'#334155',lineWidth:2}]
  const original=structuredClone(p)
  const ctx={save(){},restore(){},scale(){},fillRect(){},beginPath(){},moveTo(){},arc(){},fill(){}} as unknown as CanvasRenderingContext2D
  await assert.rejects(r.drawNotebookPage(ctx,p,async()=>{throw Error('unexpected')}),/connection|endpoint|restore|remove/i)
  assert.deepEqual(p,original)
  p.diagram.connections=[]
  await r.drawNotebookPage(ctx,p,async()=>{throw Error('unexpected')})
})


test('raster preserves arbitrary valid custom text run highlight stroke shape and arrow colors', async () => {
  const r = await modulePromise as typeof import('./notebookRaster'), p = page(), fills: string[] = [], strokes: string[] = []
  let fill = '', stroke = ''
  const context = { save(){},restore(){},scale(){},translate(){},strokeRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){strokes.push(stroke)},arc(){},fill(){fills.push(fill)},ellipse(){},rect(){},fillRect(){fills.push(fill)},fillText(){fills.push(fill)},measureText(text:string){return {width:text.length*8}},set fillStyle(value:string){fill=value},get fillStyle(){return fill},set strokeStyle(value:string){stroke=value},get strokeStyle(){return stroke} } as unknown as CanvasRenderingContext2D
  p.objects = [{ id:'custom-text',type:'text',x:20,y:20,width:350,height:180,text:'Run default',fontSize:20,color:'#123abc',richText:{blocks:[{kind:'paragraph',runs:[{text:'Run',color:'#12ab34',highlight:'#debc12'},{text:' default'}]}]} },{id:'custom-stroke',type:'stroke',points:[{x:40,y:300},{x:200,y:320}],color:'#aabbcc',strokeWidth:4}]
  p.diagram.shapes=[{id:'custom-shape',kind:'rectangle',x:450,y:20,width:100,height:100,color:'#6a1b9a',fill:'#fbc123',lineWidth:2}]
  p.diagram.arrows=[{id:'custom-arrow',start:{x:400,y:300},end:{x:500,y:300},color:'#1c2d3e',lineWidth:3}]
  await r.drawNotebookPage(context,p,async()=>{throw Error('No images')})
  for(const color of ['#123abc','#12ab34','#debc12','#fbc123'])assert.ok(fills.includes(color),color+' must be rendered')
  for(const color of ['#aabbcc','#6a1b9a','#1c2d3e'])assert.ok(strokes.includes(color),color+' must be rendered')
})
