import { CrepeBuilder } from '@milkdown/crepe/builder'
import { codeMirror } from '@milkdown/crepe/feature/code-mirror'
import { latex } from '@milkdown/crepe/feature/latex'
import { listItem } from '@milkdown/crepe/feature/list-item'
import { placeholder } from '@milkdown/crepe/feature/placeholder'
import { table } from '@milkdown/crepe/feature/table'
import { topBar } from '@milkdown/crepe/feature/top-bar'
import { editorViewOptionsCtx, parserCtx, serializerCtx } from '@milkdown/kit/core'
import { uploadPlugin } from '@milkdown/kit/plugin/upload'
import { imageSchema, linkSchema } from '@milkdown/kit/preset/commonmark'
import { Slice } from '@milkdown/kit/prose/model'
import type { PluginView } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose, replaceAll } from '@milkdown/kit/utils'
import katex from 'katex'
import { NOTE_CHARACTER_LIMIT } from '../noteAdoption'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/classic.css'

export interface MarkdownVisualEditor {
  getMarkdown(): string
  replace(markdown: string): void
  setReadonly(readonly: boolean): void
  destroy(): Promise<void>
}

export async function createMarkdownVisualEditor(root: HTMLElement, value: string, options: { changed(): void; limitExceeded(): void; readonly: boolean; placeholder: string }): Promise<MarkdownVisualEditor> {
  let replacing = false
  let significantChange = false
  let initialized = false
  let userIntent = false
  const editingIntent = (event: Event) => {
    if (event instanceof KeyboardEvent && (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(event.key) || event.isComposing)) return
    if (['pointerdown', 'click'].includes(event.type) && !(event.target as Element | null)?.closest('button')) return
    userIntent = true
  }
  const intentEvents = ['beforeinput', 'input', 'keydown', 'paste', 'pointerdown', 'click']
  for (const event of intentEvents) root.addEventListener(event, editingIntent, true)
  const crepe = new CrepeBuilder({ root, defaultValue: value })
    .addFeature(codeMirror, { languages: [], theme: [], previewOnlyByDefault: false })
    .addFeature(listItem)
    .addFeature(table)
    .addFeature(latex, { katexOptions: { trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 } })
    .addFeature(placeholder, { text: options.placeholder, mode: 'doc' })
    .addFeature(topBar, { buildTopBar(builder) {
      const insert = builder.getGroup('insert').group
      insert.items = insert.items.filter(item => item.key !== 'link')
      const labels: Record<string, string> = { bold: 'Bold', italic: 'Italic', strikethrough: 'Strikethrough', code: 'Inline code', 'bullet-list': 'Bullet list', 'ordered-list': 'Numbered list', 'task-list': 'Task list', table: 'Insert table', 'code-block': 'Code block', math: 'Math block', quote: 'Quote', hr: 'Divider' }
      for (const group of builder.build()) for (const item of group.items) {
        if (!item.selector && labels[item.key]) item.icon = `<span class="markdown-note-sr">${labels[item.key]}</span>${item.icon}`
      }
    } })
  await crepe.editor.remove(uploadPlugin)
  crepe.editor.config(ctx => {
    // Crepe 7.22.3 stops tracking its toolbar version after a readonly render.
    // Recreate only that plugin view when editability changes; retain document/history.
    ctx.update<{ view(view: EditorView): PluginView }, 'topBarConfig'>('topBarConfig', previous => ({
      view(view) {
        let current = previous.view(view)
        let editable = view.editable
        return {
          update(next, previousState) {
            if (next.editable !== editable) {
              current.destroy?.()
              current = previous.view(next)
              editable = next.editable
            } else current.update?.(next, previousState)
          },
          destroy() { current.destroy?.() }
        }
      }
    }))
    ctx.update(imageSchema.key, previous => schemaCtx => ({
      ...previous(schemaCtx),
      toDOM: node => ['span', { class: 'markdown-note-image-label', 'data-note-image': 'blocked' }, `[Image: ${node.attrs.alt || 'no description'}]`]
    }))
    ctx.update(linkSchema.key, previous => schemaCtx => ({
      ...previous(schemaCtx),
      toDOM: mark => ['span', { class: 'markdown-note-link', title: mark.attrs.href }, 0]
    }))
    ctx.update(editorViewOptionsCtx, previous => ({
      ...previous,
      attributes: { ...previous.attributes, role: 'textbox', 'aria-label': 'Visual paper notes', 'aria-multiline': 'true', spellcheck: 'true' },
      handleDOMEvents: {
        ...previous.handleDOMEvents,
        click: (_view, event) => {
          if ((event.target as Element | null)?.closest('a')) { event.preventDefault(); return true }
          return false
        },
        auxclick: (_view, event) => { event.preventDefault(); return true },
        drop: (_view, event) => { event.preventDefault(); return true },
        paste: (view, event) => {
          event.preventDefault()
          if (!view.editable || !event.clipboardData) return true
          const text = event.clipboardData.getData('text/plain')
          if (!text) return true
          if (text.length > NOTE_CHARACTER_LIMIT) { options.limitExceeded(); return true }
          if (view.state.selection.$from.parent.type.spec.code) view.dispatch(view.state.tr.insertText(text))
          else {
            const document = ctx.get(parserCtx)(text)
            if (document) view.dispatch(view.state.tr.replaceSelection(Slice.maxOpen(document.content)).scrollIntoView())
          }
          return true
        }
      }
    }))
  }).use($prose(ctx => new Plugin({
    key: new PluginKey('paper-reader-note-transactions'),
    filterTransaction(transaction) {
      if (!initialized || replacing || !transaction.docChanged) return true
      if (ctx.get(serializerCtx)(transaction.doc).length <= NOTE_CHARACTER_LIMIT) return true
      options.limitExceeded()
      return false
    },
    props: {
      nodeViews: {
        image: node => {
          const dom = document.createElement('span')
          dom.className = 'markdown-note-image-label'
          dom.textContent = `[Image: ${node.attrs.alt || 'no description'}]`
          return { dom }
        },
        html: node => {
          const dom = document.createElement('span')
          dom.textContent = String(node.attrs.value || '')
          return { dom }
        },
        math_inline: node => {
          const dom = document.createElement('span')
          dom.dataset.type = 'math_inline'
          dom.dataset.value = String(node.attrs.value || '')
          katex.render(String(node.attrs.value || ''), dom, { trust: false, strict: 'ignore', throwOnError: false, maxExpand: 1000, maxSize: 20 })
          return { dom }
        }
      }
    },
    state: {
      init: () => null,
      apply: transaction => {
        if (initialized && userIntent && !replacing && transaction.docChanged && transaction.getMeta('addToHistory') !== false) significantChange = true
        return null
      }
    },
    view: () => ({ update: () => {
      if (!significantChange || replacing) return
      significantChange = false
      options.changed()
    } })
  })))
  crepe.setReadonly(true)
  try { await crepe.create() } catch (error) {
    for (const event of intentEvents) root.removeEventListener(event, editingIntent, true)
    await crepe.destroy().catch(() => undefined)
    throw error
  }
  initialized = true
  crepe.setReadonly(options.readonly)
  return {
    getMarkdown: () => crepe.getMarkdown(),
    replace(markdown) {
      replacing = true
      userIntent = false
      try { crepe.editor.action(replaceAll(markdown, true)) }
      finally { replacing = false; significantChange = false }
    },
    setReadonly: value => { crepe.setReadonly(value) },
    async destroy() {
      for (const event of intentEvents) root.removeEventListener(event, editingIntent, true)
      await crepe.destroy()
    }
  }
}
