import type { AIImageOrigin, AIImageReference, ChatNotesSelection, ChatNotesSnapshot } from '../shared/aiSourceTypes'
import { AI_IMAGE_BYTES_LIMIT, AI_IMAGE_LIMIT, AI_IMAGES_TOTAL_BYTES_LIMIT } from '../shared/aiSourceTypes'
const obj=(v:unknown):Record<string,any>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid AI source object');return v as Record<string,any>}
const fields=(v:Record<string,any>,keys:string[])=>{if(Object.keys(v).some(k=>!keys.includes(k)))throw Error('Invalid AI source fields')}
const str=(v:unknown,max=100000)=>{if(typeof v!=='string'||v.length>max)throw Error('Invalid AI source text');return v}
const id=(v:unknown)=>{if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(str(v,80)))throw Error('Invalid AI source identifier')}
const num=(v:unknown,min:number,max:number,integer=false)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max||(integer&&!Number.isSafeInteger(v)))throw Error('Invalid AI source dimensions or page')}
export function validateAIImageOrigin(value:unknown):asserts value is AIImageOrigin {
 const v=obj(value)
 if(v.kind==='pdf-capture'){fields(v,['kind','page','rect']);num(v.page,1,100000,true);const r=obj(v.rect);fields(r,['x','y','width','height']);num(r.x,0,1);num(r.y,0,1);num(r.width,Number.MIN_VALUE,1);num(r.height,Number.MIN_VALUE,1);if(r.x+r.width>1+1e-6||r.y+r.height>1+1e-6)throw Error('Invalid capture rectangle')}
 else if(v.kind==='canvas'){fields(v,['kind','pageId','pageName','region']);id(v.pageId);str(v.pageName,1000);const r=obj(v.region);fields(r,['x','y','width','height']);num(r.x,-10000000,10000000);num(r.y,-10000000,10000000);num(r.width,Number.MIN_VALUE,20000000);num(r.height,Number.MIN_VALUE,20000000)}
 else throw Error('Invalid AI image provenance')
}
export function validateAIImageReference(value:unknown):asserts value is AIImageReference {
 const v=obj(value);fields(v,['imageId','sha256','mimeType','width','height','byteLength','origin']);id(v.imageId)
 if(!/^[0-9a-f]{64}$/.test(str(v.sha256,64))||!['image/png','image/jpeg'].includes(v.mimeType))throw Error('Invalid AI image hash or media type')
 num(v.width,1,4096,true);num(v.height,1,4096,true);if(v.width*v.height>16000000)throw Error('AI image pixel limit exceeded');num(v.byteLength,1,AI_IMAGE_BYTES_LIMIT,true);validateAIImageOrigin(v.origin)
}
export function validateAIImages(value:unknown):AIImageReference[] {
 if(!Array.isArray(value)||value.length>AI_IMAGE_LIMIT*2)throw Error('AI image limit exceeded: choose at most 8 images')
 const refs=new Map<string,AIImageReference>()
 for(const image of value){validateAIImageReference(image);const previous=refs.get(image.imageId);if(previous&&JSON.stringify(previous)!==JSON.stringify(image))throw Error('Conflicting immutable image references');refs.set(image.imageId,image)}
 const result=[...refs.values()];if(result.length>AI_IMAGE_LIMIT)throw Error('AI image limit exceeded: choose at most 8 images')
 if(result.reduce((n,r)=>n+r.byteLength,0)>AI_IMAGES_TOTAL_BYTES_LIMIT)throw Error('AI images exceed the 16 MiB combined limit; reduce the selected scope')
 return result
}
export function validateChatNotesSelection(value:unknown):asserts value is ChatNotesSelection {
 const s=obj(value);fields(s,['text','highlights','mindMap','canvas','canvasScope','canvasPageIds'])
 for(const k of ['text','highlights','mindMap','canvas'])if(typeof s[k]!=='boolean')throw Error('Invalid notes source selection')
 if(!['current','selected','all'].includes(s.canvasScope)||!Array.isArray(s.canvasPageIds)||s.canvasPageIds.length>1000||new Set(s.canvasPageIds).size!==s.canvasPageIds.length)throw Error('Invalid canvas selection')
 s.canvasPageIds.forEach(id)
 if(!s.canvas&&s.canvasPageIds.length)throw Error('Unselected Canvas selection must be empty')
 if(s.canvas&&((s.canvasScope==='current'&&s.canvasPageIds.length!==1)||(s.canvasScope==='selected'&&!s.canvasPageIds.length)))throw Error('Invalid frozen current/selected Canvas selection')
}
export function validateChatNotesSnapshot(value:unknown):asserts value is ChatNotesSnapshot {
 const v=obj(value);fields(v,['version','selection','text','highlights','mindMap','canvas','images','coverage']);if(v.version!==1)throw Error('Invalid notes source version')
 validateChatNotesSelection(v.selection);const s=v.selection
 let chars=0
 if(v.text!==undefined){if(!s.text)throw Error('Unselected Text source');chars+=str(v.text).length}
 if(v.highlights!==undefined){if(!s.highlights||!Array.isArray(v.highlights)||v.highlights.length>2000)throw Error('Invalid highlights source');const ids=new Set<string>();for(const h of v.highlights){obj(h);fields(h,['id','page','quote','comment']);id(h.id);if(ids.has(h.id))throw Error('Duplicate highlight source');ids.add(h.id);num(h.page,1,100000,true);chars+=str(h.quote).length+str(h.comment).length}}
 if(v.mindMap!==undefined){if(!s.mindMap)throw Error('Unselected Mind map');const m=obj(v.mindMap);fields(m,['nodes']);if(!Array.isArray(m.nodes)||m.nodes.length>5000)throw Error('Invalid mind map nodes');const ids=new Set<string>();for(const n of m.nodes){obj(n);fields(n,['id','parentId','order','text']);id(n.id);if(ids.has(n.id))throw Error('Duplicate mind map node');ids.add(n.id);if(n.parentId!==null)id(n.parentId);num(n.order,0,100000,true);chars+=str(n.text).length}const parents=new Map(m.nodes.map((n:any)=>[n.id,n.parentId]));for(const n of m.nodes){const visited=new Set<string>();let p:string|null=n.id;while(p!==null){if(visited.has(p)||!parents.has(p))throw Error('Invalid mind map hierarchy');visited.add(p);p=parents.get(p) as string|null}}}
 if(v.canvas!==undefined){if(!s.canvas||!Array.isArray(v.canvas)||v.canvas.length>1000)throw Error('Invalid Canvas source');const ids=new Set<string>();for(const b of v.canvas){obj(b);fields(b,['pageId','name','content']);id(b.pageId);if(ids.has(b.pageId))throw Error('Duplicate Canvas board');ids.add(b.pageId);chars+=str(b.name,1000).length+str(b.content).length}}
 const images=validateAIImages(v.images);if(images.length!==v.images.length)throw Error('Duplicate notes images');if(images.length&&!s.canvas)throw Error('Unselected Canvas images')
 const c=obj(v.coverage);fields(c,['canvasPageIds','imageCount']);if(!Array.isArray(c.canvasPageIds)||c.canvasPageIds.length>1000||new Set(c.canvasPageIds).size!==c.canvasPageIds.length||c.imageCount!==images.length)throw Error('Invalid notes coverage');c.canvasPageIds.forEach(id)
 if(JSON.stringify(s.canvasPageIds)!==JSON.stringify(c.canvasPageIds))throw Error('Frozen Canvas selection does not match captured coverage')
 if(JSON.stringify(c.canvasPageIds)!==JSON.stringify((v.canvas??[]).map((b:any)=>b.pageId)))throw Error('Canvas coverage does not match captured boards')
 if(images.some(r=>r.origin.kind!=='canvas'||!c.canvasPageIds.includes(r.origin.pageId)))throw Error('Image provenance does not match notes Canvas boards')
 if(chars>100000)throw Error('Selected Notes exceed the 100000 character AI limit; reduce the selected scope')
}
export function hasChatNotes(snapshot:ChatNotesSnapshot):boolean{return Boolean(snapshot.text?.trim()||snapshot.highlights?.some(h=>h.quote.trim()||h.comment.trim())||snapshot.mindMap?.nodes.some(n=>n.text.trim())||snapshot.canvas?.some(b=>b.content.trim())||snapshot.images.length)}
