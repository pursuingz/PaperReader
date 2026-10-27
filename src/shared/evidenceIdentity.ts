export function canonicalEvidenceKey(label:string,kind?:string):string|null {
 const match=/^(Figure|Fig\.?|Table|图|表)\s*(S?\d+(?:[.-]\d+)*|[IVX]+|[一二三四五六七八九十百零〇]+)(?=$|[\s.:：)\-])/i.exec(label.trim())
 if(!match)return null
 const type=kind??(/^(?:Table|表)$/i.test(match[1])?'table':'figure')
 return `${type}:${match[2].toLowerCase()}`
}
export function compatibleCaption(first:string,second:string):boolean {
 const normalize=(text:string)=>text.replace(/^(?:Figure|Fig\.?|Table|图|表)\s*/i,'').toLowerCase().replace(/\s+/g,' ').trim()
 const a=normalize(first),b=normalize(second)
 return a===b||Math.min(a.length,b.length)>=20&&(a.startsWith(b)||b.startsWith(a))
}
