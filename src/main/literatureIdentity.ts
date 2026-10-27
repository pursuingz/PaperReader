import type { LiteratureIdentity } from '../shared/agentTypes'

export interface LiteratureIdentitySource extends LiteratureIdentity { rawText?: string }
export function normalizeDoi(value:unknown):string|undefined{
 if(typeof value!=='string')return
 const result=value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi:\s*/i,'').replace(/[.,;]+$/,'').toLowerCase()
 return /^10\.\d{4,9}\/\S+$/.test(result)&&result.length<512?result:undefined
}
export function extractArxivId(value:unknown):string|undefined{
 if(typeof value!=='string'||value.length>50_000)return
 let text=value.trim();try{text=decodeURIComponent(text)}catch{}
 const match=text.match(/(?:^|[^\w])((?:[a-z][a-z0-9.-]*\/\d{7}|\d{4}\.\d{4,5})(?:v[1-9]\d*)?)(?=$|[^\w])/i)
 return match?.[1].toLowerCase()
}
export const arxivCore=(value:string)=>value.replace(/v\d+$/i,'')
export function extractLiteratureIdentity(reference:LiteratureIdentitySource):LiteratureIdentity{
 const raw=typeof reference.rawText==='string'?reference.rawText.slice(0,50_000):''
 const identity:LiteratureIdentity={}
 const title=reference.title?.trim()||raw.match(/["“]([^"”]{4,2000})["”]/)?.[1]?.trim()
 if(title)identity.title=title.slice(0,2000)
 const parsedDoi=normalizeDoi(reference.doi)??normalizeDoi(raw.match(/(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}\/[^\s<>"}]+)/i)?.[1])
 if(parsedDoi)identity.doi=parsedDoi
 const arxivId=extractArxivId(reference.arxivId)??extractArxivId(raw)
 if(arxivId)identity.arxivId=arxivId
 if(reference.authors?.length)identity.authors=reference.authors.filter(v=>typeof v==='string'&&v.trim()).slice(0,100).map(v=>v.trim().slice(0,200))
 if(Number.isInteger(reference.year)&&reference.year!>=1800&&reference.year!<=2200)identity.year=reference.year
 return identity
}
