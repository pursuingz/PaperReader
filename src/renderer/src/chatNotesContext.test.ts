import test from 'node:test'
import assert from 'node:assert/strict'
import { buildChatNotesSnapshot, resolveChatNotesPages, chatNotesVisualTiles, type ChatNotesInput } from './chatNotesContext'
import { DEFAULT_CHAT_NOTES_SELECTION, type CanvasNotebook, type NotebookPage } from '../../shared/types'
const pid='11111111-1111-4111-8111-111111111111'
function board(id='a'):NotebookPage{return {id,name:'Board '+id,width:1000,height:1200,objects:[],diagram:{version:1,paperId:pid,shapes:[],arrows:[],connections:[]}}}
const a=board(),b=board('b'),book:CanvasNotebook={version:1,surface:'infinite',paperId:pid,activePageId:'b',pages:[a,b]}
const selection=()=>structuredClone(DEFAULT_CHAT_NOTES_SELECTION)
const emptyInput=():ChatNotesInput=>({paperId:pid,note:'## My text\nA retained idea.',marks:{highlights:[],strokes:[]},mindMap:{version:1 as const,paperId:pid,nodes:[]},notebook:structuredClone(book),selection:selection()})
test('Canvas source choice binds current, selected or all boards and rejects stale/empty selection',()=>{
 assert.deepEqual(resolveChatNotesPages(book,selection()).map(p=>p.id),['b'])
 assert.deepEqual(resolveChatNotesPages(book,{...selection(),canvasScope:'all'}).map(p=>p.id),['a','b'])
 assert.deepEqual(resolveChatNotesPages(book,{...selection(),canvasScope:'selected',canvasPageIds:['a']}).map(p=>p.id),['a'])
 assert.throws(()=>resolveChatNotesPages(book,{...selection(),canvasScope:'selected',canvasPageIds:['missing']}),/selected|available/i)
 assert.throws(()=>resolveChatNotesPages(book,{...selection(),canvasScope:'selected',canvasPageIds:[]}),/select/i)
})
test('Notes snapshot preserves highlight comments/source, map tree and Canvas text/geometry without including unselected boards',async()=>{
 const input=emptyInput();input.marks.highlights.push({id:'h',page:2,quote:'Source quote',comment:'My doubt',color:'yellow',createdAt:'2026-10-27',rects:[]} as never)
 input.mindMap.nodes.push({id:'root',parentId:null,text:'Question root',order:0} as never)
 input.notebook.pages[1].objects.push({id:'text',type:'text',text:'Canvas thought',x:-450,y:-600,width:300,height:150,fontSize:20,color:'#334155'})
 const result=await buildChatNotesSnapshot(input,async()=>{throw Error('Text-only board must not raster')},()=>true)
 assert.equal(result.text,input.note);assert.equal(result.highlights?.[0].comment,'My doubt');assert.equal(result.mindMap?.nodes[0].text,'Question root');assert.match(result.canvas?.[0].content||'',/Canvas thought/);assert.match(result.canvas?.[0].content||'',/-450/);assert.deepEqual(result.coverage.canvasPageIds,['b']);assert.deepEqual(result.images,[])
 input.note='Changed';assert.notEqual(result.text,input.note)
})
test('Visual tile planning stays sparse at far negative coordinates and rejects a huge stroke before allocation',()=>{
 const page=board();page.objects.push({id:'im1',type:'image',assetId:'x',x:-8000,y:-7000,width:300,height:250},{id:'im2',type:'image',assetId:'y',x:8000,y:7000,width:300,height:250})
 const tiles=chatNotesVisualTiles(page,8);assert.ok(tiles.length<=4);assert.ok(tiles.some(t=>t.x<0));assert.ok(tiles.every(t=>t.width<=1600&&t.height<=1600))
 page.objects.push({id:'long',type:'stroke',color:'#334155',strokeWidth:4,points:[{x:-9000000,y:0},{x:9000000,y:0}]});assert.throws(()=>chatNotesVisualTiles(page,8),/too large|images|scope|tiles/i)
})
test('Oversized selected text is rejected before image capture and stale visual results cannot enter a snapshot',async()=>{
 const input=emptyInput();input.note='a'.repeat(100001);let calls=0
 await assert.rejects(buildChatNotesSnapshot(input,async()=>{calls++;throw Error('not reached')},()=>true),/100,000|100000/);assert.equal(calls,0)
 const other=emptyInput();other.notebook.pages[1].objects.push({id:'im',type:'image',assetId:'x',x:0,y:0,width:100,height:100});let current=true
 await assert.rejects(buildChatNotesSnapshot(other,async(page,region)=>{current=false;return {imageId:'img',sha256:'a'.repeat(64),mimeType:'image/png',width:1600,height:1600,byteLength:20,origin:{kind:'canvas',pageId:page.id,pageName:page.name,region}}},()=>current),/changed|cancel/i)
})

import {createQuestionSnapshot} from './readingWorkflow'
const image={imageId:'img',sha256:'a'.repeat(64),mimeType:'image/png' as const,width:100,height:100,byteLength:20,origin:{kind:'pdf-capture' as const,page:1,rect:{x:0,y:0,width:.5,height:.5}}}
const questionInput=()=>({requestId:'r',paper:{id:pid,title:'Source',fileName:'p.pdf',category:'Imported',importedAt:'2026-10-27'},state:{note:'Text for organization',messages:[],lastPage:1},question:'Explain image',mode:'page' as const,pageText:'',selection:'',attachments:[structuredClone(image)]})
test('Image-only question snapshots preserve attachment bytes identity and organization ignores all Chat-only sources',()=>{
 const input=questionInput(),snapshot=createQuestionSnapshot(input);input.attachments[0].origin.page=4;assert.equal(snapshot.attachments?.[0].origin.kind==='pdf-capture'&&snapshot.attachments[0].origin.page,1)
 const bundle={version:1 as const,selection:selection(),text:'Different Chat Text',images:[],coverage:{canvasPageIds:[],imageCount:0}}
 const organized=createQuestionSnapshot({...questionInput(),action:'organize-notes',notesSnapshot:bundle});assert.equal(organized.context.note,'Text for organization');assert.equal(organized.context.notesSnapshot,undefined);assert.equal(organized.attachments,undefined);assert.deepEqual(organized.history,[])
})
test('Unselected Text never leaks into a Chat Notes snapshot and resolved Canvas IDs are frozen',async()=>{
 const input=emptyInput();input.selection.text=false;input.notebook.pages[1].objects.push({id:'t',type:'text',text:'Only Canvas',x:0,y:0,width:200,height:120,fontSize:20,color:'#334155'})
 const bundle=await buildChatNotesSnapshot(input,async()=>{throw Error('no visual')},()=>true)
 assert.deepEqual(bundle.selection.canvasPageIds,['b'])
 const request=createQuestionSnapshot({...questionInput(),mode:'notes',attachments:[],notesSnapshot:bundle});assert.equal(request.context.note,undefined);assert.equal(request.context.notesSnapshot?.text,undefined);assert.match(request.context.notesSnapshot?.canvas?.[0].content||'',/Only Canvas/)
})
