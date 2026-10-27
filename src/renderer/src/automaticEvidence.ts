import type { NormalizedRect, PaperSourceEntry } from '../../shared/types'
export interface EvidenceText { text:string; x:number; y:number; width:number; height:number; angle?:number }
export interface EvidencePage { width:number; height:number; data:Uint8ClampedArray; text:EvidenceText[] }
export interface EvidenceDetection { rect:NormalizedRect|null; confidence:number; status:'ready'|'needs-review'; reason?:string }
interface Box {x:number;y:number;width:number;height:number}
interface Row extends Box {parts:EvidenceText[];text:string}
const right=(b:Box)=>b.x+b.width,bottom=(b:Box)=>b.y+b.height
const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g,'')
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v))
function union(boxes:Box[]):Box {const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return{x,y,width:Math.max(...boxes.map(right))-x,height:Math.max(...boxes.map(bottom))-y}}
const captionLabel=/^(?:Figure|Fig\.?|Table)\s*(?:S?\d+(?:[.-]\d+)*|[IVX]+)(?=$|[\s.:：)\-])|^[图表]\s*(?:[A-Z]?\d+(?:[.-]\d+)*|[一二三四五六七八九十百零〇]+)/i
const isCaption=(s:string)=>captionLabel.test(s.trim())
function groupedRows(text:EvidenceText[]):Row[]{
 const rows:Row[]=[]
 for(const t of [...text].filter(t=>t.text.trim()&&[t.x,t.y,t.width,t.height].every(Number.isFinite)&&t.width>0&&t.height>0).sort((a,b)=>a.y-b.y||a.x-b.x)){
  let r=[...rows].reverse().find(r=>Math.abs(r.y+r.height*.5-t.y-t.height*.5)<=Math.max(2,Math.min(r.height,t.height)*.45))
  if(!r){r={...t,parts:[],text:''};rows.push(r)}r.parts.push(t);Object.assign(r,union(r.parts))
 }
 for(const r of rows){r.parts.sort((a,b)=>a.x-b.x);r.text=r.parts.map(p=>p.text).join(' ')}return rows.sort((a,b)=>a.y-b.y)
}
function cells(row:Row):EvidenceText[][]{const result:EvidenceText[][]=[];let end=-Infinity
 for(const p of row.parts){if(p.x-end>Math.max(8,row.height*.85))result.push([]);result[result.length-1].push(p);end=Math.max(end,right(p))}return result}
function numericLayout(r:Row){const tokens=r.text.trim().split(/\s+/),numbers=tokens.filter(t=>/^[-+−]?(?:\d+(?:[.,]\d+)?|\.\d+)%?$/.test(t));return numbers.length>=3&&numbers.length>=tokens.length*.4||r.parts.filter(p=>/\d/.test(p.text)&&p.text.length<16).length>=3}
function prose(r:Row){if(numericLayout(r)&&(r.text.match(/=/g)?.length??0)>=3)return false;if((r.text.match(/\([a-z]\)/gi)?.length??0)>=2)return false;return cells(r).some(group=>{const text=group.map(p=>p.text).join(' ');return text.split(/\s+/).length>=9&&text.length>45})}
function numeric(s:string){return /(?:^|\s)[-+−]?(?:\d+(?:[.,]\d+)?|[.]\d+)(?:%|\s|$)/.test(s)}
function tableRow(r:Row){const c=cells(r);return c.length>=2&&c.length<=32&&(!prose(r)||numericLayout(r))&&c.slice(1).some(g=>numeric(g.map(p=>p.text).join(' ')))}
function anchor(rows:Row[],entry:PaperSourceEntry):{box:Box;parts:EvidenceText[]}|null{
 const wanted=norm(entry.label),first=norm(entry.text.split('\n')[0])
 for(const row of rows){
  for(let i=0;i<row.parts.length;i++){
   const suffix=row.parts.slice(i).map(p=>p.text).join(' '),label=captionLabel.exec(suffix.trim())?.[0]
   if(!label||norm(label)!==wanted)continue
   let end=i+1;while(end<row.parts.length&&!isCaption(row.parts[end].text))end++
   let parts=row.parts.slice(i,end)
   // Another column may contain a body paragraph on the same baseline.
   const gap=parts.findIndex((p,n)=>n>0&&p.x-right(parts[n-1])>Math.max(50,row.height*4));if(gap>0)parts=parts.slice(0,gap)
   const text=norm(parts.map(p=>p.text).join(' '));if(!first.startsWith(text.slice(0,Math.min(40,text.length)))&&!text.startsWith(first.slice(0,Math.min(40,first.length))))continue
   const nextLines=entry.text.split('\n').slice(1,9)
   for(const line of nextLines){const b=union(parts);const next=rows.map(r=>{const local=r.parts.filter(p=>p.x>=parts[0].x-row.height*.35);return local.length?{...union(local),parts:local,text:local.map(p=>p.text).join(' ')}:null}).find(r=>r&&r.y>bottom(b)-row.height*.15&&r.y-bottom(b)<row.height*1.35&&Math.abs(r.x-parts[0].x)<row.height*2&&norm(r.text)===norm(line)&&!tableRow(r)&&!isCaption(r.text));if(!next)break;parts.push(...next.parts)}
   return{box:union(parts),parts}
  }
 }return null
}
function columnBounds(page:EvidencePage,rows:Row[],a:Box):[number,number]{
 let left=2,end=page.width-2
 const leftProse=rows.flatMap(r=>cells(r).map(group=>{const b=union(group);return{...b,parts:group,text:group.map(p=>p.text).join(' ')}})).filter(r=>r.y<a.y&&r.y>a.y-page.height*.5&&r.x<a.x-a.height*2&&right(r)<a.x+a.height*.5&&r.width<page.width*.5&&r.text.length>20&&r.text.trim().split(/\s+/).length>=4)
 if(a.width<page.width*.6&&leftProse.length>=3)left=Math.max(left,a.x-8)
 const adjacent=rows.flatMap(r=>r.parts.filter(p=>isCaption(p.text)&&Math.abs(p.y-a.y)<a.height*2))
 for(const p of adjacent){if(p.x>a.x+a.height*4)end=Math.min(end,(right(a)+p.x)/2);else if(right(p)<a.x-a.height*4)left=Math.max(left,(right(p)+a.x)/2)}
 if(a.width<page.width*.56){
  const starts=new Map<number,number>()
  for(const r of rows)for(const group of cells(r)){const txt=group.map(p=>p.text).join(' ');if(txt.length>45){const x=Math.round(group[0].x/12)*12;starts.set(x,(starts.get(x)??0)+1)}}
  const columns=[...starts].filter(([,count])=>count>=3).map(([x])=>x).sort((a,b)=>a-b)
  const at=columns.filter(x=>x<=a.x+a.height*2).at(-1)??a.x,next=columns.find(x=>x>a.x+page.width*.2)
  if(at!==undefined&&next!==undefined&&next-at>page.width*.3&&right(a)<next+8)end=Math.min(end,Math.max(right(a)+8,next-Math.max(8,page.width*.025)))
  if(at!==undefined&&at>page.width*.4)left=Math.max(left,at-8)
 }
 return[left,end]
}
function excludedMask(page:EvidencePage):Uint8Array{
 const mask=new Uint8Array(page.width*page.height)
 for(let i=0;i<mask.length;i++){const p=i*4;mask[i]=page.data[p+3]>80&&Math.min(page.data[p],page.data[p+1],page.data[p+2])<238?1:0}
 for(const t of page.text){const x0=clamp(Math.floor(t.x-2),0,page.width),x1=clamp(Math.ceil(right(t)+2),0,page.width),y0=clamp(Math.floor(t.y-2),0,page.height),y1=clamp(Math.ceil(bottom(t)+2),0,page.height)
  for(let y=y0;y<y1;y++)mask.fill(0,y*page.width+x0,y*page.width+x1)
 }return mask
}
function limits(page:EvidencePage,rows:Row[],a:Box,x0:number,x1:number,direction:-1|1,allowTableRows=false):[number,number]{
 let top=Math.max(2,page.height*.025),end=Math.min(page.height-2,page.height*.975)
 const localRows=rows.map(r=>{const parts=r.parts.filter(p=>p.x<x1&&right(p)>x0);return parts.length?{...union(parts),parts,text:parts.map(p=>p.text).join(' ')}:null}).filter((r):r is Row=>Boolean(r))
 const denseTableRows=localRows.filter(tableRow).length>=3
 const blockers=localRows.filter(r=>r.y+2<a.y||r.y>bottom(a)+2).filter(r=>isCaption(r.text)||prose(r)&&!(allowTableRows&&numericLayout(r))||!allowTableRows&&direction===1&&denseTableRows&&tableRow(r))
 if(direction===-1){end=Math.floor(a.y-3);const before=blockers.filter(r=>bottom(r)<a.y-3);if(before.length)top=Math.max(top,bottom(before.at(-1)!)+3)}
 else{top=Math.ceil(bottom(a)+1);const after=blockers.find(r=>r.y>bottom(a)+3);if(after)end=Math.min(end,after.y-3)}
 return[top,end]
}
interface Candidate {box:Box;confidence:number;distance:number;direction:-1|1}
function graphicsCandidate(page:EvidencePage,rows:Row[],a:Box,mask:Uint8Array,x0:number,x1:number,direction:-1|1):Candidate|null{
 const [top,end]=limits(page,rows,a,x0,x1,direction),h=Math.min(a.height,32),bands:Array<{top:number;end:number;left:number;right:number;pixels:number}>=[]
 let active:typeof bands[number]|null=null,lastInk=-Infinity
 for(let y=Math.ceil(top);y<end;y++){let left=Infinity,right=-Infinity,count=0
  for(let x=Math.ceil(x0);x<Math.floor(x1);x++)if(mask[y*page.width+x]){left=Math.min(left,x);right=x;count++}
  if(count<2)continue
  if(!active||y-lastInk>h*1.7){active={top:y,end:y+1,left,right:right+1,pixels:count};bands.push(active)}else{active.end=y+1;active.left=Math.min(active.left,left);active.right=Math.max(active.right,right+1);active.pixels+=count}lastInk=y
 }
 const substantial=bands.filter(b=>b.end-b.top>=h*1.5&&b.right-b.left>=Math.min(page.width*.12,(x1-x0)*.3)&&b.pixels>30)
 if(!substantial.length)return null
 const closest=direction===-1?substantial.at(-1)!:substantial[0]
 // Every substantial aligned band inside the caption's prose/caption barriers may be a panel.
 // A narrow caption or a wide inter-panel gap must never silently truncate a shared figure.
 const selected=substantial
 let b=union(selected.map(b=>({x:b.left,y:b.top,width:b.right-b.left,height:b.end-b.top})))
 const text=page.text.filter(t=>t.x>=x0&&right(t)<=x1&&!isCaption(t.text)&&!aContains(a,t)&&t.y>=top&&bottom(t)<=end&&bottom(t)>=b.y-h*2&&t.y<=bottom(b)+h*2&&(Math.abs(Math.sin((t.angle??0)*Math.PI/180))>.9||right(t)>=b.x-h*2&&t.x<=right(b)+h*2))
 if(text.length)b=union([b,...text])
 const margin=Math.max(2,Math.min(6,h*.35));b={x:Math.max(x0,b.x-margin),y:Math.max(top,b.y-margin),width:Math.min(x1,right(b)+margin)-Math.max(x0,b.x-margin),height:Math.min(end,bottom(b)+margin)-Math.max(top,b.y-margin)}
 const distance=direction===-1?a.y-bottom(b):b.y-bottom(a)
 const confidence=.82+(distance<h*4?.08:-.12)+(b.height>h*4?.04:0)
 return{box:b,confidence:clamp(confidence,0,1),distance,direction}
}
function aContains(a:Box,b:Box){return b.x>=a.x-1&&right(b)<=right(a)+1&&b.y>=a.y-1&&bottom(b)<=bottom(a)+1}
function tableCandidate(page:EvidencePage,rows:Row[],a:Box,mask:Uint8Array,x0:number,x1:number,direction:-1|1):Candidate|null{
 const [top,end]=limits(page,rows,a,x0,x1,direction,true),h=Math.min(a.height,32)
 const nearby=rows.filter(r=>r.y>=top&&bottom(r)<=end).map(r=>{const parts=r.parts.filter(p=>p.x>=x0&&right(p)<=x1);return parts.length?{...union(parts),parts,text:parts.map(p=>p.text).join(' ')}:null}).filter((r):r is Row=>Boolean(r))
 const numericRows=nearby.filter(tableRow)
 if(numericRows.length<2)return null
 const ordered=direction===1?numericRows:[...numericRows].reverse(),chosen:Row[]=[ordered[0]]
 for(const row of ordered.slice(1)){const last=chosen.at(-1)!,gap=Math.max(row.y,last.y)-Math.min(bottom(row),bottom(last));if(gap>h*3.5)break;chosen.push(row)}
 if(chosen.length<2)return null
 let b=union(chosen)
 for(let pass=0;pass<6;pass++){const header=nearby.filter(r=>(!prose(r)||numericLayout(r))&&!isCaption(r.text)&&cells(r).length>=2&&r.y<b.y&&b.y-bottom(r)<h*3.5);if(!header.length)break;b=union([b,...header])}
 // Rule lines are part of the table, not caption or prose. Raster bounds add borders around text-only estimates.
 let gx0=b.x,gx1=right(b),gy0=b.y,gy1=bottom(b)
 for(let y=Math.floor(Math.max(top,b.y-h*3.5));y<Math.min(end,bottom(b)+h*3.5);y++){
  let first=Infinity,last=-Infinity,count=0
  for(let x=Math.floor(x0);x<x1;x++)if(mask[y*page.width+x]){first=Math.min(first,x);last=x;count++;if(y>=b.y-h*1.5&&y<=bottom(b)+h*1.5&&x>=b.x-h*2&&x<=right(b)+h*2){gx0=Math.min(gx0,x);gx1=Math.max(gx1,x+1);gy0=Math.min(gy0,y);gy1=Math.max(gy1,y+1)}}
  // Horizontal rules extend farther than short values in the outer cells.
  if(count>Math.max(b.width*.7,(x1-x0)*.25)){gx0=Math.min(gx0,first);gx1=Math.max(gx1,last+1);gy0=Math.min(gy0,y);gy1=Math.max(gy1,y+1)}
 }
 const margin=Math.max(2,Math.min(6,h*.35));b={x:Math.max(x0,gx0-margin),y:Math.max(top,gy0-margin),width:Math.min(x1,gx1+margin)-Math.max(x0,gx0-margin),height:Math.min(end,gy1+margin)-Math.max(top,gy0-margin)}
 const distance=direction===-1?a.y-bottom(b):b.y-bottom(a)
 return{box:b,confidence:chosen.length>=3?.93:.82,distance,direction}
}
function omittedAlignedPanel(page:EvidencePage,rows:Row[],a:Box,b:Box,mask:Uint8Array,x0:number,x1:number,direction:-1|1):boolean{
 const h=Math.min(a.height,32),[top,end]=limits(page,rows,a,x0,x1,direction)
 if(direction===-1&&top<=Math.max(2,page.height*.025)+1||direction===1&&end>=Math.min(page.height-2,page.height*.975)-1)return false
 let start=direction===-1?Math.max(2,top-h*14):end+4,finish=direction===-1?top-4:Math.min(page.height-2,end+h*14)
 for(const row of rows){const local=row.parts.filter(p=>p.x<x1&&right(p)>x0);if(!local.length||!isCaption(local.map(p=>p.text).join(' ')))continue
  const captionBox=union(local);if(direction===-1&&bottom(captionBox)<top)start=Math.max(start,bottom(captionBox)+3)
  if(direction===1&&captionBox.y>end)finish=Math.min(finish,captionBox.y-3)
 }
 const proseBands=rows.map(row=>{const parts=row.parts.filter(p=>p.x<x1&&right(p)>x0);return parts.length?{...union(parts),parts,text:parts.map(p=>p.text).join(' ')}:null}).filter((row):row is Row=>Boolean(row&&prose(row)))
 let first=-1,last=-Infinity,left=Infinity,edge=-Infinity,pixels=0
 const aligned=()=>{if(first<0||last-first<h*1.5||pixels<30)return false
  const width=edge-left+1,overlap=Math.min(edge+1,right(b))-Math.max(left,b.x),distance=direction===-1?b.y-last:first-bottom(b)
  return width>=b.width*.55&&overlap>=Math.min(width,b.width)*.75&&distance>=0&&distance<=h*8
 }
 for(let y=Math.ceil(start);y<finish;y++){if(proseBands.some(row=>y>=row.y-3&&y<=bottom(row)+3)){if(aligned())return true;first=-1;last=-Infinity;left=Infinity;edge=-Infinity;pixels=0;continue}
  let rowLeft=Infinity,rowRight=-Infinity,count=0
  for(let x=Math.ceil(x0);x<Math.floor(x1);x++)if(mask[y*page.width+x]){rowLeft=Math.min(rowLeft,x);rowRight=x;count++}
  if(count<2)continue
  if(first<0||y-last>h*1.7){if(aligned())return true;first=y;left=Infinity;edge=-Infinity;pixels=0}
  last=y;left=Math.min(left,rowLeft);edge=Math.max(edge,rowRight);pixels+=count
 }
 return aligned()
}
/** Local layout analysis is deliberately conservative: unreliable pages retain a correction entry, not a fake precise page image. */
export function detectEvidenceCrop(page:EvidencePage,entry:PaperSourceEntry):EvidenceDetection{
 const review=(reason:string):EvidenceDetection=>({rect:null,confidence:0,status:'needs-review',reason})
 if(!Number.isSafeInteger(page.width)||!Number.isSafeInteger(page.height)||page.width<1||page.height<1||page.width*page.height>4000000||page.data.length!==page.width*page.height*4)throw Error('Invalid bounded evidence raster')
 if(entry.kind!=='figure'&&entry.kind!=='table')return review('Only original figures and tables can be cropped.')
 if(!page.text.length)return review('No positioned caption text was found. Scanned pages need OCR or manual cropping.')
 const rotated=page.text.filter(t=>t.text.trim()).map(t=>((Math.round((t.angle??0)/90)%4)+4)%4),counts=[0,0,0,0];for(const angle of rotated)counts[angle]++
 const captionText=page.text.find(t=>norm(captionLabel.exec(t.text.trim())?.[0]??'')===norm(entry.label))
 const turn=captionText?((Math.round((captionText.angle??0)/90)%4)+4)%4:counts.indexOf(Math.max(...counts))
 if(turn){const canonical=rotatePage(page,(4-turn)%4),result=detectEvidenceCrop(canonical,entry);if(result.rect)result.rect=rotateNormalized(result.rect,turn);return result}
 const horizontal=page.text.filter(t=>Math.abs(Math.sin((t.angle??0)*Math.PI/180))<.1)
 const rows=groupedRows(horizontal),found=anchor(rows,entry);if(!found)return review('The numbered caption could not be matched reliably on this source page. Crop it manually.')
 const a=found.box,[x0,x1]=columnBounds(page,rows,a),mask=excludedMask(page)
 const candidates=([-1,1] as const).map(dir=>entry.kind==='table'?tableCandidate(page,rows,a,mask,x0,x1,dir)??graphicsCandidate(page,rows,a,mask,x0,x1,dir):graphicsCandidate(page,rows,a,mask,x0,x1,dir)).filter((x):x is Candidate=>Boolean(x))
 if(!candidates.length)return review('No separate figure or stable table region could be isolated from the neighbouring text. Crop it manually.')
 candidates.sort((a,b)=>b.confidence-a.confidence||a.distance-b.distance)
 const chosen=candidates[0],ambiguous=candidates.length>1&&Math.abs(chosen.confidence-candidates[1].confidence)<.12&&Math.abs(chosen.distance-candidates[1].distance)<page.height*.12
 const b=chosen.box,rect={x:b.x/page.width,y:b.y/page.height,width:b.width/page.width,height:b.height/page.height}
 if(rect.width*rect.height>.9||b.width<12||b.height<12)return review('The proposed region is too large or too small to establish a precise crop. Review the source page.')
 const clipped=entry.kind==='figure'&&rows.some(row=>{
  const parts=row.parts.filter(p=>p.x>=b.x&&right(p)<=right(b));if(!parts.length)return false
  const local={...union(parts),parts,text:parts.map(p=>p.text).join(' ')};if(!prose(local)||isCaption(local.text)||Math.abs(bottom(local)+3-b.y)>3)return false
  const before=Math.floor(local.y-3),after=Math.ceil(bottom(local)+4);if(before<0||after>=page.height)return false
  let crossing=0;for(let x=Math.ceil(b.x);x<right(b);x++)if(mask[before*page.width+x]&&mask[after*page.width+x])crossing++
  return crossing>=Math.max(12,b.width*.15)
 })
 const omitted=entry.kind==='figure'&&omittedAlignedPanel(page,rows,a,b,mask,x0,x1,chosen.direction)
 const confidence=ambiguous||clipped||omitted?Math.min(.6,chosen.confidence):chosen.confidence
 return{rect,confidence,status:confidence>=.75?'ready':'needs-review',...(confidence<.75?{reason:omitted?'An aligned graphic panel occurs beyond the intervening text. The proposed crop may be incomplete; check and correct it.':clipped?'Graphic pixels continue across a prose boundary. The proposed crop may omit a panel; check and correct it.':ambiguous?'Similar regions occur on both sides of the caption. Check and correct the proposed crop.':'The caption is far from the detected region. Check and correct the proposed crop.'}:{})}
}
export function projectEvidenceText(content:{items:unknown[];styles?:Record<string,{ascent?:number}>},viewport:{transform:number[]}):EvidenceText[]{
 const v=viewport.transform,point=(x:number,y:number)=>({x:v[0]*x+v[2]*y+v[4],y:v[1]*x+v[3]*y+v[5]})
 return content.items.flatMap(value=>{
  if(!value||typeof value!=='object')return[];const t=value as{str?:string;transform?:number[];width?:number;height?:number;fontName?:string},m=t.transform
  if(!t.str?.trim()||!m||m.length<6||!m.every(Number.isFinite)||!Number.isFinite(t.width)||!Number.isFinite(t.height)||!t.width||!t.height)return[]
  const scale=Math.hypot(m[0],m[1]),vertical=Math.hypot(m[2],m[3]);if(!scale||!vertical)return[]
  const ascent=clamp(content.styles?.[t.fontName??'']?.ascent??.85,.5,1),ux=m[0]/scale*t.width,uy=m[1]/scale*t.width,vx=m[2]/vertical*t.height,vy=m[3]/vertical*t.height
  const points=[point(m[4]-vx*(1-ascent),m[5]-vy*(1-ascent)),point(m[4]+ux-vx*(1-ascent),m[5]+uy-vy*(1-ascent)),point(m[4]+vx*ascent,m[5]+vy*ascent),point(m[4]+ux+vx*ascent,m[5]+uy+vy*ascent)]
  const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y)),angle=Math.round(Math.atan2(v[1]*m[0]+v[3]*m[1],v[0]*m[0]+v[2]*m[1])*180/Math.PI)
  return[{text:t.str,x,y,width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y,angle}]
 })
}
function rotateNormalized(b:NormalizedRect,turn:number):NormalizedRect{for(let i=0;i<turn;i++)b={x:1-b.y-b.height,y:b.x,width:b.height,height:b.width};return b}
function rotatePage(page:EvidencePage,turn:number):EvidencePage{
 if(!turn)return page;const width=turn%2?page.height:page.width,height=turn%2?page.width:page.height,data=new Uint8ClampedArray(page.data.length)
 for(let y=0;y<page.height;y++)for(let x=0;x<page.width;x++){const nx=turn===1?page.height-1-y:turn===2?page.width-1-x:y,ny=turn===1?x:turn===2?page.height-1-y:page.width-1-x,from=(y*page.width+x)*4,to=(ny*width+nx)*4;data.set(page.data.subarray(from,from+4),to)}
 const text=page.text.map(t=>{const b=rotateNormalized({x:t.x/page.width,y:t.y/page.height,width:t.width/page.width,height:t.height/page.height},turn);return{...t,x:b.x*width,y:b.y*height,width:b.width*width,height:b.height*height,angle:((t.angle??0)+turn*90)%360}})
 return{width,height,data,text}
}
