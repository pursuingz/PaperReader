import type { NoteOrganizationBlock, NoteOrganizationRecipe, NoteOrganizationRequestJson } from '../shared/noteOrganizationTypes'
import { NOTE_ORGANIZATION_SYSTEM_PROMPT, NOTE_ORGANIZATION_PLAN_PROMPT, NOTE_ORGANIZATION_EDIT_PROMPT, NOTE_ORGANIZATION_REPAIR_PROMPT } from '../shared/aiPrompts'

const POLICY = Object.freeze({ maxSourceChars: 100_000, maxBlocks: 256, maxBlockChars: 6_000, maxChunkChars: 12_000, maxChunkBlocks: 12, maxPlanChars: 40_000, maxOutputChars: 180_000, maxRepairAttempts: 1 })
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
function invalid(reason: string): never { throw new Error(`Note organization cannot preserve the source: ${reason}. Your original Text note is unchanged; reduce the scope or retry.`) }
function exactFields(value: Record<string, unknown>, names: readonly string[], boundary: string): void {
  const keys = Reflect.ownKeys(value)
  if (keys.length !== names.length || keys.some(key => typeof key !== 'string' || !names.includes(key)) || names.some(name => !Object.hasOwn(value, name))) invalid(`unknown or missing frozen recipe fields in ${boundary}`)
}
function freezeRecipe(recipe: NoteOrganizationRecipe): NoteOrganizationRecipe {
  recipe.blocks.forEach(Object.freeze); Object.freeze(recipe.blocks); Object.freeze(recipe.prompts); Object.freeze(recipe.limits)
  return Object.freeze(recipe)
}

function splitSource(source: string, maxBlockChars: number): NoteOrganizationBlock[] {
  const blocks: NoteOrganizationBlock[] = []
  let start = 0, offset = 0, fence = '', fenceLength = 0, math = false, blank = false
  for (const line of source.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (blank && line.trim() && !fence && !math) { blocks.push({ id: `b${blocks.length + 1}`, text: source.slice(start, offset), start, end: offset }); start = offset }
    if (marker) {
      if (!fence) { fence = marker[1][0]; fenceLength = marker[1].length }
      else if (marker[1][0] === fence && marker[1].length >= fenceLength) fence = ''
    }
    if (!fence && /^\s*(?:\$\$|\\\[|\\\])/.test(line)) {
      const trimmed = line.trim()
      if (trimmed === '$$') math = !math
      else if (trimmed === '\\[') math = true
      else if (trimmed === '\\]') math = false
    }
    blank = !line.trim() && !fence && !math && Boolean(source.slice(start, offset).trim())
    offset += line.length
  }
  if (start < source.length) blocks.push({ id: `b${blocks.length + 1}`, text: source.slice(start), start, end: source.length })
  const bounded: NoteOrganizationBlock[] = []
  for (const block of blocks) {
    if (block.text.length > maxBlockChars && /(?:^|\n) {0,3}(?:`{3,}|~{3,})|\$\$|\\\[/.test(block.text)) invalid(`an indivisible code/math source block exceeds the ${maxBlockChars.toLocaleString('en-US')} character block limit`)
    const protectedSpans = [...block.text.matchAll(/`+[^`\n]+`+|\$[^$\n]+\$|\\\([^\n]*?\\\)|\[[^\]\n]+\]/g)].map(match => [match.index, match.index + match[0].length])
    let cursor = 0
    while (cursor < block.text.length) {
      let end = Math.min(cursor + maxBlockChars, block.text.length)
      if (end < block.text.length) {
        while (end > cursor && !/[\s。！？；]/u.test(block.text[end - 1])) end--
        for (const [from, to] of protectedSpans) if (from < end && to > end) end = from
        if (end <= cursor) invalid('an indivisible source word, formula or citation exceeds the block limit')
      }
      bounded.push({ id: `b${bounded.length + 1}`, text: block.text.slice(cursor, end), start: block.start + cursor, end: block.start + end })
      cursor = end
    }
  }
  return bounded
}

export function createNoteOrganizationRecipe(note: string): NoteOrganizationRecipe {
  if (typeof note !== 'string' || !note.trim()) invalid('the Text note is empty')
  if (note.length > POLICY.maxSourceChars) invalid('the Text note exceeds the 100,000 character limit')
  const blocks = splitSource(note, POLICY.maxBlockChars)
  if (blocks.length > POLICY.maxBlocks) invalid(`the source has more than ${POLICY.maxBlocks} blocks`)
  return freezeRecipe({ version: 1, processingVersion: 'faithful-blocks-v1', source: note, blocks, prompts: { system: NOTE_ORGANIZATION_SYSTEM_PROMPT, plan: NOTE_ORGANIZATION_PLAN_PROMPT, organize: NOTE_ORGANIZATION_EDIT_PROMPT, repair: NOTE_ORGANIZATION_REPAIR_PROMPT }, limits: { ...POLICY } })
}

export function validateNoteOrganizationRecipe(value: unknown): NoteOrganizationRecipe {
  if (!object(value) || value.version !== 1 || value.processingVersion !== 'faithful-blocks-v1' || typeof value.source !== 'string' || !value.source.trim() || !object(value.prompts) || !object(value.limits) || !Array.isArray(value.blocks)) invalid('invalid frozen source recipe/version')
  exactFields(value, ['version', 'processingVersion', 'source', 'blocks', 'prompts', 'limits'], 'recipe')
  exactFields(value.prompts, ['system', 'plan', 'organize', 'repair'], 'prompts')
  exactFields(value.limits, Object.keys(POLICY), 'limits')
  const limits = value.limits as Record<string, unknown>
  for (const [key, hardCap] of Object.entries(POLICY)) if (!Number.isInteger(limits[key]) || (limits[key] as number) < (key === 'maxRepairAttempts' ? 0 : 1) || (limits[key] as number) > hardCap) invalid(`invalid frozen processing limit ${key}`)
  if ((limits.maxBlockChars as number) > (limits.maxChunkChars as number) || value.source.length > (limits.maxSourceChars as number) || value.blocks.length < 1 || value.blocks.length > (limits.maxBlocks as number)) invalid('source/block limits do not match')
  for (const key of ['system', 'plan', 'organize', 'repair']) if (typeof value.prompts[key] !== 'string' || !(value.prompts[key] as string).trim() || (value.prompts[key] as string).length > 16_000) invalid(`missing frozen prompt ${key}`)
  const source = value.source
  let offset = 0
  const blocks = value.blocks.map((block, index) => {
    if (!object(block) || block.id !== `b${index + 1}` || block.start !== offset || !Number.isInteger(block.end) || typeof block.text !== 'string' || !block.text.length || block.text.length > (limits.maxBlockChars as number) || block.end !== offset + block.text.length || source.slice(offset, block.end as number) !== block.text) invalid('source-block coverage or exact source offsets do not match')
    exactFields(block, ['id', 'text', 'start', 'end'], 'source block')
    const copy = { id: block.id, text: block.text, start: offset, end: block.end as number } as NoteOrganizationBlock
    offset = copy.end; return copy
  })
  if (offset !== value.source.length) invalid('source-block coverage is incomplete')
  return freezeRecipe({ version: 1, processingVersion: 'faithful-blocks-v1', source: value.source, blocks, prompts: { system: value.prompts.system as string, plan: value.prompts.plan as string, organize: value.prompts.organize as string, repair: value.prompts.repair as string }, limits: Object.fromEntries(Object.keys(POLICY).map(key => [key, limits[key]])) as unknown as NoteOrganizationRecipe['limits'] })
}

const matches = (text: string, pattern: RegExp) => (text.match(pattern) || []).sort()
function same(left: readonly string[], right: readonly string[]) { return left.length === right.length && left.every((item, index) => item === right[index]) }
function technicalAtoms(text: string): string[] {
  return [
    ...matches(text, /(?:^|\n) {0,3}(?:`{3,}[^\n]*\n[\s\S]*?\n {0,3}`{3,}|~{3,}[^\n]*\n[\s\S]*?\n {0,3}~{3,})/g),
    ...matches(text, /`+[^`\n]+`+/g),
    ...matches(text, /\$\$[\s\S]*?\$\$|(?<!\$)\$(?!\$)[^$\n]+\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g),
    ...matches(text, /\[[^\]\n]{1,200}\]|\([^()\n]*(?:et al\.|\b(?:19|20)\d{2})[^()\n]*\)/g),
    ...matches(text, /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:\s*(?:%|ms\b|mm\b|cm\b|km\b|Hz\b|MHz\b|GHz\b|s\b|MB\b|GB\b|μm\b|µm\b))?/g),
    ...Array.from(text).filter(character => /[\p{S}\p{N}\p{Pd}*/^%_()\[\]{}\\]/u.test(character)),
    ...matches(text, /[=<>≤≥≠≈∑∫√∂∇±×÷→←∝?？]/g),
    ...matches(text, /https?:\/\/[^\s<>]+|\b10\.\d{4,9}\/[^\s<>]+/g),
  ].sort()
}
const QUALIFIERS = /\b(?:not|no|never|without|cannot|can't|may|maybe|might|could|unproven|preliminary|preliminarily|potentially|appears?|looks?|possibly|possible|perhaps|probably|likely|unlikely|uncertain|uncertainty|tentative|tentatively|unconfirmed|unverified|unknown|hypothesis|hypothetical|suspect|suggests?|seems?|approximately|about|only|unless|except)\b|可能|也许|或许|大概|似乎|尚未|未经|未必|不一定|不确定|推测|假设|疑似|待验证|有待|初步|仍需|看来|尚不|不能|并非|没有|不是|否|不|未|仅|约/giu
const GRAMMAR = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being'])
function contentTokens(text: string): string[] {
  const tokens = text.toLowerCase().match(/[\p{L}\p{M}]+|\p{N}+|[\p{S}\p{Pd}*/^%_()\[\]{}\\]/gu) || []
  const operator = /^[=+*/^<>≤≥≠≈−±×÷∝_-]$/u
  return tokens.filter((token, index) => !GRAMMAR.has(token) || operator.test(tokens[index - 1] || '') || operator.test(tokens[index + 1] || ''))
}
const NEUTRAL_HEADINGS = new Set([
  'notes', 'observations', 'observation', 'questions', 'open questions', 'ideas', 'evidence', 'limitations', 'methods', 'method notes', 'results', 'results and observations', 'connections', 'discussion', 'experiments', 'measurements', 'approach', 'details', 'overview', 'uncertainty', 'findings', 'questions and uncertainties',
  '笔记', '观察', '观察记录', '问题', '开放问题', '待验证问题', '方法', '方法笔记', '结果', '实验', '实验记录', '证据', '局限', '思路', '关联', '不确定性',
])
const HEADING_LEXEME = /(?:[+\-−][ \t]*)?(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|(?:\d+(?:[.,]\d+)*(?:\.(?=[eE]))?|\.\d+)(?:[eE][+\-−]?\d+)?)|[\p{L}\p{M}\p{N}_]+|\r?\n|[^\s]/gu
function headingTokens(text: string): string[] {
  return (text.toLowerCase().match(HEADING_LEXEME) || []).map(token => token.replace(/[ \t]/g, ''))
}
function headingSentences(source: string): string[] {
  const sentences: string[] = []; let start = 0
  for (const token of source.matchAll(HEADING_LEXEME)) {
    if (!/^[.!?。！？;；\r\n]+$/u.test(token[0])) continue
    const end = token.index + token[0].length
    sentences.push(source.slice(start, end)); start = end
  }
  if (start < source.length) sentences.push(source.slice(start))
  return sentences
}
function assertSourceHeading(heading: string, source: string): void {
  if (!heading) return
  const normalized = heading.toLowerCase().replace(/\s+/g, ' ').trim()
  if (NEUTRAL_HEADINGS.has(normalized)) return
  const qualifiers = (text: string) => [...matches(text.toLowerCase(), QUALIFIERS), ...matches(text, /[?？]/g)].sort()
  const segments = headingSentences(source)
  const proposedTokens = headingTokens(normalized)
  const grounded = segments.some(segment => {
    if (!same(qualifiers(segment), qualifiers(heading))) return false
    const sourceTokens = headingTokens(segment)
    return proposedTokens.length > 0 && sourceTokens.some((_, index) => proposedTokens.every((token, offset) => token === sourceTokens[index + offset]))
  })
  if (!grounded) invalid('group heading must retain assigned source wording and qualifiers or use a neutral structural title')
}
export function assertFaithfulNoteEdit(source: string, edited: string): void {
  if (!edited.trim() || edited.length > source.length * 1.6 + 80) invalid('empty or expanded source block')
  if (!same(technicalAtoms(source), technicalAtoms(edited))) invalid('technical atoms (formulas, code, values, units or citations) changed')
  if (!same(matches(source.toLowerCase(), QUALIFIERS), matches(edited.toLowerCase(), QUALIFIERS))) invalid('source uncertainty or negation changed')
  if (!same(contentTokens(source), contentTokens(edited))) invalid('faithful polishing must preserve meaningful source words and language')
}

interface Group { heading: string; sourceIds: string[] }
function parseGroups(value: unknown, blocks: readonly NoteOrganizationBlock[]): Group[] {
  if (!object(value) || !Array.isArray(value.groups) || !value.groups.length || value.groups.length > blocks.length) invalid('invalid source group mapping')
  const ids = new Set(blocks.map(block => block.id)), seen = new Set<string>()
  const source = blocks.map(block => block.text).join('')
  const groups = value.groups.map(group => {
    if (!object(group) || typeof group.heading !== 'string' || group.heading.length > 120 || /[\r\n<>\[\]`$]/.test(group.heading) || !Array.isArray(group.sourceIds) || !group.sourceIds.length) invalid('invalid source group heading or mapping')
    const heading = group.heading.trim()
    const han = (source.match(/\p{Script=Han}/gu) || []).length, latinWords = (source.match(/[A-Za-z]+/g) || []).length
    if (heading && ((han > latinWords * 2 && !/\p{Script=Han}/u.test(heading)) || (han === 0 && latinWords > 0 && /\p{Script=Han}/u.test(heading)))) invalid('group heading changes the source language')

    const sourceIds = group.sourceIds.map(id => { if (typeof id !== 'string' || !ids.has(id) || seen.has(id)) invalid('unknown or duplicated source block mapping'); seen.add(id); return id })
    assertSourceHeading(heading, sourceIds.map(id => blocks.find(block => block.id === id)!.text).join('\n\n'))
    return { heading, sourceIds }
  })
  if (seen.size !== ids.size) invalid('source block mapping omitted original blocks')
  const placement = new Map<string, { group: number; index: number }>()
  groups.forEach((group, groupIndex) => group.sourceIds.forEach((id, index) => placement.set(id, { group: groupIndex, index })))
  for (let index = 1; index < blocks.length; index++) {
    if (/\n\s*\n$/.test(blocks[index - 1].text)) continue
    const before = placement.get(blocks[index - 1].id)!, after = placement.get(blocks[index].id)!
    if (before.group !== after.group || after.index !== before.index + 1) invalid('source paragraph fragments must remain contiguous and in original order')
  }
  return groups
}
function parseEdits(value: unknown, blocks: readonly NoteOrganizationBlock[]): Map<string, string> {
  if (!object(value) || !Array.isArray(value.blocks) || value.blocks.length !== blocks.length) invalid('incomplete source block mapping')
  const originals = new Map(blocks.map(block => [block.id, block.text])), result = new Map<string, string>()
  for (const block of value.blocks) {
    if (!object(block) || typeof block.sourceId !== 'string' || !originals.has(block.sourceId) || result.has(block.sourceId) || !(block.text === null || typeof block.text === 'string')) invalid('unknown or duplicated source block mapping')
    const source = originals.get(block.sourceId)!
    const text = block.text === null ? source : block.text as string
    if (text !== source) assertFaithfulNoteEdit(source, text)
    result.set(block.sourceId, text)
  }
  return result
}
function cancelled(signal: AbortSignal): void { if (signal.aborted) throw new Error('Note organization cancelled') }

export async function runNoteOrganizationRecipe(input: NoteOrganizationRecipe, requestJson: NoteOrganizationRequestJson, signal: AbortSignal, onPreview?: (markdown: string) => void): Promise<string> {
  const recipe = validateNoteOrganizationRecipe(input)
  const { limits, prompts } = recipe
  cancelled(signal)
  async function stage<T>(data: Record<string, unknown>, instruction: string, validate: (value: unknown) => T): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      cancelled(signal)
      const result = await requestJson({ system: prompts.system, user: JSON.stringify({ ...data, instruction, ...(attempt ? { repair: prompts.repair } : {}) }), signal })
      cancelled(signal)
      try { return validate(result) } catch (error) { if (attempt >= limits.maxRepairAttempts) throw error }
    }
  }
  const descriptors = recipe.blocks.map((block, index) => ({ id: block.id, ...(index && !/\n\s*\n$/.test(recipe.blocks[index - 1].text) ? { continues: recipe.blocks[index - 1].id } : {}), excerpt: block.text.length <= 96 ? block.text : `${block.text.slice(0, 64)} … ${block.text.slice(-24)}` }))
  const planData = { stage: 'plan', blocks: descriptors }
  if (JSON.stringify({ ...planData, instruction: prompts.plan, repair: prompts.repair }).length > limits.maxPlanChars) invalid('source planning exceeds its bounded request limit')
  const groups = await stage(planData, prompts.plan, value => parseGroups(value, recipe.blocks))
  const byId = new Map(recipe.blocks.map(block => [block.id, block]))
  const ordered = groups.flatMap(group => group.sourceIds.map(id => byId.get(id)!))
  const chunks: NoteOrganizationBlock[][] = []; let chunk: NoteOrganizationBlock[] = [], characters = 0
  for (const block of ordered) {
    if (chunk.length && (characters + block.text.length > limits.maxChunkChars || chunk.length >= limits.maxChunkBlocks)) { chunks.push(chunk); chunk = []; characters = 0 }
    chunk.push(block); characters += block.text.length
  }
  if (chunk.length) chunks.push(chunk)
  const edits = new Map<string, string>()
  const join = (left: string, right: string) => !left ? right : left + (/\n\s*\n$/.test(left) ? '' : left.endsWith('\n') ? '\n' : '\n\n') + right
  function render(completeOnly: boolean): string {
    let output = ''
    for (const group of groups) {
      let body = '', previous: NoteOrganizationBlock | undefined
      for (const id of group.sourceIds) {
        if (!edits.has(id)) { if (body) output = join(output, (group.heading ? `## ${group.heading}\n\n` : '') + body); return output }
        const block = byId.get(id)!
        body = previous && previous.end === block.start && !/\n\s*\n$/.test(previous.text) ? body + edits.get(id)! : join(body, edits.get(id)!)
        previous = block
      }
      if (body) output = join(output, (group.heading ? `## ${group.heading}\n\n` : '') + body)
    }
    if (!completeOnly && output.length > limits.maxOutputChars) invalid('organized output exceeds its frozen output limit')
    return output
  }
  for (let index = 0; index < chunks.length; index++) {
    const blocks = chunks[index]
    const result = await stage({ stage: 'organize', blocks: blocks.map(({ id, text }) => ({ id, text })) }, prompts.organize, value => parseEdits(value, blocks))
    for (const [id, text] of result) edits.set(id, text)
    const preview = render(index < chunks.length - 1)
    if (preview.length > limits.maxOutputChars) invalid('organized output exceeds its frozen output limit')
    if (preview) onPreview?.(preview)
  }
  cancelled(signal)
  return render(false)
}
