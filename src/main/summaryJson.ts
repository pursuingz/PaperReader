import { SummaryValidationError, type SummaryJsonReason } from './summaryErrors'

export const SUMMARY_JSON_FORMAT_EXAMPLE = JSON.stringify({ content: String.raw`A formula: $\alpha = \frac{a}{b}$.` + '\nA quoted term: "surface".' })
export const SUMMARY_JSON_ENCODING_INSTRUCTIONS = 'JSON string encoding is a transport requirement. Serialize every string with JSON.stringify semantics: literal backslashes in LaTeX require JSON escaping, double quotes inside text require escaping, and paragraph newlines/tabs must be escaped inside the JSON string. Do not emit raw control characters in quoted strings. This is a valid encoding-only example, NOT the required response schema or paper evidence: ' + SUMMARY_JSON_FORMAT_EXAMPLE + ' Follow the stage schema instead; never copy the example formula into scientific content. Preserve original technical terms/formulas with correct escaping or their original printed symbols. Return one complete JSON object only, without explanations, trailing commas, NaN, concatenated objects or a partial continuation.'
const prohibitedControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u

/** Fixed categories only: native JSON.parse messages may contain private response excerpts. */
function syntaxReason(json: string): SummaryJsonReason {
  if (!json.length) return 'EMPTY'
  let quoted = false, completed = false
  const stack: string[] = []
  for (let index = 0; index < json.length; index++) {
    const character = json[index]
    if (quoted) {
      if (character.charCodeAt(0) < 32) return 'UNESCAPED_CONTROL'
      if (character === '"') { quoted = false; continue }
      if (character === '\\') {
        const next = json[index + 1]
        if (next === undefined) return 'INCOMPLETE'
        if (!'"\\/bfnrtu'.includes(next)) return 'INVALID_ESCAPE'
        if (next === 'u') {
          if (json.length - index < 6) return 'INCOMPLETE'
          if (!/^[0-9a-f]{4}$/i.test(json.slice(index + 2, index + 6))) return 'INVALID_ESCAPE'
          index += 5
        } else index++
      }
      continue
    }
    if (/\s/u.test(character)) continue
    if (completed) return 'EXTRA_CONTENT'
    if (character === '"') { quoted = true; continue }
    if (character === '{' || character === '[') stack.push(character)
    else if (character === '}' || character === ']') {
      if (stack.pop() !== (character === '}' ? '{' : '[')) return 'OTHER'
      if (!stack.length) completed = true
    } else if (character === ',') {
      let next = index + 1; while (next < json.length && /\s/u.test(json[next])) next++
      if (json[next] === '}' || json[next] === ']') return 'TRAILING_COMMA'
    } else if (!stack.length && !/[-0-9tfn]/u.test(character)) return 'EXTRA_CONTENT'
  }
  return quoted || stack.length ? 'INCOMPLETE' : 'OTHER'
}

function validateDecodedStrings(value: unknown): void {
  const pending: unknown[] = [value]
  while (pending.length) {
    const current = pending.pop()
    if (typeof current === 'string') {
      if (prohibitedControl.test(current)) throw new SummaryValidationError('JSON_ENCODING', 'response', 'CONTROL_CHARACTER')
    } else if (current && typeof current === 'object') {
      for (const [key, child] of Object.entries(current)) {
        if (prohibitedControl.test(key)) throw new SummaryValidationError('JSON_ENCODING', 'response', 'CONTROL_CHARACTER')
        pending.push(child)
      }
    }
  }
}

/** Strict parsing only. Never guess quotes/braces, rewrite escapes or remove trailing content. */
export function parseSummaryJson(content: string): unknown {
  if (content.length > 60000) throw new SummaryValidationError('BUDGET')
  let json = content.trim()
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i.exec(json)
  if (fenced) json = fenced[1].trim()
  let value: unknown
  try { value = JSON.parse(json) as unknown }
  catch { throw new SummaryValidationError('JSON_SYNTAX', 'response', syntaxReason(json)) }
  validateDecodedStrings(value)
  return value
}

export function summaryJsonRecoveryInstructions(issue: SummaryValidationError): string {
  return 'The previous completed response failed JSON transport encoding validation: ' + issue.message + ' This is the only correction attempt. From the identical frozen source/evidence, regenerate the COMPLETE stage response using its required schema. Fix string serialization specifically: LaTeX backslashes, quoted text and Markdown newlines must be encoded exactly as in the encoding-only example. Emit the object even when information is unknown; represent unknowns using the stage schema. Close every string/array/object and remove explanatory prose and trailing commas. Do not continue or reconstruct the rejected response; it is not supplied. Preserve scientific facts, quantities, units and source identifiers. ' + SUMMARY_JSON_ENCODING_INSTRUCTIONS
}