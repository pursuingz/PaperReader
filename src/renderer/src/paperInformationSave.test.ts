import test from 'node:test'
import assert from 'node:assert/strict'
import { PaperInformationSaveSession } from './paperInformationSave'

const original={title:'Original title',authors:'Original author',year:2026}
const revised={title:'Revised title',authors:'Original author',year:2026}

test('paper information saves only changed fields and binds inactive-paper identity',async()=>{
 const session=new PaperInformationSaveSession('inactive-paper',original,'category-a'),calls:string[]=[]
 const actions={metadata:async(id:string)=>{calls.push('metadata:'+id)},category:async(id:string,category:string|null)=>{calls.push('category:'+id+':'+category)}}
 await session.save(original,'category-a',actions);assert.deepEqual(calls,[])
 await session.save(original,'category-b',actions);assert.deepEqual(calls,['category:inactive-paper:category-b'])
 await session.save(revised,'category-b',actions);assert.deepEqual(calls,['category:inactive-paper:category-b','metadata:inactive-paper'])
})

test('metadata failure leaves category unmodified and a retry saves both drafts',async()=>{
 const session=new PaperInformationSaveSession('paper',original,null),calls:string[]=[]
 let fail=true
 const actions={metadata:async()=>{calls.push('metadata');if(fail)throw Error('Disk unavailable')},category:async()=>{calls.push('category')}}
 await assert.rejects(session.save(revised,'category-b',actions),/category has not been changed.*Disk unavailable/i)
 assert.deepEqual(calls,['metadata']);fail=false
 await session.save(revised,'category-b',actions);assert.deepEqual(calls,['metadata','metadata','category'])
})

test('category failure reports partial success and retry skips already saved metadata',async()=>{
 const session=new PaperInformationSaveSession('paper',original,'category-a'),calls:string[]=[]
 let fail=true
 const actions={metadata:async()=>{calls.push('metadata')},category:async()=>{calls.push('category');if(fail)throw Error('Category locked')}}
 await assert.rejects(session.save(revised,'category-b',actions),/paper information is saved.*category could not be saved.*Category locked/i)
 assert.deepEqual(calls,['metadata','category']);fail=false
 await session.save(revised,'category-b',actions);assert.deepEqual(calls,['metadata','category','category'])
})

test('editing metadata after partial success saves the new draft and retains the category selection',async()=>{
 const session=new PaperInformationSaveSession('paper',original,null),saved:string[]=[]
 let fail=true
 const actions={metadata:async(_id:string,input:typeof original)=>{saved.push(input.title)},category:async()=>{if(fail)throw Error('Locked')}}
 await assert.rejects(session.save(revised,'category-b',actions))
 fail=false;await session.save({...revised,title:'Further revision'},'category-b',actions)
 assert.deepEqual(saved,['Revised title','Further revision'])
})

test('unavailable categories never write assignment while metadata remains editable',async()=>{
 const session=new PaperInformationSaveSession('paper',original),calls:string[]=[]
 const actions={metadata:async()=>{calls.push('metadata')},category:async()=>{calls.push('category')}}
 await session.save(revised,undefined,actions);assert.deepEqual(calls,['metadata'])
 await assert.rejects(session.save(revised,null,actions),/categories must load/i)
 session.captureCategory('category-a');await session.save(revised,'category-a',actions)
 assert.deepEqual(calls,['metadata']);await session.save(revised,null,actions);assert.deepEqual(calls,['metadata','category'])
})

test('category snapshot adoption cannot replace a known saved baseline',async()=>{
 const session=new PaperInformationSaveSession('paper',original,'category-a'),saved:Array<string|null>=[]
 const actions={metadata:async()=>{},category:async(_id:string,id:string|null)=>{saved.push(id)}}
 await session.save(original,'category-b',actions);session.captureCategory('category-a')
 await session.save(original,'category-b',actions);assert.deepEqual(saved,['category-b'])
})
