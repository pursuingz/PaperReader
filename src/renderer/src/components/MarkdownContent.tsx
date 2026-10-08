import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { remarkPaperMath } from './markdownMath'

// Destinations stay selectable text: an AI answer must never navigate the app.
function visibleWebAddress(href: string | undefined): string | null {
  if (!href || !/^https?:\/\//i.test(href)) return null
  try {
    const url = new URL(href)
    return url.username || url.password ? null : href
  } catch {
    return null
  }
}

const components: Components = {
  a({ href, children }) {
    const address = visibleWebAddress(href)
    return <span className="markdown-reference">{children}{address && children !== address && <span className="markdown-url"> ({address})</span>}</span>
  },
  img({ alt }) {
    return <span className="markdown-image-label">[图片：{alt || '未提供说明'}]</span>
  },
  table({ children }) {
    return <div className="markdown-table-scroll" role="region" aria-label="回答中的表格" tabIndex={0}><table>{children}</table></div>
  }
}

/** Display only; the saved answer is never rewritten or normalized. */
const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return <div className="markdown-content">
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm, remarkMath, remarkPaperMath]}
      rehypePlugins={[[rehypeKatex, {
        trust: false,
        strict: 'ignore',
        maxExpand: 1000,
        maxSize: 20,
        errorColor: '#a15462',
        output: 'htmlAndMathml'
      }]]}
      components={components}
    >{content}</ReactMarkdown>
  </div>
})

export default MarkdownContent
