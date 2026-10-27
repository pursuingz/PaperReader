/** Safe local validation categories; never place source or provider text in an error. */
export type SummaryIssueCode = 'SOURCE_ID_INVALID' | 'JSON_SYNTAX' | 'JSON_ENCODING' | 'SCHEMA' | 'PAGE_OUT_OF_SCOPE' | 'QUOTE_NOT_IN_SOURCE' | 'NUMBER_MISMATCH' | 'UNIT_MISMATCH' | 'BUDGET'
const explanations: Record<SummaryIssueCode,string> = {
 SOURCE_ID_INVALID:'the response selected an unknown, duplicate or invalid source span identifier',
 JSON_SYNTAX:'the completed response was not valid JSON',
 JSON_ENCODING:'a decoded response string contained a prohibited control character; check literal backslash encoding',
 SCHEMA:'the response did not follow the required evidence/coverage structure',
 PAGE_OUT_OF_SCOPE:'a reference used a page outside the supplied source',
 QUOTE_NOT_IN_SOURCE:'a quoted excerpt did not match its supplied source page',
 NUMBER_MISMATCH:'a numerical value or condition did not match the evidence',
 UNIT_MISMATCH:'a measurement unit did not match the evidence',
 BUDGET:'the response exceeded a safe evidence or output limit'
}
const safeLocation=/^(?:response|evidence(?:\[\d{1,3}\])?(?:\.quotes(?:\[\d{1,2}\])?)?(?:\.(?:page|text|content|field)|\.sourceIds(?:\[\d{1,2}\])?)?|sections(?:\[\d{1,2}\])?(?:\.(?:content|pages))?|coverage(?:\[\d{1,2}\])?(?:\.evidenceIds)?)$/
export type SummaryJsonReason = 'EMPTY' | 'INVALID_ESCAPE' | 'UNESCAPED_CONTROL' | 'TRAILING_COMMA' | 'EXTRA_CONTENT' | 'INCOMPLETE' | 'OTHER' | 'CONTROL_CHARACTER'
const safeJsonReasons: readonly string[] = ['EMPTY','INVALID_ESCAPE','UNESCAPED_CONTROL','TRAILING_COMMA','EXTRA_CONTENT','INCOMPLETE','OTHER','CONTROL_CHARACTER']
export type SummaryBudgetMetric = 'characters' | 'references' | 'records' | 'source-spans' | 'normalized-characters'
export interface SummaryBudgetDiagnostic { observed: number; limit: number; metric: SummaryBudgetMetric; recoverable: boolean }
export class SummaryValidationError extends Error {
 readonly code:SummaryIssueCode
 readonly location:string
 readonly jsonReason?:SummaryJsonReason
 readonly budget?:SummaryBudgetDiagnostic
 constructor(code:SummaryIssueCode,location='response',jsonReason?:SummaryJsonReason,budget?:SummaryBudgetDiagnostic){
  const safeCode=Object.hasOwn(explanations,code)?code:'SCHEMA'
  const path=safeLocation.test(location)?location:'response'
  const reason=(safeCode==='JSON_SYNTAX'||safeCode==='JSON_ENCODING')&&jsonReason&&safeJsonReasons.includes(jsonReason)?jsonReason:undefined
  super(`Summary JSON/evidence validation [${safeCode}] at ${path}: ${explanations[safeCode]}.${reason?` Diagnostic: ${reason}.`:''}`)
  if(safeCode==='BUDGET'&&budget&&Number.isSafeInteger(budget.observed)&&budget.observed>=0&&Number.isSafeInteger(budget.limit)&&budget.limit>=0&&['characters','references','records','source-spans','normalized-characters'].includes(budget.metric)){this.budget={observed:budget.observed,limit:budget.limit,metric:budget.metric,recoverable:budget.recoverable===true};this.message+=` Observed ${budget.observed} ${budget.metric}; limit ${budget.limit}; local restructuring ${budget.recoverable?'available':'unavailable'}.`;}
  this.name='SummaryValidationError';this.code=safeCode;this.location=path;this.jsonReason=reason
 }
}
