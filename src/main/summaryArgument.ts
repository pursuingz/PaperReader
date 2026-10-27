import type { SummarySection } from '../shared/types'
import { SUMMARY_SECTION_IDS } from './validation'
import { SummaryValidationError } from './summaryErrors'
import { SUMMARY_POLICY } from './summaryPolicy'
import type { SummaryCoverage, SummaryEvidence, SummaryEvidenceField } from './summaryEvidence'

export const SUMMARY_WORKFLOW_VERSION = 1
const kinds = ['problem','claim','mechanism','support','boundary'] as const
export type SummaryArgumentKind = typeof kinds[number]
export interface SummaryArgumentPlan { paperType:'empirical'|'theoretical'|'systems'|'survey'|'conceptual'|'mixed'|'unknown'; rows:Array<{kind:SummaryArgumentKind;text:string;evidenceIds:string[]}> }
export interface SummaryDraft { sections:SummarySection[]; coverage:SummaryCoverage[]; argumentPlan?:SummaryArgumentPlan; sectionEvidenceIds?:Record<string,string[]>; missing:SummaryEvidenceField[] }
export interface SummaryRepairIssue { id:string;kind:'core-omission'|'unsupported-claim'|'condition-loss'|'relationship-error';severity:'core'|'supporting';sectionId:string;description:string;sourceIds:string[];evidenceIds:string[] }
const sectionsFor:Record<SummaryEvidenceField,string>={keywords:'keywords',problem:'background',gap:'background',approach:'methods',experiment:'results',claim:'results',limits:'limitations'}
const kindFor:Record<string,SummaryArgumentKind[]>={problem:['problem'],gap:['problem'],approach:['mechanism'],experiment:['support'],claim:['claim','support'],limits:['boundary']}
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const fail=():never=>{throw new SummaryValidationError('SCHEMA')}
export function parseSummaryArgument(value:unknown,evidence:SummaryEvidence[]):SummaryArgumentPlan {
 if(!record(value)||Object.keys(value).sort().join(',')!=='paperType,rows'||!['empirical','theoretical','systems','survey','conceptual','mixed','unknown'].includes(value.paperType as string)||!Array.isArray(value.rows)||!value.rows.length) return fail()
 if(value.rows.length>12)throw new SummaryValidationError('BUDGET')
 const known=new Set(evidence.map(note=>note.id));let characters=0,references=0
 const rows=value.rows.map((row:unknown)=>{
  if(!record(row)||Object.keys(row).sort().join(',')!=='evidenceIds,kind,text'||!kinds.includes(row.kind as SummaryArgumentKind)||typeof row.text!=='string'||!row.text.trim()||!Array.isArray(row.evidenceIds)||new Set(row.evidenceIds).size!==row.evidenceIds.length||row.evidenceIds.some(id=>typeof id!=='string'||!known.has(id)))return fail()
  characters+=row.text.length;references+=row.evidenceIds.length
  if(row.text.length>1200||characters>8000||references>320)throw new SummaryValidationError('BUDGET')
  if(!row.evidenceIds.length&&!/unknown|unavailable|not (?:reported|provided|specified)|insufficient|未知|未(?:提供|报告|说明)|不足|无法确定/i.test(row.text))return fail()
  return {kind:row.kind as SummaryArgumentKind,text:row.text,evidenceIds:row.evidenceIds as string[]}
 })
 return {paperType:value.paperType as SummaryArgumentPlan['paperType'],rows}
}
export function summaryLocalIssues(draft:SummaryDraft,evidence:SummaryEvidence[]):SummaryRepairIssue[]{
 const issues:SummaryRepairIssue[]=draft.missing.map(field=>({id:`coverage-${field}`,kind:'core-omission',severity:'core',sectionId:sectionsFor[field],description:'A supported core field, source correspondence or adopted fact is absent from its section.',sourceIds:[],evidenceIds:evidence.filter(note=>note.field===field&&(note.importance??'core')==='core').map(note=>note.id)}))
 for(const note of evidence){
  if(note.field==='keywords'||note.importance==='supporting')continue
  if(draft.sectionEvidenceIds ? !((note.field === 'experiment' ? ['methods','results'] : [sectionsFor[note.field]]).some(id => draft.sectionEvidenceIds![id]?.includes(note.id))) : !draft.argumentPlan?.rows.some(row=>(kindFor[note.field]||[]).includes(row.kind)&&row.evidenceIds.includes(note.id)))issues.push({id:`argument-${note.id}`,kind:'core-omission',severity:'core',sectionId:sectionsFor[note.field],description:'A core scientific claim or its mechanism/support/boundary is absent from the argument outline.',sourceIds:[],evidenceIds:[note.id]})
 }
 if(issues.length>168)throw new SummaryValidationError('BUDGET')
 return issues
}
export function validateSummaryResolutions(value:unknown,issues:SummaryRepairIssue[],previous:SummaryDraft,current:SummaryDraft,evidence:SummaryEvidence[]):void{
 if(!Array.isArray(value)||value.length!==issues.length)return fail()
 const known=new Set(evidence.map(note=>note.id)),seen=new Set<string>()
 for(const item of value){
  if(!record(item)||Object.keys(item).sort().join(',')!=='evidenceIds,issueId,sectionId,status'||typeof item.issueId!=='string'||seen.has(item.issueId)||!['resolved','unresolved'].includes(item.status as string)||!Array.isArray(item.evidenceIds)||new Set(item.evidenceIds).size!==item.evidenceIds.length||item.evidenceIds.some(id=>typeof id!=='string'||!known.has(id)))return fail()
  const issue=issues.find(issue=>issue.id===item.issueId)
  if(!issue||item.sectionId!==issue.sectionId||!SUMMARY_SECTION_IDS.includes(item.sectionId as typeof SUMMARY_SECTION_IDS[number]))return fail()
  seen.add(item.issueId)
  const evidenceIds=item.evidenceIds as string[]
  {
   if(item.status!=='resolved')return fail()
   if(issue.severity==='core'&&issue.evidenceIds.some(id=>!evidenceIds.includes(id)))return fail()
   const before=previous.sections.find(section=>section.id===issue.sectionId)!,after=current.sections.find(section=>section.id===issue.sectionId)!
   const normalized=(text:string)=>text.replace(/\s+/g,' ').trim()
   const changed=normalized(before.content)!==normalized(after.content)||before.pages.join(',')!==after.pages.join(',')
   if(!issue.id.startsWith('argument-')&&!changed)return fail()
   const adopted=issue.sectionId==='overview'?new Set(evidence.map(note=>note.id)):new Set(current.coverage.filter(entry=>entry.sectionId===issue.sectionId).flatMap(entry=>entry.evidenceIds))
   if(evidenceIds.some(id=>!adopted.has(id)))return fail()
  }
 }
 if(issues.some(issue=>!seen.has(issue.id))||summaryLocalIssues(current,evidence).length)return fail()
}
export class SummaryJobBudgetError extends Error {constructor(){super('Summary generation exceeded its total request, source-payload or reserved final-verification budget. Continue explicitly to open a new bounded execution.');this.name='SummaryJobBudgetError'}}
export class SummaryJobBudget {
 readonly maxCalls:number
 private calls=0;private characters=0;private reservedCalls=0;private reservedCharacters=0
 private readonly started=Date.now();private rewriteDeadline=Infinity
 constructor(chunks:number){this.maxCalls=2*(chunks+4)}
 consume(payload:string):void{
  if(this.calls+1+this.reservedCalls>this.maxCalls||this.characters+payload.length+this.reservedCharacters>SUMMARY_POLICY.maxExecutionPayloadCharacters||Date.now()-this.started>=SUMMARY_POLICY.executionTimeoutMs||Date.now()>=this.rewriteDeadline)throw new SummaryJobBudgetError()
  this.calls++;this.characters+=payload.length
 }
 reserveFinalVerification(rewritePayload:string,verificationPayload:string):void{
  if(this.calls+4>this.maxCalls||this.characters+2*rewritePayload.length+2*verificationPayload.length>SUMMARY_POLICY.maxExecutionPayloadCharacters||Date.now()-this.started>SUMMARY_POLICY.executionTimeoutMs-2*SUMMARY_POLICY.requestTimeoutMs)throw new SummaryJobBudgetError()
  this.reservedCalls=2;this.reservedCharacters=2*verificationPayload.length
  this.rewriteDeadline=this.started+SUMMARY_POLICY.executionTimeoutMs-2*SUMMARY_POLICY.requestTimeoutMs
 }
 beginFinalVerification():void{this.reservedCalls=0;this.reservedCharacters=0;this.rewriteDeadline=Infinity}
 requestTimeout():number{return Math.max(1,Math.min(SUMMARY_POLICY.requestTimeoutMs,this.started+SUMMARY_POLICY.executionTimeoutMs-Date.now(),this.rewriteDeadline-Date.now()))}
}
