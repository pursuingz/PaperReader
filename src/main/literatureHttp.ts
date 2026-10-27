import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { LiteratureError, literatureNetworkError } from './literatureErrors'

export interface PublicHttpResponse { url:string; status:number; headers:Record<string,string>; bytes:Uint8Array }
export interface PublicHttpReadPolicy { validateUrl?:(value:string)=>void }
export interface PublicHttpTransport {
 resolve(host:string):Promise<string[]>
 request(url:URL,addresses:string[],signal:AbortSignal,maxBytes:number):Promise<Omit<PublicHttpResponse,'url'>>
}
function publicAddress(address:string):boolean{
 const ip=address.replace(/^\[|\]$/g,'').toLowerCase()
 if(isIP(ip)===4){const [a,b,c]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113)}
 if(isIP(ip)===6){return /^[23]/.test(ip)&&!/^2001:(?:db8|0:|:)/.test(ip)&&!ip.startsWith('2002:')}
 return false
}
export function assertPublicUrl(value:string):URL{
 let u:URL;try{u=new URL(value)}catch{throw Error('Invalid public URL')}
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.hash||u.port&&u.port!=='443'&&u.port!=='80'||value.length>4096)throw Error('Public HTTP(S) URL without credentials is required')
 const host=u.hostname.replace(/^\[|\]$/g,'').toLowerCase()
 if(!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||isIP(host)&&!publicAddress(host))throw Error('Only public network destinations are allowed')
 return u
}
const cancelled=()=>new LiteratureError('cancelled','Public source request cancelled.',true)
function pause(milliseconds:number,signal:AbortSignal):Promise<void>{
 return new Promise((done,reject)=>{if(signal.aborted){reject(cancelled());return}const abort=()=>{clearTimeout(timer);reject(cancelled())},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);done()},milliseconds);signal.addEventListener('abort',abort,{once:true})})
}
function withAbort<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((done,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(cancelled())}
  signal.addEventListener('abort',abort,{once:true})
  void work.then(value=>{signal.removeEventListener('abort',abort);done(value)},error=>{signal.removeEventListener('abort',abort);reject(error)})
  if(signal.aborted)abort()
 })
}

export interface ArxivRequestClock { now():number; sleep(milliseconds:number,signal:AbortSignal):Promise<void> }
export class ArxivApiScheduler {
 private tail:Promise<void>=Promise.resolve()
 private nextStart=0
 constructor(private clock:ArxivRequestClock={now:Date.now,sleep:pause}){}
 async run<T>(signal:AbortSignal,work:()=>Promise<T>):Promise<T>{
  const previous=this.tail
  let release!:()=>void;const slot=new Promise<void>(done=>release=done);this.tail=previous.then(()=>slot)
  try{await withAbort(previous,signal);if(signal.aborted)throw cancelled();const remaining=this.nextStart-this.clock.now();if(remaining>0)await this.clock.sleep(remaining,signal);if(signal.aborted)throw cancelled();this.nextStart=this.clock.now()+3000;return await work()}finally{release()}
 }
}
const arxivApiScheduler=new ArxivApiScheduler()
const nativeTransport:PublicHttpTransport={
 resolve:async host=>(await lookup(host,{all:true,verbatim:true})).map(x=>x.address),
 request:(url,addresses,signal,maxBytes)=>new Promise((done,reject)=>{
  const request=url.protocol==='https:'?httpsRequest:httpRequest
  const address=addresses[0];let timedOut=false;const req=request(url,{signal,method:'GET',family:isIP(address),headers:{'User-Agent':'PaperReader scholarly metadata and public PDF acquisition','Accept':'application/pdf,application/atom+xml,application/json,text/html;q=0.8'},lookup:(_host,_options,callback)=>callback(null,address,isIP(address))},res=>{
   const headers:Record<string,string>={};for(const [key,value] of Object.entries(res.headers))if(value!==undefined)headers[key]=Array.isArray(value)?value.join(', '):value
   if(Number(headers['content-length'])>maxBytes){res.destroy();reject(new LiteratureError('resource-limit','Public response exceeds download byte limit.',false));return}
   const chunks:Buffer[]=[];let length=0
   res.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>maxBytes){res.destroy();reject(new LiteratureError('resource-limit','Public response exceeds download byte limit.',false))}else chunks.push(chunk)})
   res.on('end',()=>done({status:res.statusCode??0,headers,bytes:Buffer.concat(chunks)}));res.on('error',()=>reject(signal.aborted?cancelled():timedOut?new LiteratureError('timeout','Public source transfer timed out. Retry explicitly.',true):new LiteratureError('network','Public source transfer failed. Retry explicitly.',true)))
  });req.setTimeout(12_000,()=>{timedOut=true;req.destroy(new Error('Public source inactivity timeout'))});req.on('error',()=>reject(signal.aborted?cancelled():timedOut?new LiteratureError('timeout','Public source connection timed out. Retry explicitly.',true):new LiteratureError('network','Public source connection failed. Retry explicitly.',true)));req.end()
 })
}
export class PublicHttpClient {
 private active=0
 private waiting:Array<()=>void>=[]
 constructor(private transport:PublicHttpTransport=nativeTransport,private apiScheduler=arxivApiScheduler){}
 async read(value:string,signal:AbortSignal,maxBytes=2_000_000,policy?:PublicHttpReadPolicy):Promise<PublicHttpResponse>{
  const url=assertPublicUrl(value);policy?.validateUrl?.(url.href)
  const work=()=>this.readLimited(value,signal,maxBytes,policy)
  return ['arxiv.org','export.arxiv.org'].includes(url.hostname)&&url.pathname==='/api/query'?this.apiScheduler.run(signal,work):work()
 }
 private async readLimited(value:string,signal:AbortSignal,maxBytes:number,policy?:PublicHttpReadPolicy):Promise<PublicHttpResponse>{
  while(this.active>=2){await new Promise<void>((done,reject)=>{const wake=()=>{signal.removeEventListener('abort',abort);done()},abort=()=>{const index=this.waiting.indexOf(wake);if(index>=0)this.waiting.splice(index,1);reject(cancelled())};this.waiting.push(wake);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()})}
  if(signal.aborted)throw cancelled();this.active++
  try{return await this.readOwned(value,signal,maxBytes,policy)}finally{this.active--;this.waiting.shift()?.()}
 }
 private async readOwned(value:string,signal:AbortSignal,maxBytes:number,policy?:PublicHttpReadPolicy):Promise<PublicHttpResponse>{
  if(!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>50_000_000)throw Error('Invalid download byte budget')
  const timeout=AbortSignal.timeout(45_000),combined=AbortSignal.any([signal,timeout]);let current=value
  const failure=(error:unknown)=>signal.aborted?cancelled():timeout.aborted?new LiteratureError('timeout','Public source request timed out. Retry explicitly.',true):literatureNetworkError(error,signal)
  for(let hop=0;hop<=5;hop++){
   if(combined.aborted)throw failure(undefined)
   const url=assertPublicUrl(current);policy?.validateUrl?.(url.href)
   const host=url.hostname.replace(/^\[|\]$/g,'');let addresses:string[]
   try{addresses=isIP(host)?[host]:await withAbort(this.transport.resolve(host),combined)}catch(error){throw failure(error)}
   if(!addresses.length||addresses.some(a=>!publicAddress(a)))throw new LiteratureError('source-policy','Resolved source is not a public network destination.',false)
   let response:Omit<PublicHttpResponse,'url'>|undefined,last:unknown
   for(const address of [...new Set(addresses)].slice(0,4)){
    if(combined.aborted)throw failure(undefined)
    try{response=await withAbort(this.transport.request(url,[address],combined,maxBytes),combined);break}catch(error){last=error;if(error instanceof LiteratureError&&!['network','timeout'].includes(error.code))throw failure(error)}
   }
   if(!response)throw failure(last)
   if(combined.aborted)throw failure(undefined)
   if(response.bytes.length>maxBytes)throw new LiteratureError('resource-limit','Public response exceeds download byte limit.',false)
   if([301,302,303,307,308].includes(response.status)){if(!response.headers.location)throw new LiteratureError('network','Public source returned an invalid redirect.',true);current=new URL(response.headers.location,url).href;assertPublicUrl(current);policy?.validateUrl?.(current);continue}
   if(response.status<200||response.status>=300)throw new LiteratureError(response.status===429?'rate-limited':'network',response.status===429?'arXiv rate limit (HTTP 429). Retry later.':"Public source unavailable (HTTP "+response.status+'). Retry explicitly.',true,response.status,host)
   return {...response,url:url.href}
  }throw new LiteratureError('network','Too many public source redirects. Retry explicitly.',true)
 }
}
