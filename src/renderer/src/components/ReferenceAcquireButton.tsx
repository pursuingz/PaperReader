import {useEffect,useRef,useState} from 'react'
import {Download} from 'lucide-react'
import type {DesktopAPI,ReferenceAcquisition,SummaryLanguage} from '../../../shared/types'
import './automation.css'
export default function ReferenceAcquireButton({api,paperId,referenceId,language,disabled=false}:{api:DesktopAPI;paperId:string;referenceId:string;language:SummaryLanguage;disabled?:boolean}){
 const [value,setValue]=useState<ReferenceAcquisition|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const epoch=useRef(0),revision=useRef(0)
 const t=(en:string,zh:string)=>language==='zh'?zh:en
 useEffect(()=>{const token=++epoch.current,loadedAt=++revision.current;setValue(null);setBusy(false);setError('');const stop=api.onReferenceAcquisition?.(v=>{if(token===epoch.current&&v.sourcePaperId===paperId&&v.referenceId===referenceId){revision.current++;setValue(v)}});void api.loadReferenceAcquisition(paperId,referenceId).then(v=>{if(token===epoch.current&&revision.current===loadedAt)setValue(v)}).catch(()=>{});return()=>{++epoch.current;stop?.()}},[api,paperId,referenceId])
 async function run(candidateId?:string){if(busy||disabled)return;const token=epoch.current;revision.current++;setBusy(true);setError('');try{const result=await api.acquireReference(paperId,referenceId,candidateId);if(token===epoch.current)setValue(result)}catch(e){if(token===epoch.current)setError(e instanceof Error?e.message:String(e))}finally{if(token===epoch.current)setBusy(false)}}
 const imported=value?.importedPaperId
 return <div className="reference-acquisition"><button disabled={disabled||busy} onClick={()=>{if(imported)window.dispatchEvent(new CustomEvent('paper-reader:open-imported-paper',{detail:{paperId:imported}}));else void run()}} aria-label={t('Find and import reference '+referenceId,'查找并导入引用 '+referenceId)}><Download size={12}/>{imported?t('Open paper','打开论文'):busy?t('Acquiring…','获取中…'):t('Find on arXiv','在 arXiv 查找')}</button>
 {value&&<span className="reference-acquisition-status" role="status">{({searching:t('Searching','检索中'),'waiting-selection':t('Choose a match','请选择匹配论文'),downloading:t('Downloading PDF','下载PDF中'),importing:t('Importing','导入中'),imported:t('Imported','已导入'),'already-in-library':t('Already in library','已在论文库'),unavailable:'paper unavailable',failed:t('Acquisition failed','获取失败')})[value.status]}</span>}
 {value?.status==='waiting-selection'&&value.candidates.filter(c=>c.provider==='arxiv'&&c.assessment!=='conflict').map(c=><button className="agent-candidate" key={c.id} disabled={busy||disabled} onClick={()=>void run(c.id)}><strong>{c.title}</strong><small>{c.authors.join('; ')} · {c.year} · {c.version??c.provider}</small></button>)}
 {value?.error&&value.status!=='unavailable'&&<p className="automation-error">{value.error}</p>}{error&&<p className="automation-error" role="alert">{error}</p>}

 </div>
}
