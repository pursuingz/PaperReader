import { FileText, RefreshCw, Sparkles, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { PaperSummary, SummaryLanguage, SummaryJobStatus, SummaryDraftPreview } from '../../../shared/types'
import { summaryText, summaryTitle } from '../summaryLocale'
import MarkdownContent from './MarkdownContent'
interface Props {
 summary:PaperSummary|null;ready:boolean;busy:boolean;status:string
 onGenerate():void;onCancel():void;onRetry():void;onPage(page:number):void
 job?:SummaryJobStatus|null;onResume?():void;draft?:SummaryDraftPreview|null;onCopyDraft?():void
 sources?:ReactNode;language?:SummaryLanguage;onLanguage?(language:SummaryLanguage):void;detailMode?:boolean
}
export default function PaperSummaryView({summary,ready,busy,status,onGenerate,onCancel,onRetry,onPage,sources,language='en',onLanguage,detailMode=false,job,onResume,draft,onCopyDraft}:Props){
 const t=(en:string,zh:string)=>summaryText(language,en,zh)
 const unfinished=!!job&&job.state!=='completed'
 const pageWarnings=[...(job?.warnings??[]),...(draft?.warnings??[])].some(warning=>/page/i.test(warning))
 const phaseNames={extract:t('Reading notes','分块阅读笔记'),synthesize:t('Summary synthesis','摘要成文'),review:t('Earlier workflow','旧版流程'),rewrite:t('Format arrangement','格式整理'),verify:t('Earlier workflow','旧版流程'),complete:t('Complete','完成')}
 const incompatible={model:t('The configured model changed.','配置的模型已改变。'),language:t('The selected language changed.','所选语言已改变。'),recipe:t('The generation strategy changed.','生成策略已更新。'),source:t('The source PDF changed.','来源 PDF 已改变。'),damaged:t('The saved progress is damaged or unavailable.','保存的进度损坏或不可用。'),budget:t('The saved progress reached its resource limit.','保存的进度已达资源限制。')}
 return <div className="live-summary" lang={language==='zh'?'zh-CN':'en'}>
  {!detailMode&&<>
  <div className="summary-heading"><div><span className="eyebrow">{t('THE BIG PICTURE','论文全景')}</span><h2>{t('A paper, at a glance.','一眼看懂一篇论文。')}</h2></div><span className="ai-summary-badge"><Sparkles size={11}/>{t('AI GENERATED','AI 生成')}</span></div>
  <div className="summary-controls"><p>{t('Generate sends the extracted full-paper text to DeepSeek. Long papers may use several requests; a cut-off response gets one automatic retry. Up to 200 pages / 240,000 characters; image-only pages need OCR.','生成摘要会将提取的论文全文发送给 DeepSeek。长论文可能分多次请求，截断回复会自动重试一次。最多 200 页／24 万字符；纯图片页面需要 OCR。')}</p>
   <div className="summary-generate-actions"><label className="summary-language"><span>{t('Language','语言')}</span><select aria-label={t('Summary language','摘要语言')} value={language} disabled={busy} onChange={event=>onLanguage?.(event.currentTarget.value as SummaryLanguage)}><option value="en">English</option><option value="zh">中文</option></select></label>
   {!busy&&job?.canResume&&onResume&&<button className="secondary-button" disabled={!ready} onClick={onResume}>{t('Continue summary','继续生成')}</button>}{busy?<button className="secondary-button" onClick={onCancel}><X size={14}/>{t('Cancel summary','取消生成')}</button>:<button className="primary-button" disabled={!ready} onClick={onGenerate}>{summary?<RefreshCw size={13}/>:<Sparkles size={13}/>}{unfinished?t('Start again','重新开始'):summary?t('Regenerate summary','重新生成摘要'):t('Generate summary','生成摘要')}</button>}</div>
  </div>
  {unfinished&&<div className="summary-checkpoint" role="status"><strong>{phaseNames[job.phase]}</strong><span>{job.totalBatches===1&&job.completedBatches===0?t(`Direct full-paper writing · ${job.consumed.calls} API requests across ${job.executions} execution${job.executions===1?'':'s'}`,`全文直接成文 · ${job.executions} 次执行累计 ${job.consumed.calls} 次 API 请求`):t(`${job.completedBatches} / ${job.totalBatches} reading notes saved · ${job.consumed.calls} API requests across ${job.executions} execution${job.executions===1?'':'s'}`,`${job.completedBatches} / ${job.totalBatches} 批阅读笔记已保存 · ${job.executions} 次执行累计 ${job.consumed.calls} 次 API 请求`)}</span>{job.incompatibleReason?<span>{incompatible[job.incompatibleReason]} {t('Start again to use the current paper and settings.','重新开始以使用当前论文和设置。')}</span>:job.canResume&&<span>{t('Continue reuses saved stages and opens a new bounded execution. Loading this page sends no AI request.','继续生成会复用已保存阶段并开启新一轮有上限的执行。加载此页不会发送 AI 请求。')}</span>}</div>}
  {draft&&<section className="summary-raw-draft"><div className="summary-draft-heading"><h3>{t('Unformatted draft','未完成分区的草稿')}</h3><button className="secondary-button" disabled={!onCopyDraft} onClick={onCopyDraft}>{t('Copy draft','复制草稿')}</button></div><p>{t('The original writing is retained. A complete saved summary is replaced only after all six sections are arranged.','原始写作内容已保留，六模块整理完成后才会替换已保存的完整摘要。')}</p>{draft.missingSections.length>0&&<p>{t('Missing sections: ','尚未生成的模块：')}{draft.missingSections.map(id=>summaryTitle(language,id)).join(', ')}</p>}<MarkdownContent content={draft.markdown}/></section>}
  {pageWarnings?<p className="summary-reference-warning" role="note">{t('Some page references need checking. Unavailable page targets are not linked.','部分页码引用需要核对，不可用的页码不会生成跳转按钮。')}</p>:null}
  {status&&<div className="summary-job-status" role="status">{busy&&<span className="loading-dot"/>}{status}{!ready&&<button className="text-action" onClick={onRetry}>{t('Retry summary load','重新加载摘要')}</button>}</div>}
  {summary?<>
   <div className="summary-provenance"><span>{summary.model}</span><time dateTime={summary.createdAt}>{new Date(summary.createdAt).toLocaleString(language==='zh'?'zh-CN':'en',{dateStyle:'medium',timeStyle:'short'})}</time><strong>{t(`${summary.coveredPages.length} / ${summary.pageCount} pages with text`,`${summary.coveredPages.length} / ${summary.pageCount} 页包含可读文字`)}</strong></div>
   {summary.language!==language&&<p className="summary-job-status">{summary.language?t('The saved result uses another language. Regenerate to apply your selection; changing language sends no request.','已保存结果采用另一种语言。重新生成后应用所选语言；切换选项不会发送请求。'):t('This earlier saved result has no language label. Regenerate to apply English or Chinese.','旧摘要尚未标注语言。重新生成可应用英语或中文。')}</p>}
   {summary.missingPages.length>0&&<div className="summary-missing"><strong>{t('No readable text:','无可读文字：')}</strong><span>{summary.missingPages.map(page=><button key={page} onClick={()=>onPage(page)} aria-label={t(`Open textless page ${page}`,`打开无文字的第 ${page} 页`)}>p. {page}</button>)}</span></div>}
   <p className="summary-caution">{t('AI-generated interpretation. Page links are AI-suggested reading locations; check important claims against the original.','内容由 AI 生成。页码链接是 AI 建议的阅读位置，请对照原文核实重要结论。')}</p>
   <div className="summary-cards live-summary-cards">{summary.sections.map((section,index)=><article className={`summary-card card-${index}`} key={section.id} data-section={section.id}><h3><span>{['⌘','▤','☼','⚙','▥','◇'][index]}</span>{summaryTitle(language,section.id)}</h3><MarkdownContent content={section.content}/>{section.pages.length>0&&<div className="source-pages"><span>{t('Source','来源')}</span>{section.pages.map(page=><button key={page} onClick={()=>onPage(page)} aria-label={t(`${summaryTitle(language,section.id)}: open page ${page}`,`${summaryTitle(language,section.id)}：打开第 ${page} 页`)}>p. {page}</button>)}</div>}</article>)}</div>
  </>:!busy&&ready&&!draft&&<div className="summary-intro"><FileText size={30}/><h3>{t('The whole argument, in one place.','让论文的论证脉络清晰呈现。')}</h3><p>{t('Keywords, overview, background, methods, results and limitations — with page links back to your paper.','关键词、概览、背景、方法、结果与局限，并附原文页码。')}</p></div>}
  </>}
  {sources}
 </div>
}
