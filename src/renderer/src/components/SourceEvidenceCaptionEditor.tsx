import { createPortal } from 'react-dom'
import { useEffect, useId, useRef, useState } from 'react'
import { Document, Page } from 'react-pdf'
import { Check, ChevronLeft, ChevronRight, Copy, X } from 'lucide-react'
import type { DesktopAPI, PaperSourceEntry, SummaryLanguage } from '../../../shared/types'
import { captionCopySelection, captionPageNumber } from '../sourceEvidenceEditsSession'
import { figureDialogTabTarget } from '../summaryFigureSession'
import { summaryText } from '../summaryLocale'
import './sourceEvidenceCaptionEditor.css'

interface Props {
  api: Pick<DesktopAPI, 'readPaper'>
  paperId: string
  entry: PaperSourceEntry
  caption: string
  initialPage?: number
  language: SummaryLanguage
  onSave(caption: string): Promise<boolean>
  onClose(): void
}

export default function SourceEvidenceCaptionEditor({ api, paperId, entry, caption, initialPage, language, onSave, onClose }: Props) {
  const t = (en: string, zh: string) => summaryText(language, en, zh), title = useId()
  const [draft, setDraft] = useState(caption), [page, setPage] = useState(initialPage ?? entry.pages[0]), [pageInput, setPageInput] = useState(String(initialPage ?? entry.pages[0]))
  const [file, setFile] = useState<{ data: Uint8Array }>(), [count, setCount] = useState(0), [width, setWidth] = useState(640), [revision, setRevision] = useState(0)
  const [error, setError] = useState(''), [pdfError, setPdfError] = useState(''), [copyStatus, setCopyStatus] = useState(''), [selected, setSelected] = useState(''), [busy, setBusy] = useState(false)
  const dialog = useRef<HTMLDivElement>(null), source = useRef<HTMLDivElement>(null), preview = useRef<HTMLDivElement>(null), close = useRef<HTMLButtonElement>(null), saving = useRef(false), mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    close.current?.focus({ preventScroll: true })
    return () => { mounted.current = false; if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => {
    let alive = true; setFile(undefined); setCount(0); setPdfError('')
    void api.readPaper(paperId).then(bytes => { if (alive) setFile({ data: new Uint8Array(bytes) }) }).catch(failure => { if (alive) setPdfError(failure instanceof Error ? failure.message : String(failure)) })
    return () => { alive = false }
  }, [api, paperId, revision])
  useEffect(() => {
    const target = preview.current; if (!target) return
    const observer = new ResizeObserver(() => setWidth(Math.max(180, Math.min(1000, Math.floor(target.clientWidth - 42)))))
    observer.observe(target); return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const change = () => {
      const selection = window.getSelection(), host = source.current
      const value = selection && host ? captionCopySelection(selection.toString(), Boolean(selection.anchorNode && host.contains(selection.anchorNode)), Boolean(selection.focusNode && host.contains(selection.focusNode))) : null
      setSelected(value ?? '')
    }
    document.addEventListener('selectionchange', change); return () => document.removeEventListener('selectionchange', change)
  }, [])
  function navigate(number: number) {
    if (busy || !count || !Number.isSafeInteger(number) || number < 1 || number > count) return
    setPage(number); setPageInput(String(number)); setSelected(''); setCopyStatus(''); setPdfError('')
    source.current?.scrollTo({ top: 0, left: 0 })
  }
  function commitPage() {
    const number = captionPageNumber(pageInput, count)
    if (number !== null) navigate(number)
    else setPageInput(String(page))
  }
  async function copy() {
    if (!selected) return
    try { await navigator.clipboard.writeText(selected); if (mounted.current) setCopyStatus(t('Selected text copied. Paste it into the caption to edit.', '选中文字已复制，可粘贴到图注中编辑。')) }
    catch { if (mounted.current) setCopyStatus(t('Copy unavailable. Select the PDF text and press Ctrl+C.', '复制暂不可用，请选中 PDF 文字后按 Ctrl+C。')) }
  }
  async function save() {
    if (saving.current || !draft.trim() || draft.length > 16000) return
    saving.current = true; setBusy(true); setError('')
    try { if (await onSave(draft) && mounted.current) onClose() }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { saving.current = false; if (mounted.current) setBusy(false) }
  }
  return createPortal(<div className="summary-figure-backdrop caption-editor-backdrop" onMouseDown={event => { if (event.currentTarget === event.target && !saving.current) onClose() }}>
    <div className="source-caption-editor" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={title} aria-busy={busy} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!saving.current) onClose() }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? [])
      const target = figureDialogTabTarget(controls, document.activeElement instanceof HTMLElement ? document.activeElement : null, event.shiftKey)
      if (target) { event.preventDefault(); (target === 'dialog' ? dialog.current : target)?.focus({ preventScroll: true }) }
    }}>
      <header><div><span className="caption-editor-eyebrow">{t('ORIGINAL PDF · LOCAL', '原始 PDF · 本地')}</span><h2 id={title}>{t('Correct caption', '校正图注')} · {entry.label}</h2></div><button ref={close} type="button" className="caption-editor-close" aria-label={t('Close caption correction', '关闭图注校正')} disabled={busy} onClick={onClose}><X size={18}/></button></header>
      <div className="caption-editor-body">
        <section className="caption-preview-column" ref={preview} aria-label={t('Original PDF for copying', '可复制的 PDF 原页')}>
          <div className="caption-page-tools"><button type="button" aria-label={t('Previous source page', '上一来源页')} disabled={busy || page <= 1 || !count} onClick={() => navigate(page - 1)}><ChevronLeft size={14}/></button><label>{t('Page', '页码')}<input type="number" min={1} max={count || undefined} value={pageInput} disabled={busy || !count} aria-label={t('Caption source page', '图注来源页码')} onChange={event => setPageInput(event.currentTarget.value)} onBlur={commitPage} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitPage() } }}/><span>/ {count || '—'}</span></label><button type="button" aria-label={t('Next source page', '下一来源页')} disabled={busy || !count || page >= count} onClick={() => navigate(page + 1)}><ChevronRight size={14}/></button><button type="button" className="caption-copy" disabled={!selected} onMouseDown={event => event.preventDefault()} onClick={() => void copy()}><Copy size={12}/>{t('Copy selected text', '复制选中文字')}</button></div>
          <div className="caption-pdf-source" ref={source} tabIndex={0}>
            {!file && !pdfError && <p role="status">{t('Opening original PDF locally…', '正在本地打开 PDF 原文…')}</p>}
            {file && <Document file={file} onLoadSuccess={document => { if (!mounted.current) return; setCount(document.numPages); const valid = Math.min(page, document.numPages); setPage(valid); setPageInput(String(valid)) }} onLoadError={failure => { if (mounted.current) setPdfError(failure.message) }} loading={<p>{t('Loading original PDF…', '正在加载 PDF 原文…')}</p>} error={<p>{t('Original PDF could not be opened.', '无法打开 PDF 原文。')}</p>}>
              <Page pageNumber={page} width={width} renderTextLayer renderAnnotationLayer={false} onRenderError={failure => { if (mounted.current) setPdfError(failure.message) }} onGetTextError={failure => { if (mounted.current) setPdfError(failure.message) }} loading={<p>{t('Rendering source page…', '正在渲染来源页…')}</p>}/>
            </Document>}
          </div>
          {pdfError && <div className="caption-pdf-error"><p role="alert">{pdfError}</p><button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>{t('Retry original PDF', '重试打开 PDF')}</button></div>}
          <p className="caption-copy-status" role="status">{copyStatus || t('Select text on the page and copy it, then paste into the caption.', '在原页选中文字并复制，再粘贴至图注。')}</p>
        </section>
        <section className="caption-draft-column"><label htmlFor={`${title}-draft`}>{t('Caption', '图注')}</label><textarea id={`${title}-draft`} aria-label={t('Corrected caption', '校正后的图注')} value={draft} maxLength={16000} disabled={busy} onChange={event => { setDraft(event.currentTarget.value); setError('') }}/><span className="caption-character-count">{draft.length} / 16000</span><p>{t('Save updates this item’s caption. Your original PDF and crop are preserved.', '保存后更新此条图注，原始 PDF 和裁切图会保留。')}</p>{error && <p className="caption-save-error" role="alert">{error}</p>}</section>
      </div>
      <footer><button type="button" disabled={busy} onClick={onClose}>{t('Cancel', '取消')}</button><button type="button" className="primary" disabled={busy || !draft.trim()} onClick={() => void save()}><Check size={14}/>{busy ? t('Saving…', '正在保存…') : t('Save caption', '保存图注')}</button></footer>
    </div>
  </div>, document.body)
}
