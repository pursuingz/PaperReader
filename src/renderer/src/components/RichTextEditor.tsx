import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RichTextDocument } from '../../../shared/notebookTypes'
import { richTextFromDom, richTextHtml } from '../notebookRichText'

import ColorPicker from './ColorPicker'

interface Props { value: RichTextDocument; disabled?: boolean; onChange(value: RichTextDocument): void; onFinish(): void; autoFocus?: boolean; registerCommit?(commit: () => void): () => void }
export default function RichTextEditor({ value, disabled = false, onChange, onFinish, autoFocus = false, registerCommit }: Props) {
  const root = useRef<HTMLDivElement>(null), selection = useRef<Range | null>(null), composing = useRef(false), emitted = useRef(''), [error,setError] = useState(''), [textColor,setTextColor] = useState('#334155'), [highlight,setHighlight] = useState('transparent')
  const current = useRef({ onChange,onFinish });current.current={onChange,onFinish}
  useLayoutEffect(() => {
    const html=richTextHtml(value)
    if(root.current && html!==emitted.current && !composing.current){root.current.innerHTML=html;emitted.current=html}
  },[value])
  useLayoutEffect(() => registerCommit?.(() => commit(true)), [registerCommit])
  useEffect(()=>{if(autoFocus)root.current?.focus();return()=>current.current.onFinish()},[])
  function remember(){
    const range=window.getSelection()?.rangeCount?window.getSelection()!.getRangeAt(0):null
    if(range&&root.current?.contains(range.commonAncestorContainer))selection.current=range.cloneRange()
  }
  function commit(force = false){
    if((composing.current && !force)||!root.current)return
    try{const doc=richTextFromDom(root.current);emitted.current=richTextHtml(doc);setError('');current.current.onChange(doc);remember()}catch(error){setError(error instanceof Error?error.message:String(error));if(force)throw error}
  }
  function format(command:string,argument?:string){
    if(disabled||composing.current||!root.current)return
    root.current.focus()
    if(selection.current){const selected=window.getSelection();selected?.removeAllRanges();try{selected?.addRange(selection.current)}catch{selection.current=null}}
    document.execCommand(command,false,argument);commit()
  }
  function paste(event:React.ClipboardEvent){
    event.preventDefault();if(disabled||composing.current||!root.current)return
    try {
      const html=event.clipboardData.getData('text/html'),plain=event.clipboardData.getData('text/plain'),template=document.createElement('template')
      if(html)template.innerHTML=html
      else {const lines=plain.replace(/\r\n?/g,'\n').split('\n');for(const line of lines){const block=document.createElement('div');block.textContent=line;template.content.append(block)}}
      const clean=richTextHtml(richTextFromDom(template.content)),safe=document.createElement('template');safe.innerHTML=clean
      const chosen=window.getSelection(),range=chosen?.rangeCount?chosen.getRangeAt(0):null
      if(!range||!root.current.contains(range.commonAncestorContainer))throw Error('Select a place in this text box before pasting')
      range.deleteContents();const last=safe.content.lastChild;range.insertNode(safe.content);if(last){range.setStartAfter(last);range.collapse(true);chosen!.removeAllRanges();chosen!.addRange(range)}commit()
    }catch(error){setError(error instanceof Error?error.message:String(error))}
  }
  return <div className="notebook-rich-editor" onPointerDown={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)){try{commit(true);onFinish()}catch(error){setError(error instanceof Error?error.message:String(error))}}}}>
    <div className="notebook-format-toolbar" aria-label="Rich text formatting">
      {([['bold','B','Bold selected text'],['italic','I','Italic selected text'],['underline','U','Underline selected text']] as const).map(([command,label,aria])=><button key={command} type="button" aria-label={aria} disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>format(command)}>{label}</button>)}
      <button type="button" aria-label="Heading paragraph" disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>format('formatBlock','h2')}>H</button><button type="button" aria-label="Normal paragraph" disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>format('formatBlock','div')}>¶</button>
      <button type="button" aria-label="Bulleted list" disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>format('insertUnorderedList')}>•</button><button type="button" aria-label="Numbered list" disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>format('insertOrderedList')}>1.</button>
      <div onMouseDownCapture={remember}><ColorPicker label="Selected text color" disabled={disabled} value={textColor} onChange={color=>{setTextColor(color);format('foreColor',color)}}/></div>
      <div onMouseDownCapture={remember}><ColorPicker label="Selected text highlight" disabled={disabled} value={highlight} allowTransparent onChange={color=>{setHighlight(color);format('hiliteColor',color)}}/></div>
    </div>
    <div ref={root} className="notebook-rich-content" role="textbox" aria-label="Canvas rich text" aria-multiline="true" contentEditable={!disabled} suppressContentEditableWarning spellCheck={false} onInput={()=>commit()} onMouseUp={remember} onKeyUp={remember} onPaste={paste} onCompositionStart={()=>{composing.current=true}} onCompositionEnd={()=>{composing.current=false;commit()}}/>
    {error&&<div role="alert" className="notebook-editor-error">{error}</div>}
  </div>
}

