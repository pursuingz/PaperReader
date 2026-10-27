import test from 'node:test'
import assert from 'node:assert/strict'
import type { PaperSourceEntry, SummaryEvidenceCapture, SummaryEvidenceManifest } from '../../shared/types'
import { AutomaticEvidenceSession, matchingEvidenceCrop, renderEvidenceCapture, type EvidenceDocument, type EvidencePageResult } from './automaticEvidenceSession'
const entry:PaperSourceEntry={id:'source-1',kind:'figure',label:'Figure 1',text:'Figure 1. Caption.',pages:[1]}
const empty=(id='paper-1'):SummaryEvidenceManifest=>({paperId:id,version:1,crops:[]})
const rect={x:.1,y:.2,width:.4,height:.3}
const result:EvidencePageResult={entry,detection:{rect,confidence:.9,status:'ready'},bytes:new Uint8Array([1,2])}
const wait=()=>{let resolve!:(value:any)=>void;const promise=new Promise<any>(r=>resolve=r);return{promise,resolve}}
function fixture(){let destroyed=0,cleaned=0;const saves:Array<{id:string;c:SummaryEvidenceCapture}>=[]
 const page={cleanup(){cleaned++}} as any,doc:EvidenceDocument={numPages:2,getPage:async()=>page};let saved=empty()
 const api={readPaper:async()=>new Uint8Array([9]),loadSummaryEvidence:async()=>saved,saveSummaryEvidenceCapture:async(id:string,c:SummaryEvidenceCapture)=>{saves.push({id,c});const{bytes,...metadata}=c;saved={...saved,crops:[...saved.crops.filter(x=>x.entryId!==c.entryId),{...metadata,assetId:'asset-1'}]};return saved}}
 const task=()=>({promise:Promise.resolve(doc),destroy:async()=>{destroyed++}})
 return{api,task,saves,counts:()=>({destroyed,cleaned}),setSaved:(m:SummaryEvidenceManifest)=>saved=m}
}
test('automatic session owns independent task and preserves crop metadata, original identity and cleanup',async()=>{
 const f=fixture(),s=new AutomaticEvidenceSession(f.api,f.task,{processPage:async()=>[result]});const m=await s.run('paper-1',[entry]);assert.equal(m?.crops.length,1);assert.equal(f.saves[0].id,'paper-1');assert.deepEqual(f.saves[0].c.rect,rect);assert.deepEqual(f.counts(),{destroyed:1,cleaned:1});assert.equal(s.issues.size,0)
})
test('missing/ambiguous geometry has an explicit issue and never saves a whole-page placeholder',async()=>{
 const f=fixture(),s=new AutomaticEvidenceSession(f.api,f.task,{processPage:async()=>[{entry,detection:{rect:null,confidence:0,status:'needs-review',reason:'Missing caption anchor.'}}]});assert.deepEqual(await s.run('paper-1',[entry]),empty());assert.equal(f.saves.length,0);assert.match(s.issues.get(entry.id)??'',/Missing caption/)
})
test('saved manual crops remain byte/asset stable and are skipped without opening PDF',async()=>{
 const f=fixture();f.setSaved({paperId:'paper-1',version:1,crops:[{entryId:entry.id,kind:'figure',caption:entry.text,label:'Legacy label',page:1,rect,assetId:'old-1',method:'manual',confidence:1,status:'ready'}]})
 const s=new AutomaticEvidenceSession(f.api,()=>{throw Error('Should not open PDF')});const m=await s.run('paper-1',[entry]);assert.equal(m?.crops[0].assetId,'old-1');assert.equal(f.saves.length,0);assert.ok(matchingEvidenceCrop(m,entry))
})
test('cancellation before PDF read resolves cannot construct or save a stale document',async()=>{
 const f=fixture(),read=wait();f.api.readPaper=()=>read.promise;const s=new AutomaticEvidenceSession(f.api,()=>{throw Error('late task must not start')},{processPage:async()=>[result]});const p=s.run('paper-1',[entry]);await s.cancel();read.resolve(new Uint8Array([1]));assert.equal(await p,null);assert.equal(f.saves.length,0)
})
test('cancellation while raster is pending discards result and destroys owned task exactly once',async()=>{
 const f=fixture(),render=wait(),entered=wait(),s=new AutomaticEvidenceSession(f.api,f.task,{processPage:async()=>{entered.resolve(true);return render.promise}})
 const p=s.run('paper-1',[entry]);await entered.promise;await s.cancel();render.resolve([result]);assert.equal(await p,null);assert.equal(f.saves.length,0);assert.deepEqual(f.counts(),{destroyed:1,cleaned:1})
})
test('failed manifest load and invalid cross-paper responses never become editable empty data',async()=>{
 const f=fixture();f.api.loadSummaryEvidence=async()=>{throw Error('Damaged manifest')};const s=new AutomaticEvidenceSession(f.api,f.task,{processPage:async()=>[result]});await assert.rejects(s.run('paper-1',[entry]),/Damaged/);assert.equal(f.saves.length,0)
 f.api.loadSummaryEvidence=async()=>empty('paper-2');await assert.rejects(s.run('paper-1',[entry]),/ownership/)
})

test('explicit automatic refresh reanalyses saved automatic crops while preserving saved manual crops',async()=>{
 const f=fixture(),table:PaperSourceEntry={...entry,id:'source-2',kind:'table',label:'Table 1',text:'Table 1. Caption.'}
 const manual={entryId:entry.id,kind:'figure' as const,caption:entry.text,label:entry.label,page:1,rect,assetId:'manual-1',method:'manual' as const,confidence:1,status:'ready' as const}
 const automatic={entryId:table.id,kind:'table' as const,caption:table.text,label:table.label,page:1,rect,assetId:'automatic-1',method:'automatic' as const,algorithmVersion:2 as const,confidence:.6,status:'needs-review' as const,reason:'Old uncertainty'}
 f.setSaved({paperId:'paper-1',version:1,crops:[manual,automatic]});let processed=0
 const s=new AutomaticEvidenceSession(f.api,f.task,{processPage:async(_p,entries)=>{processed++;assert.deepEqual(entries,[table]);return[{...result,entry:table}]}})
 await s.run('paper-1',[entry,table]);assert.equal(processed,0)
 const m=await s.run('paper-1',[entry,table],undefined,{refreshAutomatic:true});assert.equal(processed,1);assert.deepEqual(m?.crops.find(c=>c.entryId===entry.id),manual);assert.equal(f.saves.length,1);assert.equal(f.saves[0].c.entryId,table.id)
})

test('source pixel capture covers fractional edges with a bounded target and reports renderer transform',async()=>{
 const draws:Array<any>=[];let canvas:any
 const page={getViewport:({scale}:{scale:number})=>({width:8000*scale,height:8000*scale}),render:(args:any)=>{draws.push({...args,width:canvas.width,height:canvas.height});return{promise:Promise.resolve(),cancel(){}}}} as any
 const create=():HTMLCanvasElement=>{canvas={width:0,height:0,getContext:()=>({}),toBlob:(callback:(b:Blob)=>void)=>callback(new Blob([new Uint8Array([1,2,3])]))};return canvas}
 const result=await renderEvidenceCapture(page,{x:.11111,y:.12345,width:.8,height:.8},()=>true,()=>{},create)
 assert.deepEqual(result,new Uint8Array([1,2,3]));assert.equal(draws.length,1);const d=draws[0]
 assert.ok(d.width<=4096&&d.height<=4096&&d.width*d.height<=16000000)
 assert.equal(d.transform[4],-Math.floor(d.viewport.width*.11111));assert.equal(d.transform[5],-Math.floor(d.viewport.height*.12345))
 assert.equal(d.width,Math.ceil(d.viewport.width*(.11111+.8))+d.transform[4]);assert.equal(canvas.width,0)
})
test('source pixel capture cancellation avoids PNG encoding and releases its canvas',async()=>{
 let active=true,encoded=0,canvas:any
 const page={getViewport:({scale}:{scale:number})=>({width:600*scale,height:800*scale}),render:()=>({promise:Promise.resolve().then(()=>{active=false}),cancel(){}})} as any
 const create=():HTMLCanvasElement=>{canvas={width:0,height:0,getContext:()=>({}),toBlob:()=>{encoded++}};return canvas}
 assert.equal(await renderEvidenceCapture(page,rect,()=>active,()=>{},create),undefined);assert.equal(encoded,0);assert.equal(canvas.width,0)
})

test('old automatic algorithm crops are refreshed locally without explicit refresh while manual aliases survive shrinking captions',async()=>{
 const f=fixture();f.setSaved({paperId:'paper-1',version:1,crops:[{entryId:entry.id,kind:'figure',caption:entry.text,label:entry.label,page:1,rect,assetId:'old-auto',method:'automatic',confidence:.9,status:'ready'}]})
 const s=new AutomaticEvidenceSession(f.api,f.task,{processPage:async()=>[result]})
 await s.run('paper-1',[entry]);assert.equal(f.saves.length,1);assert.equal(f.saves[0].c.algorithmVersion,2)
 const short={...entry,id:'source-new',text:'Figure 1. A sufficiently detailed original caption.'}
 const manual={entryId:'source-old',kind:'figure' as const,caption:short.text+' Body text accidentally appended.',label:'Fig. 1',page:1,rect,assetId:'manual-1',method:'manual' as const,confidence:1,status:'ready' as const}
 const manifest={paperId:'paper-1',version:1 as const,crops:[manual]};f.setSaved(manifest)
 assert.equal(matchingEvidenceCrop(manifest,short)?.assetId,'manual-1')
 const protectedSession=new AutomaticEvidenceSession(f.api,()=>{throw Error('Manual pixels must not be reanalysed')})
 assert.deepEqual(await protectedSession.run('paper-1',[short]),manifest)
})
test('ambiguous canonical manual matches remain protected without automatic remapping or replacement',async()=>{
 const f=fixture(),manual={entryId:'old-1',kind:'figure' as const,caption:entry.text+' An earlier body.',label:entry.label,page:1,rect,assetId:'manual-1',method:'manual' as const,confidence:1,status:'ready' as const}
 const manifest={paperId:'paper-1',version:1 as const,crops:[manual,{...manual,entryId:'old-2',assetId:'manual-2'}]};f.setSaved(manifest)
 assert.equal(matchingEvidenceCrop(manifest,entry),null)
 const s=new AutomaticEvidenceSession(f.api,()=>{throw Error('Ambiguous manual data is protected')});await s.run('paper-1',[entry]);assert.match(s.issues.get(entry.id)??'',/manual/)
})
test('analysis and capture render tasks explicitly disable PDF annotations',async()=>{
 const draws:any[]=[],canvas:any={width:0,height:0,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray(1800*1350*4)})}),toBlob:(callback:(b:Blob)=>void)=>callback(new Blob([new Uint8Array([1])]))}
 const page={getViewport:({scale}:{scale:number})=>({width:600*scale,height:800*scale,transform:[scale,0,0,-scale,0,800*scale]}),render:(args:any)=>{draws.push(args);return{promise:Promise.resolve(),cancel(){}}},getTextContent:async()=>({items:[]})} as any
 const {processEvidencePage}=await import('./automaticEvidenceSession')
 await processEvidencePage(page,[],()=>true,()=>{},()=>canvas)
 await renderEvidenceCapture(page,rect,()=>true,()=>{},()=>canvas)
 assert.deepEqual(draws.map(d=>d.annotationMode),[0,0])
})

test('one legacy manual crop cannot be silently attached to two ambiguous rebuilt source entries',async()=>{
 const f=fixture(),caption='Figure 1. A sufficiently detailed original caption.'
 f.setSaved({paperId:'paper-1',version:1,crops:[{entryId:'old-source',kind:'figure',caption,label:'Fig. 1',page:1,rect,assetId:'manual-1',method:'manual',confidence:1,status:'ready'}]})
 const entries=[{...entry,id:'new-one',text:caption},{...entry,id:'new-two',text:caption+' Continued original caption.'}]
 const s=new AutomaticEvidenceSession(f.api,()=>{throw Error('Ambiguous source matches must stay protected')})
 await s.run('paper-1',entries);assert.equal(s.issues.size,2)
})
