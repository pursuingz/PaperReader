import type { LocalInputOwner } from '../../shared/localInputTypes'
interface DraftSession { id: string; owner: LocalInputOwner; base: string; partial: string; expected: string; detached: boolean }
const sameOwner = (a: LocalInputOwner, b: LocalInputOwner) => a.conversationId === b.conversationId && a.contextRevision === b.contextRevision && a.draftRevision === b.draftRevision
const join = (a: string, b: string) => [a,b].filter(Boolean).join('\n')
export class VoiceDraftProjection {
 private active: DraftSession | null = null
 begin(id: string, owner: LocalInputOwner, draft: string): void { this.active={id,owner:{...owner},base:draft,partial:'',expected:draft,detached:false} }
 preview(id: string, text: string, owner: LocalInputOwner, draft: string, current: LocalInputOwner): string | null {
  const s=this.active;if(!s||s.id!==id||!sameOwner(s.owner,owner))return null
  if(s.detached||!sameOwner(owner,current)||draft!==s.expected){s.detached=true;return null}
  s.partial=text.trim();s.expected=join(s.base,s.partial);return s.expected
 }
 finish(id: string, text: string, owner: LocalInputOwner, draft: string, current: LocalInputOwner, send: boolean): {text:string;send:boolean;detached:boolean}|null {
  const s=this.active;if(!s||s.id!==id||!sameOwner(s.owner,owner))return null
  this.active=null
  const detached=s.detached||!sameOwner(owner,current)||draft!==s.expected
  const final=text.trim()||s.partial
  let result=draft
  if(draft===s.expected)result=join(s.base,final)
  else if(final&&!draft.includes(final)){
   if(s.partial&&final.startsWith(s.partial)&&draft.endsWith(s.partial))result=draft+final.slice(s.partial.length)
   else result=join(draft,final)
  }
  return {text:result,send:send&&!detached&&!!final,detached}
 }
}
