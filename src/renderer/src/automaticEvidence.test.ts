import test from 'node:test'
import assert from 'node:assert/strict'
import { detectEvidenceCrop, projectEvidenceText, type EvidencePage, type EvidenceText } from './automaticEvidence'
import type { PaperSourceEntry } from '../../shared/types'
const entry=(kind:'figure'|'table'='figure'):PaperSourceEntry=>({id:'source-1',kind,label:kind==='figure'?'Figure 1':'Table 1',text:kind==='figure'?'Figure 1. Test plot.':'Table 1. Test values.',pages:[1]})
function fixture(width=600,height=800){const data=new Uint8ClampedArray(width*height*4);data.fill(255);const text:EvidenceText[]=[]
 const box=(x:number,y:number,w:number,h:number)=>{for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++){const i=(row*width+col)*4;data[i]=data[i+1]=data[i+2]=0}}
 const add=(str:string,x:number,y:number,w:number,h=12)=>{text.push({text:str,x,y,width:w,height:h});box(x,y,w,h)}
 return {page:{width,height,data,text} as EvidencePage,box,add}}
function bounds(result:ReturnType<typeof detectEvidenceCrop>,page:EvidencePage){assert.ok(result.rect);return {x:result.rect.x*page.width,y:result.rect.y*page.height,w:result.rect.width*page.width,h:result.rect.height*page.height}}
test('automatic figure bounds include multipanel graphics and labels, excluding caption and nearby body text',()=>{
 const {page,box,add}=fixture();box(80,180,160,140);box(280,180,160,140);add('panel A',90,330,70);add('panel B',290,330,70);add('Figure 1. Test plot.',80,365,360)
 add('This is body text with many words below the figure caption.',60,410,480);add('The second prose row should never enter the original image.',60,428,480)
 const r=detectEvidenceCrop(page,entry()),b=bounds(r,page);assert.equal(r.status,'ready');assert.ok(b.x>=72&&b.x<=80);assert.ok(b.y>=172&&b.y<=180);assert.ok(b.w>=360&&b.w<390);assert.ok(b.y+b.h>=342&&b.y+b.h<355)
})
test('column-aware figure crops do not merge a neighbouring figure or body column',()=>{
 const {page,box,add}=fixture();box(45,130,220,200);box(335,130,220,200);add('Figure 1. Test plot.',45,350,220);add('Figure 2. Other plot.',335,350,220)
 for(let i=0;i<3;i++){add('Many words are placed in the left paragraph here.',45,410+i*18,220);add('Many words are placed in the right paragraph here.',335,410+i*18,220)}
 const r=detectEvidenceCrop(page,entry()),b=bounds(r,page);assert.equal(r.status,'ready');assert.ok(b.x>=37&&b.x+b.w<300)
})
test('table pixel bounds cover bordered and borderless cells, above or below caption without body prose',()=>{
 for(const border of [false,true])for(const above of [false,true]){
  const {page,box,add}=fixture();const caption=above?100:310;add('Table 1. Test values.',70,caption,380)
  for(let r=0;r<4;r++){add(r?'Model '+r:'Method',80,160+r*32,100);add(r?String(90+r):'Score',260,160+r*32,60);add(r?'0.00'+r:'Time',410,160+r*32,60)}
  if(border){box(70,150,410,1);box(70,280,410,1);box(70,150,1,130);box(479,150,1,130)}
  add('This paragraph has many words and is not part of the source table.',70,365,450);add('Another paragraph sentence with enough words to form prose.',70,385,450)
  const r=detectEvidenceCrop(page,entry('table')),b=bounds(r,page);assert.equal(r.status,'ready',`${border}/${above}: ${r.reason}`);assert.ok(b.y>=140&&b.y<165);assert.ok(b.y+b.h>=268&&b.y+b.h<295)
 }
})
test('blank pages, missing caption anchors and symmetric ambiguous candidates never claim a precise crop',()=>{
 const f=fixture();assert.equal(detectEvidenceCrop(f.page,entry()).rect,null)
 f.add('Figure 1. Test plot.',80,390,400);f.box(80,180,400,150);f.box(80,460,400,150)
 const r=detectEvidenceCrop(f.page,entry());assert.equal(r.status,'needs-review');assert.ok(r.reason)
 const g=fixture();g.box(50,100,400,300);g.add('A body sentence mentioning Figure 1.',50,430,400);assert.equal(detectEvidenceCrop(g.page,entry()).rect,null)
})
test('PDF text projection uses viewport rotation and font ascent rather than raw PDF coordinates',()=>{
 const c={items:[{str:'Figure 1',transform:[10,0,0,10,50,200],width:80,height:10,fontName:'f1'}],styles:{f1:{ascent:.8}}}
 const r=projectEvidenceText(c,{transform:[0,2,2,0,0,0]})[0];assert.deepEqual(r,{text:'Figure 1',x:396,y:100,width:20,height:160,angle:90})
})

test('neighbouring prose in a separate column never truncates the figure at matching baselines',()=>{
 const {page,box,add}=fixture();box(45,130,220,200);add('Figure 1. Test plot.',45,350,220)
 for(let i=0;i<17;i++)add('A separate column contains a normal paragraph with many words.',335,110+i*18,220)
 const r=detectEvidenceCrop(page,entry()),b=bounds(r,page);assert.equal(r.status,'ready');assert.ok(b.y<135&&b.y+b.h>329);assert.ok(b.x+b.w<320)
})

test('rotated visual page crops map back to the exact source viewport geometry',()=>{
 const f=fixture();f.box(80,180,360,140);f.add('Figure 1. Test plot.',80,365,360);const original=detectEvidenceCrop(f.page,entry());assert.ok(original.rect)
 const width=f.page.height,height=f.page.width,data=new Uint8ClampedArray(f.page.data.length)
 for(let y=0;y<f.page.height;y++)for(let x=0;x<f.page.width;x++){const to=(x*width+f.page.height-1-y)*4,from=(y*f.page.width+x)*4;data.set(f.page.data.subarray(from,from+4),to)}
 const rotated:EvidencePage={width,height,data,text:f.page.text.map(t=>({...t,x:f.page.height-t.y-t.height,y:t.x,width:t.height,height:t.width,angle:90}))},actual=detectEvidenceCrop(rotated,entry());assert.ok(actual.rect)
 assert.equal(actual.status,original.status);assert.ok(Math.abs(actual.rect.x-(1-original.rect.y-original.rect.height))<1e-9);assert.ok(Math.abs(actual.rect.y-original.rect.x)<1e-9);assert.ok(Math.abs(actual.rect.width-original.rect.height)<1e-9)
})
test('a numbered section heading following a formula table is not another data row',()=>{
 const f=fixture();f.add('Table 1. Test values.',70,100,380)
 for(let i=0;i<4;i++){f.add(i?'Layer '+i:'Layer',80,160+i*25,100);f.add(i?'O(1)':'Complexity',280,160+i*25,120);f.add(i?'1':'Steps',450,160+i*25,35)}
 f.add('3.5',70,285,25);f.add('Positional Encoding',120,285,180)
 const r=detectEvidenceCrop(f.page,entry('table')),b=bounds(r,f.page);assert.equal(r.status,'ready');assert.ok(b.y+b.h<275)
})

test('a wide diagram is not truncated to the narrower caption and text-column extent',()=>{
 const f=fixture();f.box(70,180,460,280);f.add('Panel A',135,410,70);f.add('Panel B',380,410,70);f.add('Figure 1. Test plot.',55,490,300)
 const r=detectEvidenceCrop(f.page,entry()),b=bounds(r,f.page);assert.equal(r.status,'ready');assert.ok(b.x<=70&&b.x+b.w>=530);assert.ok(b.w>=460)
})
test('vertically separated panels sharing one caption are all included rather than silently returning the closest panel',()=>{
 const f=fixture();f.box(80,140,360,130);f.box(80,365,360,130);f.add('Upper panel',90,278,100);f.add('Lower panel',90,505,100);f.add('Figure 1. Test plot.',80,545,360)
 const r=detectEvidenceCrop(f.page,entry()),b=bounds(r,f.page);assert.ok(b.y<=140&&b.y+b.h>=517);assert.ok(b.x<=80&&b.x+b.w>=440)
})
test('table rules extending beyond short outer cell values remain fully visible',()=>{
 const f=fixture();f.add('Table 1. Test values.',55,100,300)
 for(let row=0;row<=5;row++)f.box(70,180+row*36,460,1)
 for(let col=0;col<=3;col++)f.box(70+Math.floor(col*460/3),180,1,180)
 for(let row=0;row<5;row++)for(let col=0;col<3;col++)f.add(row?'Value '+row:col?'Score':'Method',80+Math.floor(col*460/3),192+row*36,50,10)
 const r=detectEvidenceCrop(f.page,entry('table')),b=bounds(r,f.page);assert.equal(r.status,'ready');assert.ok(b.x<=70&&b.x+b.w>=530);assert.ok(b.y<=180&&b.y+b.h>=360)
})

test('horizontal caption orientation wins over many rotated in-figure axis labels',()=>{
 const f=fixture();f.box(80,240,360,200);f.add('Figure 1. Test plot.',80,490,360)
 for(let i=0;i<16;i++){const t={text:'Vertical label '+i,x:90+i*20,y:160,width:10,height:65,angle:90};f.page.text.push(t);f.box(t.x,t.y,t.width,t.height)}
 const r=detectEvidenceCrop(f.page,entry()),b=bounds(r,f.page);assert.equal(r.status,'ready');assert.ok(b.y<=160);assert.ok(b.y+b.h>=440)
})

test('rotated axis tokens outside sparse attention lines still belong to the complete source figure',()=>{
 const f=fixture();f.box(330,240,110,180);f.add('Figure 1. Test plot.',70,455,400)
 for(let i=0;i<16;i++){const t={text:'Token '+i,x:80+i*24,y:175,width:10,height:55,angle:90};f.page.text.push(t);f.box(t.x,t.y,t.width,t.height)}
 const r=detectEvidenceCrop(f.page,entry()),b=bounds(r,f.page);assert.equal(r.status,'ready');assert.ok(b.x<=80&&b.x+b.w>=450);assert.ok(b.y<=175)
})

test('right-column table is isolated before left body prose can become a vertical barrier',()=>{
 const {page,box,add}=fixture();add('Table 1. Test values.',320,350,230)
 for(let i=0;i<8;i++)add('A neighbouring paragraph contains many ordinary words in its own column.',45,130+i*24,240)
 for(let r=0;r<4;r++){add(r?'Method '+r:'Method',325,150+r*35,80);add(r?String(90+r):'Score',470,150+r*35,50)}
 box(320,140,235,1);box(320,300,235,1)
 const result=detectEvidenceCrop(page,entry('table')),b=bounds(result,page)
 assert.equal(result.status,'ready');assert.ok(b.x>=310);assert.ok(b.y<=150);assert.ok(b.y+b.h>=300)
})
test('right-column figure keeps its upper panel above unrelated left-column prose',()=>{
 const {page,box,add}=fixture();box(325,150,220,110);box(325,290,220,100);add('Figure 1. Test plot.',325,425,220)
 for(let i=0;i<9;i++)add('A neighbouring paragraph contains many ordinary words in its own column.',45,130+i*27,240)
 const result=detectEvidenceCrop(page,entry()),b=bounds(result,page)
 assert.equal(result.status,'ready');assert.ok(b.x>=315);assert.ok(b.y<=150);assert.ok(b.y+b.h>=390)
})
test('subfigure method labels between image panels and caption are retained without becoming prose barriers',()=>{
 const {page,box,add}=fixture();box(60,220,480,130)
 add('(a) Baseline method (b) Direct solution (c) Ablation (d) Full method Reference image',60,370,480)
 add('Figure 1. Test plot.',60,425,480)
 const result=detectEvidenceCrop(page,entry()),b=bounds(result,page)
 assert.equal(result.status,'ready');assert.ok(b.y<=220);assert.ok(b.y+b.h>=382)
})

test('a right figure starting left of the page midpoint still separates from a narrow prose column',()=>{
 const {page,box,add}=fixture();box(225,180,320,180);add('Figure 1. Test plot.',225,400,320)
 for(let i=0;i<8;i++)add('Several words form a narrow neighbour paragraph.',45,150+i*25,160)
 const result=detectEvidenceCrop(page,entry()),b=bounds(result,page)
 assert.equal(result.status,'ready');assert.ok(b.x>=215);assert.ok(b.y<=180)
})
test('dense numeric table rows with compact gaps are data instead of prose',()=>{
 const {page,box,add}=fixture();add('Table 1. Test values.',60,400,480)
 for(let r=0;r<5;r++){
  add(r?'Score '+r:'Method',60,200+r*30,65)
  for(let c=0;c<10;c++)add(r?'27.10':'Col'+c,145+c*39,200+r*30,33,10)
 }
 box(60,190,475,1);box(60,360,475,1)
 const result=detectEvidenceCrop(page,entry('table')),b=bounds(result,page)
 assert.equal(result.status,'ready');assert.ok(b.y<=200);assert.ok(b.y+b.h>=332)
})

test('a nearby separate table below a figure caption cannot replace its image above',()=>{
 const {page,box,add}=fixture();box(70,120,460,210);add('Figure 1. Test plot.',70,370,460,20)
 for(let r=0;r<5;r++){add(r?'Model '+r:'Method',70,430+r*25,100);for(let c=0;c<5;c++)add(r?'27.10':'Col '+c,210+c*65,430+r*25,50)}
 for(let y=420;y<=560;y+=28)box(70,y,460,1);box(175,420,1,140)
 add('Table 2. A separate table.',70,600,460)
 const result=detectEvidenceCrop(page,entry()),b=bounds(result,page)
 assert.equal(result.status,'ready');assert.ok(b.y<=120);assert.ok(b.y+b.h<350)
})
test('table raster extension excludes a short footnote rule beyond the header',()=>{
 const {page,box,add}=fixture();add('Table 1. Test values.',60,425,480,20)
 add('1 https://example.invalid/local',60,190,230,10);box(60,180,220,1)
 for(let r=0;r<4;r++){add(r?'Method '+r:'Method',60,240+r*35,100);add(r?'27.10':'Score',260,240+r*35,80);add(r?'90.5':'Metric',450,240+r*35,80)}
 box(60,230,475,1)
 const result=detectEvidenceCrop(page,entry('table')),b=bounds(result,page)
 assert.equal(result.status,'ready');assert.ok(b.y>205)
})

test('a prose barrier visibly crossing continuous graphic pixels cannot claim a complete ready crop',()=>{
 const {page,box,add}=fixture();box(70,150,460,200)
 add('A long prose fragment is crossing the same apparent graphic region here.',70,210,460)
 add('Figure 1. Test plot.',70,400,460)
 const result=detectEvidenceCrop(page,entry());assert.equal(result.status,'needs-review');assert.ok(result.confidence<.75)
})

test('a separated aligned upper panel beyond an internal prose label cannot disappear from a ready crop',()=>{
 const {page,box,add}=fixture();box(80,120,360,130);box(80,310,360,140)
 add('Comparison of the reconstructed geometry for all tested input images',80,270,360)
 add('Figure 1. Test plot.',80,500,360)
 const result=detectEvidenceCrop(page,entry()),b=bounds(result,page)
 assert.ok(b.y<=120&&b.y+b.h>=450||result.status==='needs-review'&&result.confidence<.75)
})

test('repeated parameter labels between plot rows retain every panel as one ready figure',()=>{
 const {page,box,add}=fixture();for(let col=0;col<4;col++){box(60+col*125,120,110,130);box(60+col*125,310,110,140);add('mu = 1 tau = 2',60+col*125,270,120)}
 add('Figure 1. Test plot.',60,500,480)
 const result=detectEvidenceCrop(page,entry()),b=bounds(result,page)
 assert.equal(result.status,'ready');assert.ok(b.y<=120);assert.ok(b.y+b.h>=450)
})
