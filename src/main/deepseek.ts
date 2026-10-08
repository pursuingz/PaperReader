import type { AIProgress, AIRequest, AIResult, PdfTextPage, EffectiveAIRequest } from '../shared/types'
import { validId, validateRequest, validateSettings } from './validation'
import { PAPER_AI_SYSTEM_PROMPT, GENERAL_AI_SYSTEM_PROMPT, ORGANIZE_NOTES_QUESTION, NOTE_ORGANIZATION_PREFIX } from '../shared/aiPrompts'
import { readDeepSeekStream, SafeProviderError } from './deepseekStream'
export { generatePaperSummary, summarizeDeepSeek, SUMMARY_CHUNK_CHARACTERS } from './summary'

export class AIJobs {
  private active = new Map<string, AbortController>()
  private summaryPapers = new Set<string>()
  async run<T>(requestId: string, paperId: string, kind: 'chat' | 'summary', operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    validId(requestId); validId(paperId)
    if (this.active.has(requestId)) throw new Error('Request identifier is already active')
    if (kind === 'summary' && this.summaryPapers.has(paperId)) throw new Error('A summary for this paper is already active. Wait or cancel it first.')
    if (this.active.size >= 4) throw new Error('Too many active AI requests. Wait or cancel an existing request.')
    const controller = new AbortController(); this.active.set(requestId, controller)
    if (kind === 'summary') this.summaryPapers.add(paperId)
    try { return await operation(controller.signal) } finally {
      this.active.delete(requestId)
      if (kind === 'summary') this.summaryPapers.delete(paperId)
    }
  }
  cancel(requestId: string): void { validId(requestId); this.active.get(requestId)?.abort() }
  cancelAll(): void { for (const controller of this.active.values()) controller.abort() }
}
const RECENT_HISTORY_MESSAGES = 20
const RECENT_HISTORY_CHARACTERS = 60_000
// Keep room for the renderer's saved suggestion label; the boundary test checks
// this against appendAIResponse so a future wording change cannot overflow storage.
const ORGANIZATION_PREFIX = NOTE_ORGANIZATION_PREFIX

function recentHistory(request: AIRequest): AIRequest['history'] {
  if (request.context.mode === 'notes') return []
  const recent = request.history.filter(message => !(message as { isDemo?: boolean }).isDemo).slice(-RECENT_HISTORY_MESSAGES)
  let characters = 0; let start = recent.length
  for (let index = recent.length - 1; index >= 0; index--) {
    if (characters + recent[index].content.length > RECENT_HISTORY_CHARACTERS) break
    characters += recent[index].content.length; start = index
  }
  return recent.slice(start).map(message => ({ role: message.role, content: message.content }))
}

export function buildPayload(request: AIRequest, model: string) {
  validateRequest(request)
  const contextMode = request.context.mode ?? 'page'
  const sources: { page?: PdfTextPage; selection?: string; pages?: PdfTextPage[]; pageCount?: number; coveredPages?: number[]; missingPages?: number[]; note?: string } = {}
  if (contextMode === 'page') {
    sources.page = { page: request.context.page, text: request.context.pageText }
    if (request.context.selection !== undefined) sources.selection = request.context.selection
  }
  if (contextMode === 'paper' || contextMode === 'paper-notes') {
    // Reconstruct each page so renderer-only or unknown fields never reach the provider.
    sources.pages = request.context.pages!.map(page => ({ page: page.page, text: page.text }))
    sources.pageCount = sources.pages.length
    sources.coveredPages = sources.pages.filter(page => page.text.trim()).map(page => page.page)
    sources.missingPages = sources.pages.filter(page => !page.text.trim()).map(page => page.page)
  }
  if (contextMode === 'notes' || contextMode === 'paper-notes') sources.note = request.context.note!
  return { model, thinking: { type: 'disabled' }, stream: false, max_tokens: 4096, messages: [
    { role: 'system', content: PAPER_AI_SYSTEM_PROMPT },
    ...recentHistory(request),
    { role: 'user', content: JSON.stringify({ contextMode, paperTitle: request.context.paperTitle, sources, question: request.action === 'organize-notes' ? ORGANIZE_NOTES_QUESTION : request.question }) }
  ] }
}

export function buildPaperEffectiveRequest(request: AIRequest, model: string, stream = true): EffectiveAIRequest {
  validateSettings({model})
  const payload = buildPayload(request, model)
  return { version: 1, promptVersion: 'paper-v1', model, thinking: {type:'disabled'}, stream, tokenBudgets:[4096,8192], maxCharacters: 200_000 - (request.action === 'organize-notes' ? ORGANIZATION_PREFIX.length : 0), messages: payload.messages.map(message => ({role:message.role as 'system'|'user'|'assistant',content:message.content})) }
}

export function buildGeneralEffectiveRequest(question: string, history: Array<{role:'user'|'assistant';content:string}>, model: string, stream = true): EffectiveAIRequest {
  validateSettings({model})
  if (typeof question !== 'string' || !question.trim() || question.length > 20_000 || !Array.isArray(history) || history.length > 1000) throw new Error('Invalid general conversation request')
  if (history.some(message => !message || !['user','assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 200_000)) throw new Error('Invalid general conversation history')
  const recent=history.slice(-RECENT_HISTORY_MESSAGES);let start=recent.length,characters=0
  for(let index=recent.length-1;index>=0;index--){if(characters+recent[index].content.length>RECENT_HISTORY_CHARACTERS)break;characters+=recent[index].content.length;start=index}
  return {version:1,promptVersion:'general-v1',model,thinking:{type:'disabled'},stream,tokenBudgets:[4096,8192],maxCharacters:200_000,messages:[{role:'system',content:GENERAL_AI_SYSTEM_PROMPT},...recent.slice(start).map(message=>({role:message.role,content:message.content})),{role:'user',content:question.trim()}]}
}

export type EffectiveAIProgress = {attempt:1|2;type:'reset'}|{attempt:1|2;type:'delta';content:string}

function checkCancellation(signal: AbortSignal, timeout: AbortSignal): void {
  if (signal.aborted) throw new SafeProviderError('Request cancelled')
  if (timeout.aborted) throw new SafeProviderError('DeepSeek timed out after 60 seconds. Please retry.')
}
function readableChoice(data: unknown): { message?: { content?: unknown }; finish_reason?: unknown } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SafeProviderError('DeepSeek returned an invalid response format. Please retry.')
  const choices = (data as { choices?: unknown }).choices
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object' || Array.isArray(choices[0])) throw new SafeProviderError('DeepSeek returned an invalid response format. Please retry.')
  return choices[0]
}
export async function executeEffectiveAI(input: EffectiveAIRequest, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch, onProgress?: (progress: EffectiveAIProgress) => void): Promise<string> {
  if (!key) throw new Error('Open Settings and enter your DeepSeek API key before asking AI.')
  if (signal.aborted) throw new Error('Request cancelled')
  const payload = structuredClone(input)
  const maxCharacters = payload.maxCharacters
  const timeout = AbortSignal.timeout(60_000)
  const combinedSignal = AbortSignal.any([signal, timeout])
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      checkCancellation(signal, timeout)
      const identity = { attempt: (attempt + 1) as 1 | 2 }
      onProgress?.({ ...identity, type: 'reset' })
      checkCancellation(signal, timeout)
      const response = await fetcher('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({model:payload.model,thinking:payload.thinking,messages:payload.messages,stream:payload.stream,max_tokens:payload.tokenBudgets[attempt]}), signal: combinedSignal })
      checkCancellation(signal, timeout)
      if (!response.ok) {
        if (response.status === 401) throw new SafeProviderError('DeepSeek rejected the API key. Check Settings.')
        if (response.status === 402) throw new SafeProviderError('DeepSeek account balance is insufficient.')
        if (response.status === 429) throw new SafeProviderError('DeepSeek rate limit reached. Try again shortly.')
        throw new SafeProviderError(`DeepSeek request failed (HTTP ${response.status}).`)
      }
      let choice: ReturnType<typeof readableChoice>
      if (payload.stream) {
        const streamed = await readDeepSeekStream(response, combinedSignal, content => {
          checkCancellation(signal, timeout)
          onProgress?.({ ...identity, type: 'delta', content })
        }, maxCharacters)
        choice = { finish_reason: streamed.finishReason, message: { content: streamed.content } }
      } else {
        let data: unknown
        try { data = await response.json() } catch { throw new SafeProviderError('DeepSeek returned an invalid JSON response. Please retry.') }
        choice = readableChoice(data)
      }
      checkCancellation(signal, timeout)
      if (choice.finish_reason === 'length') {
        if (attempt === 0) continue
        throw new SafeProviderError('DeepSeek response was truncated after 2 attempts. Ask for a shorter answer and retry.')
      }
      // Missing finish_reason remains compatible with older providers; any explicit
      // non-success reason must never be persisted as an apparently complete answer.
      if (choice.finish_reason !== undefined && choice.finish_reason !== 'stop') throw new SafeProviderError('DeepSeek did not return a complete response. Please retry.')
      const content = choice.message?.content
      if (typeof content !== 'string' || !content.trim()) throw new SafeProviderError('DeepSeek returned no readable response.')
      if (content.length > maxCharacters) throw new SafeProviderError('DeepSeek response exceeds the 200000 character storage limit. Ask for a shorter answer and retry.')
      return content
    }
    throw new SafeProviderError('DeepSeek did not return a complete response. Please retry.')
  } catch (error) {
    if (signal.aborted) throw new Error('Request cancelled')
    if (timeout.aborted || (error instanceof Error && error.name === 'TimeoutError')) throw new Error('DeepSeek timed out after 60 seconds. Please retry.')
    if (error instanceof SafeProviderError) throw error
    throw new Error('Cannot reach DeepSeek. Check your network connection and retry.')
  }
}

export async function askDeepSeek(request: AIRequest, model: string, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch, onProgress?: (progress: AIProgress) => void): Promise<AIResult> {
  const content = await executeEffectiveAI(buildPaperEffectiveRequest(request,model,Boolean(onProgress)),key,signal,fetcher,onProgress ? progress=>onProgress({...progress,requestId:request.requestId,paperId:request.paperId}) : undefined)
  return {requestId:request.requestId,paperId:request.paperId,content}
}
