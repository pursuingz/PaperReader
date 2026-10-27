import test from 'node:test'
import assert from 'node:assert/strict'
import type { CanvasNotebook, NotebookPage } from '../../shared/notebookTypes'
import { NotebookSession } from './notebookSession'
import * as geometry from './notebookGeometry'
const page = (): NotebookPage => ({ id:'page-a',name:'Board',width:1000,height:1200,viewport:{x:-5000,y:8000,zoom:2},objects:[],diagram:{version:1,paperId:'paper-a',shapes:[],arrows:[],connections:[]} })
const book = (): CanvasNotebook => ({version:1,surface:'infinite',paperId:'paper-a',activePageId:'page-a',pages:[page()]})
async function fixture(regionRaster?:ConstructorParameters<typeof NotebookSession>[5]) {
 const saves:CanvasNotebook[]=[]
 const api={loadCanvasNotebook:async()=>book(),saveCanvasNotebook:async(_id:string,value:CanvasNotebook)=>{saves.push(structuredClone(value))},loadMarks:async()=>({highlights:[],strokes:[]}),readCanvasHighlight:async()=>({id:'h',page:2,quote:'Evidence',comment:'Copy',color:'yellow' as const,rects:[{x:.1,y:.2,width:.2,height:.1}],createdAt:'2026-10-26T12:00:00.000Z'}),loadMindMap:async()=>({version:1 as const,paperId:'paper-a',nodes:[{id:'r',text:'Root',parentId:null,order:0}]}),importCanvasImage:async()=>null,saveCanvasCapture:async()=>({assetId:'00000000-0000-4000-8000-000000000001',mimeType:'image/png' as const,width:200,height:100}),readCanvasImage:async()=>({assetId:'00000000-0000-4000-8000-000000000001',mimeType:'image/png' as const,width:200,height:100,bytes:new Uint8Array([1])})}
 const session=new NotebookSession(api,()=>undefined,()=> 'blob:test',()=>undefined,undefined,regionRaster)
 await session.open('paper-a');return {session,saves,api}
}
test('infinite creation, dragging, resizing and drawing work beyond finite metadata in every direction',async()=>{
 const {session}=await fixture(),id=session.addText(),object=session.activePage!.objects[0]
 assert.equal(object.type,'text');if(object.type!=='text')throw Error('text required')
 assert.equal(object.x,-4960);assert.equal(object.y,8040)
 session.beginMove(id,{x:0,y:0});session.moveTo({x:-20000,y:-30000});session.finish()
 const moved=session.activePage!.objects[0];assert.equal('x' in moved&&moved.x,-24960);assert.equal('y' in moved&&moved.y,-21960)
 session.beginResize(id,{x:0,y:0});session.resizeTo({x:5000,y:6000});session.finish()
 const resized=session.activePage!.objects[0];assert.equal('width' in resized&&resized.width,5400);assert.equal('height' in resized&&resized.height,6220)
 session.beginStroke({x:-900000,y:700000});session.strokeTo({x:900000,y:-700000});session.finish()
 const stroke=session.activePage!.objects[1];assert.equal(stroke.type,'stroke');if(stroke.type==='stroke')assert.deepEqual(stroke.points,[{x:-900000,y:700000},{x:-900000,y:700000},{x:900000,y:-700000}])
})
test('camera persists without finishing active text or adding undo entries and survives undo redo and board switches',async()=>{
 const {session,saves}=await fixture(),id=session.addText();session.editText(id,'First')
 let commits=0;const release=session.registerEditorCommit(()=>{++commits})
 session.setViewport({x:12000,y:-9000,zoom:.5});assert.equal(commits,0);assert.equal(session.editing,true)
 session.editText(id,'Second');session.finish();release();session.undo()
 assert.equal((session.activePage!.objects[0] as {text:string}).text,'');assert.deepEqual(session.viewport,{x:12000,y:-9000,zoom:.5})
 session.redo();assert.equal((session.activePage!.objects[0] as {text:string}).text,'Second');assert.deepEqual(session.viewport,{x:12000,y:-9000,zoom:.5})
 const second=await session.addPage();session.setViewport({x:-123,y:456,zoom:3});await session.switchPage('page-a');assert.deepEqual(session.viewport,{x:12000,y:-9000,zoom:.5})
 await session.switchPage(second);assert.deepEqual(session.viewport,{x:-123,y:456,zoom:3});await session.flush();assert.deepEqual(saves.at(-1)!.pages.find(p=>p.id===second)!.viewport,{x:-123,y:456,zoom:3})
 assert.throws(()=>session.setViewport({x:NaN,y:0,zoom:1}),/viewport|camera|finite|coordinate/i)
})
test('infinite shapes, arrows, quote/map/image imports and fitting text follow the current camera',async()=>{
 const {session}=await fixture(),shape=session.addShape('rectangle'),arrow=session.addArrow()
 assert.equal(session.activePage!.diagram.shapes[0].x,-4980)
 session.beginDiagram(shape,{x:0,y:0},'move');session.diagramTo({x:300000,y:-300000});session.finish();assert.equal(session.activePage!.diagram.shapes[0].x,295020)
 session.beginDiagram(arrow,{x:0,y:0},'move');session.diagramTo({x:-10000,y:50000});session.finish();assert.equal(session.activePage!.diagram.arrows[0].start.x,-14970)
 await session.importHighlight('h');await session.importMindMap();await session.captureImage({page:1,rect:{x:.1,y:.1,width:.2,height:.2},bytes:new Uint8Array([1])})
 for(const object of session.activePage!.objects){assert.ok('x' in object);if('x' in object){assert.equal(object.x,-4988);assert.equal(object.y,8012)}}
 const text=session.addText();session.updateObject(text,{y:50000,height:40});session.editText(text,'line\n'.repeat(30));session.finish();session.fitText(text);assert.ok((session.activePage!.objects.at(-1) as {height:number}).height>40)
})
test('viewport transform, anchor zoom and fitting negative content have hand checked geometry',()=>{
 const viewport={x:-500,y:250,zoom:2}
 assert.deepEqual(geometry.worldToViewport({x:-450,y:300},viewport),{x:100,y:100})
 assert.deepEqual(geometry.viewportToWorld({x:100,y:100},viewport),{x:-450,y:300})
 assert.deepEqual(geometry.zoomNotebookViewport(viewport,{x:100,y:100},4),{x:-475,y:275,zoom:4})
 assert.deepEqual(geometry.fitNotebookBounds({x:-100,y:-200,width:200,height:100},{width:400,height:300},0),{x:-100,y:-225,zoom:2})
 assert.deepEqual(geometry.notebookViewportRegion(viewport,{width:800,height:600}),{x:-500,y:250,width:400,height:300})
})
test('content bounds include negative stroke radius and arrow wings; culling retains a selected offscreen editor',()=>{
 const p=page();p.objects=[{id:'stroke',type:'stroke',points:[{x:-100,y:-100},{x:-50,y:-50}],color:'#334155',strokeWidth:20},{id:'offscreen',type:'text',x:50000,y:50000,width:400,height:220,text:'',fontSize:24,color:'#334155'}]
 p.diagram.arrows=[{id:'arrow',start:{x:0,y:0},end:{x:100,y:0},color:'#334155',lineWidth:10}]
 assert.deepEqual(geometry.notebookItemBounds(p,p.objects[0]),{x:-110,y:-110,width:70,height:70})
 const bounds=geometry.notebookItemBounds(p,p.diagram.arrows[0])!;assert.equal(bounds.x,-5);assert.equal(bounds.width,110);assert.ok(bounds.y< -5);assert.ok(bounds.height>10)
 assert.deepEqual(geometry.notebookSelectionBounds(p,'stroke',0),{x:-110,y:-110,width:70,height:70})
 const visible=geometry.cullNotebookItems(p,{x:-120,y:-120,width:250,height:250},'offscreen');assert.deepEqual(visible.objects.map(o=>o.id),['stroke','offscreen']);assert.equal(visible.diagram.arrows.length,1)
 assert.deepEqual(geometry.notebookContentBounds(page()),{x:0,y:0,width:1000,height:1200})
})

test('all bounds preserve visible radius beyond the world guard so export cannot silently crop it',()=>{
 const p=page();p.objects=[{id:'edge',type:'stroke',points:[{x:10000000,y:0},{x:10000000,y:1}],strokeWidth:20,color:'#334155'}]
 const bounds=geometry.notebookContentBounds(p);assert.equal(bounds.x+bounds.width,10000010)
})
test('region export commits and saves text, binds the board throughout raster and blocks edits until it settles',async()=>{
 let resolve!:(value:Uint8Array[])=>void;const pending=new Promise<Uint8Array[]>(done=>{resolve=done});let rasterPage:NotebookPage|null=null
 const {session,saves}=await fixture(async(_id,page,options)=>{rasterPage=page;assert.equal(options.scope,'all');assert.deepEqual(options.region,{x:-4984,y:8016,width:448,height:268});return pending})
 const id=session.addText(),release=session.registerEditorCommit(()=>session.editText(id,'Visible IME'))
 const exporting=session.exportRegion({format:'png',scope:'all',region:{x:0,y:0,width:1,height:1}})
 await new Promise(done=>setTimeout(done,0));assert.equal(session.busy,true);assert.equal((rasterPage!.objects[0] as {text:string}).text,'Visible IME');assert.equal((saves.at(-1)!.pages[0].objects[0] as {text:string}).text,'Visible IME')
 assert.throws(()=>session.addText(),/export|wait/i);assert.throws(()=>session.setViewport({x:0,y:0,zoom:1}),/export|wait/i)
 release();resolve([new Uint8Array([1])]);assert.deepEqual(await exporting,[new Uint8Array([1])]);assert.equal(session.busy,false)
})
test('region export refuses old raster completion after a paper switch and releases busy state',async()=>{
 let resolve!:(value:Uint8Array[])=>void;const pending=new Promise<Uint8Array[]>(done=>{resolve=done}),{session}=await fixture(async()=>pending)
 const result=session.exportRegion({format:'png',scope:'viewport',region:{x:0,y:0,width:100,height:100}}).then(()=>null,error=>error)
 await new Promise(done=>setTimeout(done,0));await session.open(null);resolve([new Uint8Array([1])]);const error=await result;assert.ok(error instanceof Error);assert.match(error.message,/changed|cancel/i);assert.equal(session.busy,false)
})

test('infinite eraser uses its visible screen radius while retaining far negative world strokes for undo',async()=>{
 const {session}=await fixture();session.setStrokeWidth(4);session.setViewport({x:-5000,y:-5000,zoom:4});session.beginStroke({x:-4000,y:-4000});session.strokeTo({x:-3900,y:-4000});session.finish()
 session.beginErase({x:-3950,y:-3990});session.finish();assert.equal(session.activePage!.objects.length,1)
 session.beginErase({x:-3950,y:-3996});session.finish();assert.equal(session.activePage!.objects.length,0);session.undo();assert.equal(session.activePage!.objects.length,1)
})

test('Fit all contains distant negative and positive content inside the viewport padding',()=>{
 const bounds={x:-500000,y:-500000,width:1000000,height:1000000},size={width:1200,height:400},viewport=geometry.fitNotebookBounds(bounds,size)
 const first=geometry.worldToViewport({x:bounds.x,y:bounds.y},viewport),last=geometry.worldToViewport({x:bounds.x+bounds.width,y:bounds.y+bounds.height},viewport)
 assert.equal(viewport.zoom,.000304);assert.ok(first.x>=48-.000001&&first.y>=48-.000001);assert.ok(last.x<=1152+.000001&&last.y<=352+.000001)
})
test('overview zoom persists at one millionth scale without adding an undo step',async()=>{
 const {session,saves}=await fixture(),id=session.addText();session.setViewport({x:-500000,y:-500000,zoom:.000001});await session.flush();assert.equal(saves.at(-1)!.pages[0].viewport!.zoom,.000001)
 session.undo();assert.equal(session.activePage!.objects.length,0);assert.equal(session.viewport.zoom,.000001);session.redo();assert.equal(session.activePage!.objects[0].id,id);assert.equal(session.viewport.zoom,.000001)
 const zoomed=geometry.zoomNotebookViewport({x:0,y:0,zoom:1},{x:0,y:0},.000001);assert.deepEqual(zoomed,{x:0,y:0,zoom:.000001})
 assert.throws(()=>session.setViewport({x:0,y:0,zoom:.0000001}),/viewport/i)
})
