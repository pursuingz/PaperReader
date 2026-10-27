export interface ReadingTextRow { top: number; bottom: number; left?: number; right?: number }
function mergeRows(input: ReadingTextRow[]): ReadingTextRow[] {
 const rows:ReadingTextRow[]=[]
 for(const row of input){const last=rows.at(-1);if(last&&Math.abs(last.top-row.top)<=2)last.bottom=Math.max(last.bottom,row.bottom);else rows.push({...row})}
 return rows
}
function overlapBoundary(height:number, rows:ReadingTextRow[], direction:'up'|'down', retain:number):number {
 return direction==='down'?rows[rows.length-retain].top-2:height-rows[retain-1].bottom-2
}
export function readingScrollAmount(height: number, input: ReadingTextRow[], direction: 'up'|'down', fallbackLineHeight=24): number {
 if(!Number.isFinite(height)||height<=0)return 0
 const sorted=input.filter(r=>Number.isFinite(r.top)&&Number.isFinite(r.bottom)&&r.bottom>r.top&&r.bottom>0&&r.top<height).sort((a,b)=>a.top-b.top)
 const rows=mergeRows(sorted), complete=rows.filter(r=>r.top>=0&&r.bottom<=height)
 const positioned=sorted.filter(r=>r.top>=0&&r.bottom<=height&&Number.isFinite(r.left)&&Number.isFinite(r.right)&&r.right!>r.left!)
 const heights=complete.map(r=>r.bottom-r.top).sort((a,b)=>a-b)
 // Leading and an edge half-row need additional room around the three complete rows.
 const minimumOverlap=heights.length?heights[Math.floor(heights.length/2)]*1.25*4:0
 if(complete.length>=3){
  const retain=!positioned.length&&complete.length>=6?6:3
  let step=overlapBoundary(height,complete,direction,retain)
  // Each horizontal text band imposes its own boundary, so offset columns cannot
  // masquerade as twice as many rows. Repeated word boxes on a line are merged.
  const centers=new Set(positioned.map(r=>Math.round((r.left!+r.right!)/2)))
  for(const x of centers){
   const column=mergeRows(positioned.filter(r=>r.left!<=x&&r.right!>=x))
   if(column.length>=3)step=Math.min(step,overlapBoundary(height,column,direction,3))
  }
  return Math.max(0,Math.min(height-minimumOverlap,step))
 }
 const pitches=rows.slice(1).map((r,i)=>r.top-rows[i].top).filter(n=>n>2&&n<height/2).sort((a,b)=>a-b)
 const pitch=pitches.length?pitches[Math.floor(pitches.length/2)]:Math.max(18,Number.isFinite(fallbackLineHeight)?fallbackLineHeight:24)
 return Math.max(0,height-Math.max(pitch*3,height*.15))
}
export function readerScrollAmount(host: HTMLElement, direction: 'up'|'down'): number {
 const buffer=host.querySelector<HTMLElement>('[data-pdf-render-state]')
 if(buffer&&buffer.getAttribute('data-pdf-render-state')!=='ready')return 0
 const textRoot=buffer?buffer.querySelector<HTMLElement>('[data-pdf-frame-state="active"]'):host
 if(!textRoot)return 0
 const bounds=host.getBoundingClientRect(),origin=bounds.top+host.clientTop
 const rows:ReadingTextRow[]=[]
 for(const span of textRoot.querySelectorAll<HTMLElement>('.react-pdf__Page__textContent span, .textLayer span')){
  if(span.childElementCount||!span.textContent?.trim())continue
  for(const rect of span.getClientRects())if(rect.width>0&&rect.height>1)rows.push({top:rect.top-origin,bottom:rect.bottom-origin,left:rect.left-bounds.left,right:rect.right-bounds.left})
 }
 return readingScrollAmount(host.clientHeight,rows,direction)
}
