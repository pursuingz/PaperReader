import test from 'node:test'
import assert from 'node:assert/strict'
import type { CanvasExportOptions } from '../../shared/notebookTypes'
const options=():CanvasExportOptions=>({format:'pdf',scope:'selection',region:{x:-1200,y:-800,width:2400,height:3200}})
async function command(){const module=await import('./noteWorkspaceIntegration') as Record<string,unknown>;assert.equal(typeof module.exportNotebookRegion,'function','Infinite range export needs an immutable guarded command');return module.exportNotebookRegion as (value:any)=>Promise<any>}
test('region export flushes once and preserves captured paper board options and all tiles',async()=>{
 const run=await command(), order:unknown[]=[], input=options(), images=[Uint8Array.of(1),Uint8Array.of(2)]
 const result=await run({paperId:'paper-a',pageId:'board-b',options:input,flush:async()=>{order.push('flush');input.region.x=999},raster:async(value:CanvasExportOptions)=>{order.push(value.region.x);return images},save:async(paper:string,board:string,value:CanvasExportOptions,data:Uint8Array[])=>{order.push([paper,board,value.region.x,data]);return {canceled:false}},isCurrent:()=>true})
 assert.deepEqual(order,['flush',-1200,['paper-a','board-b',-1200,images]]);assert.equal(result.canceled,false)
})
test('stale board during region raster cannot open the destination dialog',async()=>{
 const run=await command();let current=true,saved=false
 await assert.rejects(run({paperId:'a',pageId:'b',options:options(),flush:async()=>{},raster:async()=>{current=false;return [new Uint8Array()]},save:async()=>{saved=true},isCurrent:()=>current}),/changed/);assert.equal(saved,false)
})
test('failed note persistence or region raster never proceeds to file output',async()=>{
 const run=await command();let renders=0,saves=0
 const base={paperId:'a',pageId:'b',options:options(),flush:async()=>{},raster:async()=>{renders++;return []},save:async()=>{saves++},isCurrent:()=>true}
 await assert.rejects(run({...base,flush:async()=>{throw Error('pending text save failed')}}),/pending text save/);assert.equal(renders,0)
 await assert.rejects(run({...base,raster:async()=>{throw Error('missing saved image')}}),/missing saved image/);assert.equal(saves,0)
})

test('all-content export resolves current bounds after finishing the pending editor',async()=>{
 const run=await command();let bounds={x:0,y:0,width:1,height:1};const seen:unknown[]=[]
 await run({paperId:'a',pageId:'b',options:{...options(),scope:'all'},flush:async()=>{bounds={x:-500,y:-900,width:1400,height:1800}},resolveOptions:(captured:CanvasExportOptions)=>({...captured,region:bounds}),raster:async(value:CanvasExportOptions)=>{seen.push(value.region);return []},save:async(_a:string,_b:string,value:CanvasExportOptions)=>seen.push(value.region),isCurrent:()=>true})
 assert.deepEqual(seen,[bounds,bounds])
})
