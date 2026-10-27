import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSourceEntries, positionedTextLines, extractSourceIndex, reconcileSourceEntries, type SourceLine, type SourceDocument } from './sourceIndex'

const line = (text: string, page = 1, y = 700): SourceLine => ({ text, page, x: 50, y, height: 12 })
const item = (str: string, x = 50, y = 700, width = str.length * 6) => ({ str, transform: [12, 0, 0, 12, x, y], width, height: 12 })

test('positioned fragments reconstruct caption lines and keep separate columns apart', () => {
  const lines = positionedTextLines([item('Figure', 50), item('1.', 92), item('First caption', 112), item('continued here', 50, 684), item('Other column', 330, 700)], 1)
  assert.deepEqual(lines.map(value => value.text), ['Figure 1. First caption', 'continued here', 'Other column'])
})

test('original whitespace survives adjoining PDF text fragments and still identifies a caption', () => {
  const lines = positionedTextLines([item('Figure ', 50, 700, 42), item('1. Original caption', 92)], 1)
  assert.equal(lines[0].text, 'Figure 1. Original caption')
  assert.equal(buildSourceEntries(lines).entries[0].kind, 'figure')
})

test('stable column starts keep narrow gutters from mixing right-column body into a caption', () => {
  const lines = positionedTextLines([
    item('Figure 1. This line reaches the gutter', 50, 700, 245), item('Unrelated right column paragraph.', 313, 700, 250),
    item('Left continuation.', 50, 684, 150), item('Further unrelated right column.', 313, 684, 250)
  ], 1)
  const result = buildSourceEntries(lines)
  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0].text, 'Figure 1. This line reaches the gutter\nLeft continuation.')
})

test('caption candidates retain multiline original text but exclude see-Fig body references', () => {
  const result = buildSourceEntries([line('As shown in Fig. 1, the effect is clear.'), line('Figure 1. Original finding', 1, 660), line('continued with uncertainty.', 1, 644), line('2. Discussion', 1, 600), line('Table 2: Measured results', 2), line('图3：原始结果', 3), line('表 4. 对照实验', 3, 650)])
  assert.deepEqual(result.entries.map(value => [value.kind, value.label, value.text, value.pages]), [
    ['figure', 'Figure 1', 'Figure 1. Original finding\ncontinued with uncertainty.', [1]],
    ['table', 'Table 2', 'Table 2: Measured results', [2]],
    ['figure', '图3', '图3：原始结果', [3]],
    ['table', '表 4', '表 4. 对照实验', [3]]
  ])
  assert.equal(new Set(result.entries.map(value => value.id)).size, 4)
})

test('numbered references retain multiline and cross-page source provenance', () => {
  const result = buildSourceEntries([line('References', 2), line('[1] First author. Original title.', 2, 670), line('Journal 2024.', 2, 654), line('continued publication information.', 3), line('[2] Second author. Another title.', 3, 660), line('Appendix A', 3, 600), line('This is not a bibliography item.', 3, 570)])
  assert.deepEqual(result.entries.map(value => [value.kind, value.text, value.pages]), [
    ['reference', '[1] First author. Original title.\nJournal 2024.\ncontinued publication information.', [2, 3]],
    ['reference', '[2] Second author. Another title.', [3]]
  ])
})

test('unnumbered bibliography remains source-section text instead of invented individual references', () => {
  const result = buildSourceEntries([line('参考文献', 2), line('张三. 原始研究. 2020.', 2, 670), line('Smith, A. Original title. 2022.', 3)])
  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0].kind, 'reference-section')
  assert.equal(result.entries[0].text, '参考文献\n张三. 原始研究. 2020.\nSmith, A. Original title. 2022.')
  assert.deepEqual(result.entries[0].pages, [2, 3])
})

test('source extraction distinguishes readable, textless and failed pages and always cleans pages', async () => {
  const cleaned: number[] = []
  const document: SourceDocument = { numPages: 3, async getPage(page) { if (page === 3) throw new Error('bad page'); return { getTextContent: async () => ({ items: page === 1 ? [item('Fig. 2. Caption')] : [] }), cleanup() { cleaned.push(page) } } } }
  const value = await extractSourceIndex(document, 'paper-1', () => true)
  assert.deepEqual(value.indexedPages, [1]); assert.deepEqual(value.textlessPages, [2]); assert.deepEqual(value.failedPages, [3]); assert.equal(value.limitReached, false)
  assert.deepEqual(value.entries[0].pages, [1]); assert.deepEqual(cleaned, [1, 2])
})

test('page and character limits report unvisited pages without claiming them indexed', async () => {
  let loaded = 0
  const document: SourceDocument = { numPages: 3, async getPage(page) { loaded++; return { getTextContent: async () => ({ items: [item(`Figure ${page}. Caption`)] }) } } }
  const byPages = await extractSourceIndex(document, 'paper-1', () => true, undefined, { maxPages: 1, maxCharacters: 240000 })
  assert.equal(byPages.limitReached, true); assert.deepEqual(byPages.indexedPages, [1]); assert.equal(loaded, 1)
  const byChars = await extractSourceIndex(document, 'paper-1', () => true, undefined, { maxPages: 200, maxCharacters: 3 })
  assert.equal(byChars.limitReached, true); assert.deepEqual(byChars.indexedPages, []); assert.deepEqual(byChars.entries, [])
})

test('entry bounds stop candidate accumulation and disclose truncation', () => {
  const entries = buildSourceEntries(Array.from({ length: 1001 }, (_, i) => line(`Figure ${i + 1}. Caption`, 1, 20000 - i * 20)))
  assert.equal(entries.entries.length, 1000); assert.equal(entries.limitReached, true)
  const long = buildSourceEntries([line('Figure 1. ' + 'x'.repeat(17000))])
  assert.equal(long.entries[0].text.length, 16000); assert.equal(long.limitReached, false); assert.equal(long.issues[0].kind, 'entry-truncated')
})

test('body descriptions beginning with figure numbering are not mistaken for captions', () => {
  const result = buildSourceEntries([line('Figure 1 shows the measurements.'), line('图1显示了实验结果。', 1, 650), line('Fig. 2: Measurement overview', 1, 600)])
  assert.deepEqual(result.entries.map(value => value.label), ['Fig. 2'])
})

test('inconsistent reference numbering falls back to the original section and preserves all included pages', () => {
  const result = buildSourceEntries([line('Bibliography', 1), line('[1] A first source.', 1, 675), line('[7] A broken or incomplete numbering sequence.', 2)])
  assert.equal(result.entries.length, 2); assert.equal(result.entries[0].kind, 'reference')
  assert.equal(result.entries[1].kind, 'reference-section'); assert.deepEqual(result.entries[1].pages, [2]); assert.match(result.entries[1].text, /\[7\]/)
})


test('figures after a bibliography remain caption entries and do not pollute the final citation', () => {
  const lines = [
    {text:'References',page:1,x:50,y:750,height:18},
    {text:'[1] Example. First citation. Journal (2020).',page:1,x:50,y:710,height:11},
    {text:'[2] Author. Last citation. Journal (2021).',page:1,x:50,y:670,height:11},
    {text:'Attention Visualizations',page:2,x:50,y:750,height:18},
    {text:'Input Input Layer 5',page:2,x:50,y:710,height:11},
    {text:'Figure 3: Attention across the input words.',page:2,x:50,y:180,height:11},
    {text:'Figure 4: Another attention pattern.',page:3,x:50,y:180,height:11}
  ]
  const {entries} = buildSourceEntries(lines)
  assert.deepEqual(entries.filter(e=>e.kind==='figure').map(e=>e.label),['Figure 3','Figure 4'])
  const references=entries.filter(e=>e.kind==='reference')
  assert.equal(references.length,2)
  assert.equal(references.at(-1)!.text,'[2] Author. Last citation. Journal (2021).')
  assert.deepEqual(references.at(-1)!.pages,[1])
})


test('a modestly larger unknown heading ends numbered references before visual labels on the next page', () => {
 const result=buildSourceEntries([
  {...line('References',1,750),height:12},
  {...line('[1] Author. First complete citation.',1,710),height:10},
  {...line('[2] Author. Last complete citation.',1,670),height:10},
  {...line('Input-Input Layer5',2,714.75),height:16.3356},
  {...line('Attention Visualizations',2,710.037),height:11.9552},
  {...line('Words and arrows inside the image',2,631),height:7.7788},
  {...line('Figure 3: Original appendix visual.',2,472),height:9.9626}
 ])
 assert.deepEqual(result.entries.map(e=>e.kind),['reference','reference','figure'])
 assert.equal(result.entries[1].text,'[2] Author. Last complete citation.')
 assert.deepEqual(result.entries[1].pages,[1])
})

test('caption boundaries remain visible without a recognized or typographically distinct appendix heading', () => {
 const result=buildSourceEntries([line('References'),line('[1] Original reference.',1,670),line('Figure 3. Original diagram.',2,400),line('Table 4. Original table.',3,400)])
 assert.deepEqual(result.entries.map(e=>[e.kind,e.label]),[['reference','[1]'],['figure','Figure 3'],['table','Table 4']])
 assert.equal(result.entries[0].text,'[1] Original reference.')
})

test('decimal numeric text is not treated as an unbracketed reference index', () => {
 const result=buildSourceEntries([line('References'),line('[1] Original source.',1,670),line('88.3',1,650),line('90.4',1,630),line('[2] Second citation.',2,700)])
 assert.equal(result.entries.length,2)
 assert.deepEqual(result.entries.map(e=>e.label),['[1]','[2]'])
 assert.match(result.entries[0].text,/88\.3\n90\.4/)
})

test('column-ordered table cells physically above References do not enter the bibliography', () => {
 const result=buildSourceEntries([
  {...line('Table 1. Upper results.',1,740),height:10},
  {...line('References',1,450),height:12},
  {...line('[1] First original citation.',1,420),height:10},
  {...line('88.3',1,680),x:420,height:10},
  {...line('90.4',1,660),x:420,height:10},
  {...line('[2] Second original citation.',2,710),height:10}
 ])
 const references=result.entries.filter(e=>e.kind==='reference')
 assert.equal(references.length,2)
 assert.equal(references[0].text,'[1] First original citation.')
 assert.equal(result.entries[0].id,'source-1')
})

test('explicit references and their continuation in the next column survive above the first-column heading', () => {
 const result=buildSourceEntries([
  {...line('References',1,450),height:12},
  {...line('[1] First original citation.',1,420),height:10},
  {...line('[2] Citation in right column.',1,710),x:330,height:10},
  {...line('Continuation in that right column.',1,694),x:351,height:10},
  {...line('[3] Next page source.',2,710),height:10}
 ])
 const references=result.entries.filter(e=>e.kind==='reference')
 assert.equal(references.length,3)
 assert.equal(references[1].text,'[2] Citation in right column.\nContinuation in that right column.')
})

test('unnumbered bibliography retains differently sized publication lines without a later figure section', () => {
 const result=buildSourceEntries([
  {...line('Bibliography',1,750),height:16},
  {...line('Smith, A. Original publication. 2020.',1,710),height:10},
  {...line('Journal of Original Research',2,710),height:12},
  {...line('Author, B. Another publication. 2021.',2,680),height:10}
 ])
 assert.equal(result.entries.length,1)
 assert.equal(result.entries[0].kind,'reference-section')
 assert.match(result.entries[0].text,/Journal of Original Research\nAuthor, B/)
})


test('caption fragments remain independent from neighbouring prose and appendix headings', () => {
 const lines=positionedTextLines([
  item('Neighbour prose continues here',50,700,145),item('Figure 2: Independent caption.',208,700,280),
  item('More neighbour prose',50,684,145),item('continued original caption.',208,684,220),
  item('E.6 Additional results',50,600,145),item('Figure 16: Independent appendix caption.',208,600,280)
 ],1)
 const entries=buildSourceEntries(lines).entries
 assert.deepEqual(entries.map(e=>e.label),['Figure 2','Figure 16'])
 assert.equal(entries[0].text,'Figure 2: Independent caption.\ncontinued original caption.')
})
test('subfigure body mentions and prose following a smaller caption are excluded', () => {
 const entries=buildSourceEntries([
  line('Fig. 1 (b) shows another object.'),
  {...line('Figure 1: Original result.',1,640),height:10},
  {...line('Caption continuation.',1,629),height:10},
  {...line('The body begins a distinct paragraph here.',1,612),height:12}
 ]).entries
 assert.equal(entries.length,1)
 assert.equal(entries[0].text,'Figure 1: Original result.\nCaption continuation.')
})
test('bracketed references stop at supplementary and alphabetic headings and omit geometric footers', () => {
 const lines=[line('References',11),...Array.from({length:53},(_,i)=>line(`[${i+1}] A. Author. Original source ${i+1}. Journal.`,11+Math.floor(i/20),700-(i%20)*20)),
  {...line('13',13,42),x:300},line('- Supplementary -',14),line('A Derivation',14,670),line('18. After organising terms.',16)]
 const result=buildSourceEntries(lines)
 assert.equal(result.entries.filter(e=>e.kind==='reference').length,53)
 assert.equal(result.entries.at(-1)?.label,'[53]')
 assert.doesNotMatch(result.entries.at(-1)!.text,/Supplementary|Derivation|organising|\n13$/)
 assert.equal(result.limitReached,false)
})
test('a local numbering gap retains reliable references and isolates uncertainty as source text', () => {
 const entries=buildSourceEntries([line('References'),line('[1] First source.',1,675),line('[7] Uncertain source.',1,650),line('[8] Next source.',1,625)]).entries
 assert.equal(entries[0].kind,'reference')
 assert.equal(entries[0].label,'[1]')
 assert.ok(entries.some(e=>e.kind==='reference-section'&&e.text.includes('[7]')))
})
test('version two distinguishes entry truncation from scan coverage', async () => {
 const result=await extractSourceIndex({numPages:1,getPage:async()=>({getTextContent:async()=>({items:[item('Figure 1: '+ 'x'.repeat(17000))]})})},'paper-1',()=>true)
 assert.equal(result.extractorVersion,2)
 assert.equal(result.limitReached,false)
 assert.deepEqual(result.issues,[{kind:'entry-truncated',entryId:result.entries[0].id}])
})

test('a mathematical plain-number step cannot continue a bracketed bibliography',()=>{
 const entries=buildSourceEntries([line('References'),line('[1] Original source.',1,670),line('18. After rearranging the equation.',2,700)]).entries
 assert.equal(entries.length,1);assert.doesNotMatch(entries[0].text,/rearranging/)
})

test('sentence-ending figure mentions do not become captions when the real colon caption exists',()=>{
 const entries=buildSourceEntries([line('Figure 12. Rendering this image takes several seconds.'),line('Figure 12: Rendered comparison.',2,640)]).entries
 assert.equal(entries.length,1);assert.deepEqual(entries[0].pages,[2])
})

test('source identity reconciliation retains reliable old IDs and avoids collisions or ambiguous matches',async()=>{
 const document={numPages:1,getPage:async()=>({getTextContent:async()=>({items:[item('Figure 1: A sufficiently detailed original caption.')]})})}
 const fresh=await extractSourceIndex(document,'paper-1',()=>true)
 const old={...fresh,entries:[{...fresh.entries[0],id:'source-9',text:fresh.entries[0].text+' Accidentally included body.'}]}
 assert.equal(reconcileSourceEntries(fresh,old).entries[0].id,'source-9')
 const ambiguous={...old,entries:[...old.entries,{...old.entries[0],id:'source-10'}]}
 assert.notEqual(reconcileSourceEntries(fresh,ambiguous).entries[0].id,'source-9')
 const added={...fresh,entries:[{...fresh.entries[0],label:'Figure 2',text:'Figure 2: New caption.'},fresh.entries[0]]}
 const reconciled=reconcileSourceEntries(added,{...old,entries:[{...old.entries[0],id:'source-1'}]})
 assert.equal(reconciled.entries[1].id,'source-1');assert.notEqual(reconciled.entries[0].id,'source-1')
})

test('aggregate character exhaustion is a scan issue even when the final candidate is partially retained',()=>{
 const result=buildSourceEntries(Array.from({length:16},(_,i)=>line(`Figure ${i+1}: `+'x'.repeat(15000),1,20000-i*20)))
 assert.equal(result.limitReached,true)
 assert.ok(result.issues.some(i=>i.kind==='character-limit'))
 assert.ok(result.issues.some(i=>i.kind==='entry-truncated'))
})
test('a low isolated page number is removed while same-baseline table values remain source content',()=>{
 const lines=[line('References',13,700),line('[1] Original.',13,680),{...line('13',13,42),x:300},{...line('Score',13,42),x:50}]
 const entries=buildSourceEntries(lines).entries
 assert.match(entries[0].text,/13/)
})

test('a same-font alphabetic reference title continues its citation and cannot discard later references',()=>{
 const at=(text:string,y:number)=>({...line(text,1,y),height:10})
 const result=buildSourceEntries([at('References',750),at('[1] Alice. First title.',720),at('[2] Ben. Author.',690),at('A Unified Framework for Image Reconstruction',675),at('Journal of Tests. 2024.',660),at('[3] Cara. Third title.',630)])
 assert.equal(result.entries.length,3);assert.equal(result.entries[2].label,'[3]')
 assert.match(result.entries[1].text,/A Unified Framework/);assert.match(result.entries[1].text,/Journal of Tests/)
 assert.equal(result.limitReached,false);assert.deepEqual(result.issues,[])
})
test('a typographically distinct alphabetic appendix heading ends references without a supplementary marker',()=>{
 const result=buildSourceEntries([{...line('References',1,750),height:12},{...line('[1] Author. Original title.',1,710),height:10},{...line('A Derivation',2,750),height:12},{...line('Proof of the mathematical result.',2,720),height:10}])
 assert.equal(result.entries.length,1);assert.equal(result.entries[0].text,'[1] Author. Original title.')
})
