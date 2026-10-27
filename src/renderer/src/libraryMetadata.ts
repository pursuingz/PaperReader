import type { LibraryMetadata, Paper, PaperMetadata, LibraryActivity } from '../../shared/types'

export function overlayLibraryMetadata(papers: Paper[], metadata: LibraryMetadata): Paper[] {
  return papers.map(paper => applyPaperMetadata(paper, metadata))
}
export function applyPaperMetadata(paper: Paper, metadata: LibraryMetadata): Paper { return !paper.isDemo && Object.hasOwn(metadata, paper.id) ? { ...paper, ...metadata[paper.id] } : paper }
/** Time buckets use successful opens and local calendar boundaries, including DST. */
export function groupRecentLibrary(papers:Paper[],now=new Date(),activity:LibraryActivity={version:1,lastOpenedAt:{}}):Array<{id:string;name:string;papers:Paper[]}>{
 const today=new Date(now);today.setHours(0,0,0,0);const tomorrow=new Date(today);tomorrow.setDate(tomorrow.getDate()+1)
 const recent=new Date(today);recent.setDate(recent.getDate()-2);const week=new Date(today);week.setDate(week.getDate()-((week.getDay()+6)%7));const month=new Date(today);month.setDate(1)
 const groups=[['today','Today'],['recent','Last 3 days'],['week','This week'],['month','This month'],['earlier','Earlier']].map(([id,name])=>({id:'time-'+id,name,papers:[] as Paper[]}))
 const opened=(paper:Paper)=>{const text=Object.hasOwn(activity.lastOpenedAt,paper.id)?activity.lastOpenedAt[paper.id]:undefined;const value=text?Date.parse(text):NaN;return Number.isFinite(value)?value:-Infinity}
 const sorted=papers.filter(p=>!p.isDemo).map(p=>({paper:p,time:opened(p)})).sort((a,b)=>b.time-a.time)
 for(const {paper,time} of sorted){const bucket=time>=today.getTime()&&time<tomorrow.getTime()?0:time>=recent.getTime()&&time<today.getTime()?1:time>=week.getTime()&&time<today.getTime()?2:time>=month.getTime()&&time<today.getTime()?3:4;groups[bucket].papers.push(paper)}
 const demo=papers.filter(p=>p.isDemo);return [...groups.filter(g=>g.papers.length),...(demo.length?[{id:'demo',name:'Demonstration',papers:demo}]:[])]
}
export function paperInformationInput(titleInput: string, authorsInput: string, yearInput: string): PaperMetadata {
  const title = titleInput.trim(), authors = authorsInput.trim(), yearText = yearInput.trim()
  if (!title || title.length > 300 || /[\u0000-\u001f\u007f-\u009f]/.test(titleInput)) throw new Error('Paper title must contain 1–300 characters on one line.')
  if (authors.length > 1000 || /[\u0000-\u001f\u007f-\u009f]/.test(authorsInput)) throw new Error('Paper authors must contain at most 1,000 characters on one line.')
  if (yearText && (!/^[1-9]\d{3}$/.test(yearText))) throw new Error('Publication year must be four digits, or leave it blank.')
  return { title, authors, year: yearText ? Number(yearText) : null }
}
