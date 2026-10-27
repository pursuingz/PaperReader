import type {EvidenceKind,PaperSourceEntry,SummaryEvidenceManifest} from '../../shared/types'
import {canonicalEvidenceKey,compatibleCaption} from '../../shared/evidenceIdentity'
const natural=new Intl.Collator('en',{numeric:true,sensitivity:'base'})
const bodyMention=(text:string)=>/^(?:Figure|Fig\.?|Table|图|表)\s*(?:S?\d+(?:[.-]\d+)*)\s*(?:\([a-z]\)\s*)?(?:shows?|illustrates?|is|are|was|were|presents?|demonstrates?|depicts?|summarizes?|compares?|provides?|describes?|contains?|reports?)\b/i.test(text.trim())
const continued=(text:string)=>/\bcontinued\b|续图|续表|接上页/i.test(text)
function order(entry:PaperSourceEntry){const key=canonicalEvidenceKey(entry.label,entry.kind)?.split(':')[1]??null;return{key,supplement:Boolean(key&&/^s\d/i.test(key))}}
function quality(entry:PaperSourceEntry,manifest?:SummaryEvidenceManifest|null){const crop=manifest?.crops.find(c=>c.entryId===entry.id&&c.kind===entry.kind&&c.caption===entry.text&&entry.pages.includes(c.page));return crop?.method==='manual'?100:crop?.algorithmVersion===2&&crop.status==='ready'?10+crop.confidence:/^(?:Figure|Table|图|表)/i.test(entry.label)?1:0}
/** Presentation projection only: original source IDs, cached crops and raw index order stay untouched. */
export function projectEvidenceEntries(entries:PaperSourceEntry[],kind:EvidenceKind,manifest?:SummaryEvidenceManifest|null):PaperSourceEntry[]{
 const chosen:PaperSourceEntry[]=[]
 for(const entry of entries){if(entry.kind!==kind||bodyMention(entry.text))continue
  const key=canonicalEvidenceKey(entry.label,kind),duplicate=key&&!continued(entry.text)?chosen.findIndex(other=>canonicalEvidenceKey(other.label,kind)===key&&!continued(other.text)&&other.pages.join(',')===entry.pages.join(',')&&compatibleCaption(other.text,entry.text)):-1
  if(duplicate>=0){if(quality(entry,manifest)>quality(chosen[duplicate],manifest))chosen[duplicate]=entry}else chosen.push(entry)
 }
 return chosen.map((entry,index)=>({entry,index,...order(entry)})).sort((a,b)=>a.key&&b.key?(Number(a.supplement)-Number(b.supplement)||natural.compare(a.key,b.key)||a.index-b.index):a.key?-1:b.key?1:a.index-b.index).map(value=>value.entry)
}
