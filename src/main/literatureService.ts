import { createHash } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import type { LiteratureCandidate, LiteratureIdentity, LiteratureImportReceipt } from '../shared/agentTypes'
import { boundedText } from './agentValidation'
import { assertPublicUrl, PublicHttpClient } from './literatureHttp'
import { LiteratureDownloadStore } from './literatureDownloadStore'
import { arxivCore, extractArxivId, extractLiteratureIdentity, normalizeDoi } from './literatureIdentity'
import { LiteratureError, literatureNetworkError } from './literatureErrors'
export { LiteratureError } from './literatureErrors'

const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ')
const decode=(s:string)=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/\s+/g,' ').trim()
const xml=(s:string,tag:string)=>decode(s.match(new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+tag+'>','i'))?.[1]??'')
const candidateId=(id:string)=>createHash('sha256').update('arxiv\n'+id).digest('hex').slice(0,32)
const namedAuthor=(name:string)=>name.trim().replace(/(?:^|[\s,;]+)et\s+al\.?$/i,'').trim()
function authorMatches(requested:string,available:string):boolean{
 const parts=(name:string)=>{const comma=name.split(','),tokens=normalize(name).split(' '),family=normalize(comma.length>1?comma[0]:tokens.at(-1)??''),given=normalize(comma.length>1?comma.slice(1).join(' '):tokens.slice(0,-1).join(' ')).split(' ')[0];return{family,given}}
 const wanted=parts(namedAuthor(requested)),remote=parts(namedAuthor(available))
 return !!wanted.family&&wanted.family===remote.family&&(!wanted.given||!remote.given||(wanted.given.length>1&&remote.given.length>1?wanted.given===remote.given:wanted.given[0]===remote.given[0]))
}

export function assessLiteratureIdentity(identity:LiteratureIdentity,candidate:LiteratureCandidate):Pick<LiteratureCandidate,'assessment'|'reasons'>{
 const reasons:string[]=[];let conflict=false,uncertain=false
 const wantedDoi=normalizeDoi(identity.doi),remoteDoi=normalizeDoi(candidate.doi)
 if(wantedDoi&&remoteDoi&&wantedDoi!==remoteDoi){conflict=true;reasons.push('DOI differs.')}
 if(wantedDoi&&!remoteDoi&&!identity.title&&!identity.arxivId){uncertain=true;reasons.push('Candidate has no DOI; another matching identifier is required.')}
 if(identity.arxivId){const wanted=extractArxivId(identity.arxivId),remote=extractArxivId(candidate.arxivId);if(!wanted||!remote||arxivCore(wanted)!==arxivCore(remote)){conflict=true;reasons.push('arXiv identity differs.')}else if(/v\d+$/.test(wanted)&&wanted!==remote){uncertain=true;reasons.push('Different arXiv revision; review the version.')}}
 if(identity.title){if(normalize(identity.title)!==normalize(candidate.title)){conflict=true;reasons.push('Title differs from the requested work.')}}else if(!wantedDoi&&!identity.arxivId){uncertain=true;reasons.push('Search words alone do not establish identity.')}
 if(identity.year!==undefined&&candidate.year!==undefined&&Math.abs(identity.year-candidate.year)>1){conflict=true;reasons.push('Publication year differs.')}
 if(identity.authors?.length){const named=identity.authors.map(namedAuthor).filter(Boolean),remote=candidate.authors.map(namedAuthor).filter(Boolean);if(!named.length||!remote.length){uncertain=true;reasons.push('Author names are unavailable in abbreviated metadata.')}else if(!named.every(name=>remote.some(available=>authorMatches(name,available)))){conflict=true;reasons.push('Author metadata differs from the requested work.')}}
 if(!conflict&&!uncertain)reasons.push('Supplied identifiers and available title/author metadata agree; scientific claims are not verified.')
 return {assessment:conflict?'conflict':uncertain?'uncertain':'consistent',reasons}
}
export interface LiteratureSearchInput { query:string; provider?:'arxiv'|'crossref'|'all'; limit?:number; identity?:LiteratureIdentity }
export interface LiteratureAcquireOptions { allowNewVersion?:boolean }
export class LiteratureVersionConflictError extends Error { constructor(readonly relatedPaperIds:string[]){super('A different version exists. Select this candidate explicitly to preserve the earlier version and import a new paper.');this.name='LiteratureVersionConflictError'} }
export type LiteratureImporter=(bytes:Uint8Array,candidate:LiteratureCandidate,signal:AbortSignal,options?:LiteratureAcquireOptions)=>Promise<LiteratureImportReceipt>
function officialArxivUrl(value:string,kind:'metadata'|'pdf',id?:string):URL{
 const url=assertPublicUrl(value)
 const hosts=kind==='metadata'?['export.arxiv.org','arxiv.org']:['arxiv.org','export.arxiv.org','www.arxiv.org']
 const remoteId=extractArxivId(url.pathname)
 if(url.protocol!=='https:'||!hosts.includes(url.hostname)||url.port||url.search||kind==='metadata'&&!url.pathname.startsWith('/abs/')||kind==='pdf'&&!url.pathname.startsWith('/pdf/')||!remoteId||id&&remoteId!==id)throw new LiteratureError('source-policy','Only official arXiv paper/PDF sources for this work are allowed.',false)
 return url
}
export class LiteratureService {
 private stages?:LiteratureDownloadStore
 private versionDownloads=new Map<string,{bytes:Uint8Array;pdfUrl:string}>()
 constructor(private http:Pick<PublicHttpClient,'read'>=new PublicHttpClient(),private importer?:LiteratureImporter,stagingRoot?:string){if(stagingRoot)this.stages=new LiteratureDownloadStore(stagingRoot)}
 async search(input:LiteratureSearchInput,signal:AbortSignal):Promise<LiteratureCandidate[]>{
  boundedText(input.query,2000);const limit=input.limit??10
  if(!Number.isInteger(limit)||limit<1||limit>50||input.provider&&!['arxiv','crossref','all'].includes(input.provider))throw Error('Invalid scholarly search budget')
  const queryIdentity=extractLiteratureIdentity({rawText:input.query}),explicit=extractLiteratureIdentity({...queryIdentity,...input.identity})
  const arxivId=explicit.arxivId??queryIdentity.arxivId,queryDoi=explicit.doi??normalizeDoi(input.query)
  const identity:LiteratureIdentity={...explicit,...(arxivId?{arxivId}:{}),...(queryDoi?{doi:queryDoi}:{})}
  const text=explicit.title??input.query,quoted='"'+text.replace(/["\\]/g,' ').trim()+'"'
  const keywords=(input.query.match(/[\p{L}\p{N}]+(?:[._-][\p{L}\p{N}]+)*/gu)??[]).map(term=>'all:'+term).join(' AND ')
  const expression=explicit.title?'ti:'+quoted:queryDoi&&(normalizeDoi(input.query)||queryIdentity.doi)?'all:"'+queryDoi+'"':keywords
  if(!arxivId&&!expression)throw Error('Search query lacks usable keywords or an identity')
  const query:Record<string,string>=arxivId?{id_list:arxivId,max_results:String(limit)}:{search_query:expression,start:'0',max_results:String(limit)}
  const url='https://export.arxiv.org/api/query?'+new URLSearchParams(query).toString()
  let body:string
  try{if(signal.aborted)throw Error('cancelled');const response=await this.http.read(url,signal,2_000_000,{validateUrl:value=>{const parsed=assertPublicUrl(value);if(parsed.protocol!=='https:'||!['arxiv.org','export.arxiv.org'].includes(parsed.hostname)||parsed.pathname!=='/api/query')throw new LiteratureError('source-policy','Only the official arXiv metadata API is allowed.',false)}});body=Buffer.from(response.bytes).toString('utf8')}catch(error){throw literatureNetworkError(error,signal)}
  if(!/<feed[\s>]/.test(body)||/<(?:\w+:)?error[\s>]/i.test(body))throw new LiteratureError('invalid-metadata','arXiv returned invalid metadata. Retry explicitly.',true)
  const byWork=new Map<string,LiteratureCandidate>()
  for(const match of body.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)){
   const entry=match[1],raw=xml(entry,'id'),id=extractArxivId(raw)
   if(!id){if(/api\/errors|<title>\s*Error/i.test(entry))throw new LiteratureError('invalid-metadata','arXiv rejected the metadata query. Retry explicitly.',true);continue}
   if(arxivId&&(arxivCore(arxivId)!==arxivCore(id)||/v\d+$/.test(arxivId)&&arxivId!==id))continue
   const title=xml(entry,'title').slice(0,2000),authors=[...entry.matchAll(/<author(?:\s[^>]*)?>([\s\S]*?)<\/author>/g)].map(a=>xml(a[1],'name')).filter(Boolean).slice(0,100)
   if(!title)continue
   const candidate:LiteratureCandidate={id:candidateId(id),provider:'arxiv',title,authors,arxivId:id,sourceUrl:'https://arxiv.org/abs/'+id,pdfUrls:['https://arxiv.org/pdf/'+id],abstract:xml(entry,'summary').slice(0,20_000),year:Number(xml(entry,'published').slice(0,4))||undefined,version:id.match(/v\d+$/)?.[0],assessment:'uncertain',reasons:[]}
   const arxivDoi=normalizeDoi(xml(entry,'arxiv:doi'));if(arxivDoi)candidate.doi=arxivDoi
   const inferred=normalize(title)===normalize(input.query)?{...identity,title:identity.title??input.query}:identity
   Object.assign(candidate,assessLiteratureIdentity(inferred,candidate))
   const core=arxivCore(id),previous=byWork.get(core),version=Number(id.match(/v(\d+)$/)?.[1]??0),oldVersion=Number(previous?.arxivId?.match(/v(\d+)$/)?.[1]??0)
   if(!previous||version>oldVersion)byWork.set(core,candidate)
  }
  const rank={consistent:0,uncertain:1,conflict:2}
  return [...byWork.values()].sort((a,b)=>rank[a.assessment]-rank[b.assessment]).slice(0,limit)
 }
 async resolvePdfLinks(candidate:LiteratureCandidate,_signal:AbortSignal):Promise<string[]>{
  if(candidate.provider!=='arxiv')throw new LiteratureError('source-policy','Historical non-arXiv candidates cannot be downloaded. Search arXiv again.',false)
  const id=extractArxivId(candidate.arxivId)??extractArxivId(candidate.sourceUrl)
  if(!id)throw new LiteratureError('source-policy','Candidate lacks an official arXiv identity. Search arXiv again.',false)
  officialArxivUrl(candidate.sourceUrl,'metadata',id)
  return ['https://arxiv.org/pdf/'+id]
 }
 private async importDownloaded(candidate:LiteratureCandidate,bytes:Uint8Array,pdfUrl:string,signal:AbortSignal,onStage:((stage:'downloading'|'importing')=>Promise<void>|void)|undefined,options?:LiteratureAcquireOptions):Promise<LiteratureImportReceipt>{
  if(signal.aborted)throw new LiteratureError('cancelled','arXiv acquisition cancelled.',true)
  const stage=await this.stages?.stage(candidate,pdfUrl,bytes,signal)
  if(signal.aborted)throw new LiteratureError('cancelled','arXiv acquisition cancelled.',true)
  await onStage?.('importing')
  try{
   const receipt=await this.importer!(bytes,structuredClone(candidate),signal,options)
   if(receipt.sha256!==createHash('sha256').update(bytes).digest('hex'))throw Error('Managed PDF import hash receipt does not match downloaded bytes')
   if(stage)await this.stages!.finish(stage,receipt);this.versionDownloads.delete(candidate.id);return receipt
  }catch(error){
   if(error instanceof LiteratureVersionConflictError){if(this.versionDownloads.size>=4&&!this.versionDownloads.has(candidate.id))this.versionDownloads.delete(this.versionDownloads.keys().next().value!);this.versionDownloads.set(candidate.id,{bytes:new Uint8Array(bytes),pdfUrl})}
   if(stage)await this.stages!.finish(stage)
   if(error instanceof LiteratureVersionConflictError)throw error
   if(signal.aborted)throw new LiteratureError('cancelled','arXiv acquisition cancelled.',true)
   throw new LiteratureError('import-failed','arXiv PDF validated, but library import failed. Retry explicitly.',true)
  }
 }
 async acquire(candidate:LiteratureCandidate,signal:AbortSignal,onStage?:(stage:'downloading'|'importing')=>Promise<void>|void,options?:LiteratureAcquireOptions):Promise<LiteratureImportReceipt>{
  if(!this.importer)throw new LiteratureError('import-failed','Managed import capability is unavailable.',true)
  if(candidate.assessment==='conflict')throw new LiteratureError('source-policy','Candidate identity conflicts; review a different candidate.',false)
  const urls=await this.resolvePdfLinks(candidate,signal),id=extractArxivId(candidate.arxivId)??extractArxivId(candidate.sourceUrl)!
  if(options?.allowNewVersion!==undefined&&typeof options.allowNewVersion!=='boolean')throw Error('Invalid version import choice')
  const retained=this.versionDownloads.get(candidate.id)
  if(options?.allowNewVersion&&retained){officialArxivUrl(retained.pdfUrl,'pdf',id);return this.importDownloaded(candidate,new Uint8Array(retained.bytes),retained.pdfUrl,signal,onStage,options)}
  if(signal.aborted)throw new LiteratureError('cancelled','arXiv acquisition cancelled.',true)
  await onStage?.('downloading')
  let response:Awaited<ReturnType<PublicHttpClient['read']>>
  try{response=await this.http.read(urls[0],signal,50_000_000,{validateUrl:value=>{officialArxivUrl(value,'pdf',id)}});officialArxivUrl(response.url,'pdf',id)}catch(error){throw literatureNetworkError(error,signal)}
  if(signal.aborted)throw new LiteratureError('cancelled','arXiv acquisition cancelled.',true)
  const bytes=new Uint8Array(response.bytes)
  if(bytes.length>50_000_000)throw new LiteratureError('resource-limit','arXiv PDF exceeds the download byte limit.',false)
  if(bytes.length<8||Buffer.from(bytes.subarray(0,5)).toString()!=='%PDF-')throw new LiteratureError('non-pdf','arXiv returned a non-PDF response. Retry explicitly.',true)
  if(!/%%EOF\s*$/.test(Buffer.from(bytes.subarray(Math.max(0,bytes.length-2048))).toString()))throw new LiteratureError('invalid-pdf','arXiv PDF is incomplete or invalid. Retry explicitly.',true)
  let pageCount:number
  try{pageCount=(await PDFDocument.load(bytes,{ignoreEncryption:false,throwOnInvalidObject:true})).getPageCount()}catch{throw new LiteratureError('invalid-pdf','arXiv PDF is malformed, encrypted or unparseable. Retry explicitly.',true)}
  if(pageCount<1||pageCount>10_000)throw new LiteratureError('resource-limit','arXiv PDF page count exceeds resource limits.',false)
  return this.importDownloaded({...candidate,arxivId:id},bytes,response.url,signal,onStage,options)
 }
}
