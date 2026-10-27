import { Check, ChevronDown, FileText, LoaderCircle, Play, Square } from 'lucide-react'
import type { AgentReceipt } from '../../../shared/agentTypes'
import type { AgentChatTurn } from '../../../shared/agentChatTypes'
import { hasAgentTurnActivity } from '../agentChatProjection'

export interface AgentTurnActivityProps {
 turn: AgentChatTurn
 busy?: boolean
 placement?: 'activity' | 'results' | 'all'
 onContinue?: (turn: AgentChatTurn, selectionId?: string) => void
 onCancel?: (turn: AgentChatTurn) => void
 onOpenPaper?: (paperId: string) => void
 onReceipt?: (turn: AgentChatTurn, receipt: AgentReceipt, index: number) => void
}
const labels:Record<string,string>={list_library:'Reading library metadata',read_paper:'Reading source material',select_paper:'Choosing a paper',scan_folder:'Scanning original PDFs',import_folder_papers:'Importing original PDFs',list_categories:'Reading categories',create_category:'Creating a category',assign_category:'Organizing papers',search_literature:'Searching arXiv',acquire_candidate:'Acquiring an arXiv paper',generate_summary:'Generating a summary',generate_reading_notes:'Writing reading notes',list_reading_drafts:'Reading saved drafts',read_reading_draft:'Reading a saved draft',append_reading_draft:'Appending reading notes',organize_notes:'Organizing notes',export_content:'Exporting files'}
const receiptStatus:Record<string,string>={succeeded:'Saved','already-exists':'Already saved',unavailable:'Unavailable','needs-review':'Review needed'}
function activityLabel(turn:AgentChatTurn):string{
 const running=[...turn.steps].reverse().find(step=>step.status==='running')
 if(running)return labels[running.tool]??'Working on the requested operation'
 if(turn.status==='waiting-selection')return 'Choose a paper to continue'
 if(turn.status==='running'||turn.status==='queued')return 'Preparing the next activity'
 if(turn.status==='partial')return 'Some work remains'
 if(turn.status==='failed')return 'Could not complete this request'
 if(turn.status==='cancelled')return 'Task stopped'
 if(turn.status==='interrupted')return 'Task interrupted'
 return turn.steps.length===1?'1 activity completed':turn.steps.length+' activities completed'
}
export default function AgentTurnActivity({turn,busy=false,placement='all',onContinue,onCancel,onOpenPaper,onReceipt}:AgentTurnActivityProps){
 if(!hasAgentTurnActivity(turn)||placement==='results'&&!turn.receipts.length)return null
 const active=turn.status==='running'||turn.status==='queued',resumable=['partial','failed','cancelled','interrupted'].includes(turn.status)
 return <section className="agent-turn-activity" aria-label="Activity for this question">
  {placement!=='results'&&<><div className="agent-turn-activity-row"><details className="agent-turn-details"><summary>{active?<LoaderCircle size={12} className="agent-turn-spinner"/>:<Check size={12}/>}<span>{activityLabel(turn)}</span><ChevronDown size={11}/></summary><div className="agent-turn-details-body">
   {turn.steps.length>0&&<ol>{turn.steps.map(step=><li key={step.id} data-status={step.status}><span>{labels[step.tool]??'Requested operation'}</span><small>{step.status==='succeeded'?'Done':step.status==='running'?'In progress':step.status==='cancelled'?'Stopped':'Needs attention'}</small>{step.error&&<p>{step.error}</p>}</li>)}</ol>}
   {turn.error&&<p>{turn.error}</p>}{turn.model&&<small>Model: {turn.model}</small>}
  </div></details>{active&&onCancel&&<button disabled={busy} onClick={()=>onCancel(turn)}><Square size={11}/>Cancel task</button>}{resumable&&onContinue&&<button disabled={busy} onClick={()=>onContinue(turn)}><Play size={11}/>Continue task</button>}</div>
  {turn.selection?.map(candidate=><button key={candidate.id} className="agent-turn-candidate" disabled={busy||!onContinue} onClick={()=>onContinue?.(turn,candidate.id)} aria-label={'Choose candidate '+candidate.title}><strong>{candidate.title}</strong><span>{candidate.reason}</span></button>)}</>}
  {placement!=='activity'&&turn.receipts.length>0&&<div className="agent-turn-results" aria-label="Saved results">{turn.receipts.map((receipt,index)=><div className="agent-turn-result" key={index}><FileText size={14}/><div><strong>{receipt.title}</strong><small>{receiptStatus[receipt.status]??'Result'} · {receipt.kind==='export'?'File':/note|draft/i.test(receipt.kind)?'Reading notes':receipt.kind==='import'?'Paper':receipt.kind==='summary'?'Summary':'Result'}</small>{receipt.detail&&<details><summary>Details</summary><p>{receipt.detail}</p></details>}</div>{receipt.paperId&&onOpenPaper&&receipt.kind==='import'&&<button disabled={busy} onClick={()=>onOpenPaper(receipt.paperId!)}>Open paper</button>}{onReceipt&&receipt.kind!=='import'&&<button disabled={busy} onClick={()=>onReceipt(turn,receipt,index)}>{receipt.kind==='export'?'View files':/note|draft/i.test(receipt.kind)?'View notes':'View result'}</button>}</div>)}</div>}
 </section>
}
