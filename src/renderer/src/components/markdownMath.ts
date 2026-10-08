import type { Nodes, Root } from 'mdast'
import type { Handle } from 'mdast-util-from-markdown'
import type { State, Tokenizer } from 'micromark-util-types'
import type { Processor } from 'unified'
import type {} from 'remark-parse'

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    paperReaderMath: 'paperReaderMath'
    paperReaderMathSequence: 'paperReaderMathSequence'
    paperReaderMathData: 'paperReaderMathData'
  }
}

// A syntax extension, not a string replacement: CommonMark still owns escaped
// backslashes, inline code, fenced code, indentation and nested block containers.
const tokenizeSlashMath: Tokenizer = function (effects, ok, nok) {
  let closing = 0
  const start: State = (code) => {
    effects.enter('paperReaderMath')
    effects.enter('paperReaderMathSequence')
    effects.consume(code)
    return opening
  }
  const opening: State = (code) => {
    if (code !== 40 && code !== 91) return nok(code)
    closing = code === 40 ? 41 : 93
    effects.consume(code)
    effects.exit('paperReaderMathSequence')
    return body
  }
  const body: State = (code) => {
    if (code === null) return nok(code)
    if (code < -2) {
      // Micromark needs a separate void token for every consumed line ending
      // when reconnecting text chunks from paragraphs and nested containers.
      effects.enter('lineEnding')
      effects.consume(code)
      effects.exit('lineEnding')
      return body
    }
    if (code === 92) {
      effects.enter('paperReaderMathSequence')
      effects.consume(code)
      return afterSlash
    }
    effects.enter('paperReaderMathData')
    return data(code)
  }
  const data: State = (code) => {
    if (code === null || code < -2 || code === 92) {
      effects.exit('paperReaderMathData')
      return body(code)
    }
    effects.consume(code)
    return data
  }
  const afterSlash: State = (code) => {
    if (code === null) return nok(code)
    if (code !== closing && code !== 92) {
      effects.exit('paperReaderMathSequence')
      return body(code)
    }
    effects.consume(code)
    effects.exit('paperReaderMathSequence')
    if (code !== closing) return body
    effects.exit('paperReaderMath')
    return ok
  }
  return start
}

const enterSlashMath: Handle = function (token) {
  const source = this.sliceSerialize(token)
  const value = source.slice(2, -2).trim()
  this.enter({
    type: 'inlineMath',
    value,
    data: {
      hName: 'code',
      hProperties: { className: ['language-math', source[1] === '[' ? 'math-display' : 'math-inline'] },
      hChildren: [{ type: 'text', value }]
    }
  }, token)
  this.buffer()
}

function preserveCode(node: Nodes): void {
  // rehype-katex normally also renders ```math fences. Here all code fences
  // remain literal so examples of TeX or model output can be copied intact.
  if (node.type === 'code' && node.lang === 'math') {
    node.data = { ...node.data, hProperties: { className: ['language-tex'] } }
  }
  if ('children' in node) node.children.forEach(preserveCode)
}

export function remarkPaperMath(this: Processor) {
  const data = this.data()
  const syntax = data.micromarkExtensions || (data.micromarkExtensions = [])
  const fromMarkdown = data.fromMarkdownExtensions || (data.fromMarkdownExtensions = [])
  syntax.push({ text: { 92: { name: 'paperReaderMath', tokenize: tokenizeSlashMath } } })
  fromMarkdown.push({
    enter: { paperReaderMath: enterSlashMath },
    exit: { paperReaderMath(token) { this.resume(); this.exit(token) } }
  })
  return (tree: Root) => { preserveCode(tree) }
}
