import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NOTE_CHARACTER_LIMIT } from '../noteAdoption'
import { MarkdownNoteState, visualMarkdownIssue } from './markdownNoteState'
import type { MarkdownVisualEditor } from './markdownNoteVisual'
import './markdownNoteEditor.css'

export interface MarkdownNoteEditorProps {
  value: string
  disabled?: boolean
  placeholder?: string
  onChange(markdown: string): void
  onSave(): void
  registerCommit?(commit: () => Promise<void>): () => void
}

export default function MarkdownNoteEditor(props: MarkdownNoteEditorProps) {
  const callbacks = useRef(props)
  callbacks.current = props
  const [source, setSource] = useState(props.value)
  const [mode, setMode] = useState<'visual' | 'source'>(() => visualMarkdownIssue(props.value) ? 'source' : 'visual')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [inputNotice, setInputNotice] = useState('')
  const state = useRef<MarkdownNoteState | null>(null)
  if (!state.current) state.current = new MarkdownNoteState(props.value, markdown => { setSource(markdown); callbacks.current.onChange(markdown) })
  const visualRoot = useRef<HTMLDivElement>(null)
  const visual = useRef<MarkdownVisualEditor | null>(null)
  const engineSource = useRef('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const live = useRef(true)
  const issue = visualMarkdownIssue(source)

  const captureVisual = useCallback(() => {
    if (!live.current || !visual.current) return
    if (state.current!.captureVisual(visual.current.getMarkdown())) { engineSource.current = state.current!.value; setInputNotice('') }
    if (visualMarkdownIssue(state.current!.value)) setMode('source')
  }, [])
  const commit = useCallback(async () => {
    await state.current!.waitForComposition()
    await new Promise(resolve => setTimeout(resolve, 0))
    if (!live.current) return
    if (timer.current) clearTimeout(timer.current)
    captureVisual()
  }, [captureVisual])

  useEffect(() => props.registerCommit?.(commit), [props.registerCommit, commit])
  useEffect(() => {
    live.current = true
    let disposed = false
    const initial = visualMarkdownIssue(state.current!.value) ? '' : state.current!.value
    engineSource.current = initial
    void import('./markdownNoteVisual').then(module => disposed ? null : module.createMarkdownVisualEditor(visualRoot.current!, initial, {
      readonly: Boolean(callbacks.current.disabled),
      limitExceeded() { if (!disposed) setInputNotice('The note limit is 2,000,000 characters. Shorten the text before inserting it.') },
      placeholder: callbacks.current.placeholder || 'Write your reading notes…',
      changed() {
        if (disposed) return
        state.current!.markVisualChange()
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(captureVisual, 60)
      }
    })).then(editor => {
      if (!editor) return
      if (disposed) { void editor.destroy(); return }
      visual.current = editor
      const latest = state.current!.value
      if (!visualMarkdownIssue(latest) && latest !== engineSource.current) { editor.replace(latest); engineSource.current = latest }
      editor.setReadonly(Boolean(callbacks.current.disabled))
      setLoading(false)
    }).catch(() => {
      if (disposed) return
      setError('Visual editing is unavailable. Your Markdown is editable in Source mode.')
      setLoading(false)
      setMode('source')
    })
    return () => {
      disposed = true
      live.current = false
      if (timer.current) clearTimeout(timer.current)
      state.current!.endComposition()
      const editor = visual.current
      visual.current = null
      if (editor) void editor.destroy()
    }
  }, [captureVisual])

  useLayoutEffect(() => {
    if (!state.current!.acceptExternal(props.value)) return
    setSource(props.value)
    setInputNotice('')
    if (visualMarkdownIssue(props.value)) { setMode('source'); return }
    if (visual.current) {
      visual.current.replace(props.value)
      engineSource.current = props.value
    }
  }, [props.value])
  useEffect(() => { visual.current?.setReadonly(Boolean(props.disabled)) }, [props.disabled])

  const switchMode = async (next: 'visual' | 'source') => {
    await commit()
    if (!live.current) return
    if (next === 'visual' && (visualMarkdownIssue(state.current!.value) || error)) return
    if (next === 'visual' && visual.current && engineSource.current !== state.current!.value) {
      visual.current.replace(state.current!.value)
      engineSource.current = state.current!.value
    }
    setMode(next)
  }
  return <section className="markdown-note-editor" aria-label="Markdown note editor" onCompositionStartCapture={() => state.current!.beginComposition()} onCompositionEndCapture={() => { setTimeout(() => { if (live.current) { state.current!.endComposition(); captureVisual() } }, 0) }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void commit().then(() => { if (live.current) callbacks.current.onSave() })
  }}>
    <div className="markdown-note-modebar"><div role="group" aria-label="Markdown editing mode"><button type="button" aria-pressed={mode === 'visual'} disabled={Boolean(props.disabled || issue || error)} title={issue || error || 'Edit formatted Markdown'} onClick={() => void switchMode('visual')}>Visual</button><button type="button" aria-pressed={mode === 'source'} disabled={props.disabled} onClick={() => void switchMode('source')}>Source</button></div><small>{mode === 'visual' ? 'Markdown · Ctrl+B / Ctrl+I' : 'Markdown source'}</small></div>
    {(issue || error || inputNotice) && <p className="markdown-note-fallback" role="status">{error || issue || inputNotice}</p>}
    <div ref={visualRoot} className="markdown-note-visual" hidden={mode !== 'visual'} aria-busy={loading}/>
    {mode === 'visual' && loading && <p className="markdown-note-loading" role="status">Loading editor…</p>}
    <textarea className="note-editor markdown-note-source" hidden={mode !== 'source'} disabled={props.disabled} aria-label="Paper notes" placeholder={props.placeholder} value={source} maxLength={NOTE_CHARACTER_LIMIT} spellCheck={false} onChange={event => { if (!state.current!.captureSource(event.target.value)) setInputNotice('The note limit is 2,000,000 characters. Shorten the text before inserting it.'); else setInputNotice('') }}/>
  </section>
}
