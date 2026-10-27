import type { AgentDecision, AgentMessage, AgentToolDefinition } from '../shared/agentTypes'
import type { AgentProviderProgress } from '../shared/agentChatTypes'
import { agentId } from './agentStorage'
import { boundedText, plain } from './agentValidation'

export interface AgentProviderInput { model: string; messages: AgentMessage[]; tools: AgentToolDefinition[]; images?: string[] }
class AgentProviderError extends Error {}
const invalid = (message: string): never => { throw new AgentProviderError(message) }
function decision(content: unknown, calls: unknown, finish: unknown, usage?: unknown): AgentDecision {
 if (finish !== 'stop' && finish !== 'tool_calls') invalid('DeepSeek did not return a complete Agent response')
 if (content !== null && content !== undefined) boundedText(content, 200_000, false)
 const result: AgentDecision = { content: typeof content === 'string' ? content : '', calls: [] }
 if (calls !== undefined) {
  if (!Array.isArray(calls) || calls.length > 16) invalid('DeepSeek returned too many tool calls')
  const seen = new Set<string>()
  for (const call of calls as unknown[]) {
   if (!plain(call) || call.type !== 'function' || !plain(call.function)) invalid('DeepSeek returned invalid tool call')
   const c = call as { id: unknown; function: { name: unknown; arguments: unknown } }, id = agentId(c.id)
   if (seen.has(id)) invalid('DeepSeek repeated a tool call identifier')
   seen.add(id); boundedText(c.function.name, 80); boundedText(c.function.arguments, 20_000)
   result.calls.push({ id, name: c.function.name, arguments: c.function.arguments })
  }
 }
 if (finish === 'tool_calls' && !result.calls.length || !result.calls.length && !result.content.trim()) invalid('DeepSeek returned no answer or tools')
 if (usage !== undefined) {
  if (!plain(usage) || !Number.isInteger(usage.prompt_tokens) || !Number.isInteger(usage.completion_tokens) || (usage.prompt_tokens as number) < 0 || (usage.completion_tokens as number) < 0) invalid('DeepSeek returned invalid usage')
  result.usage = { inputTokens: (usage as Record<string, number>).prompt_tokens, outputTokens: (usage as Record<string, number>).completion_tokens }
 }
 return result
}

export async function executeAgentDeepSeek(input: AgentProviderInput, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch, onProgress?: (event: AgentProviderProgress) => void): Promise<AgentDecision> {
 if (!key) throw Error('Open Settings and enter your DeepSeek API key before asking AI.')
 if (!/^[\w.-]{1,100}$/.test(input.model) || input.messages.length > 5000 || input.tools.length > 40) throw Error('Invalid Agent provider request')
 const messages = input.messages.map(message => ({ ...structuredClone(message), content: message.content as unknown }))
 if (input.images?.length) {
  if (input.images.length > 12 || input.images.some(url => !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(url))) throw Error('Invalid verified image input')
  const user = [...messages].reverse().find(m => m.role === 'user'); if (!user) throw Error('Image request lacks user input')
  user.content = [{ type: 'text', text: user.content }, ...input.images.map(url => ({ type: 'image_url', image_url: { url } }))]
 }
 const body = JSON.stringify({ model: input.model, thinking: { type: 'disabled' }, stream: true, stream_options: { include_usage: true }, max_tokens: 8192, messages, tools: input.tools, tool_choice: 'auto', parallel_tool_calls: false })
 if (body.length > (input.images?.length ? 36_000_000 : 750_000)) throw Error('Agent context exceeds the request resource budget')
 const timeout = AbortSignal.timeout(90_000), combined = AbortSignal.any([signal, timeout]); if (combined.aborted) throw Error('Agent request cancelled')
 try {
  const response = await fetcher('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body, signal: combined })
  if (!response.ok) throw new AgentProviderError(response.status === 401 ? 'DeepSeek rejected the API key.' : response.status === 402 ? 'DeepSeek account balance is insufficient.' : response.status === 429 ? 'DeepSeek rate limit reached.' : `DeepSeek request failed (HTTP ${response.status}).`)
  if (!response.body) invalid('DeepSeek returned an empty response')
  const reader = response.body!.getReader(), decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0, buffer = '', content = '', finish: unknown, usage: unknown, ended = false
  const calls = new Map<number, { id: string; type: string; function: { name: string; arguments: string } }>()
  const streaming = response.headers.get('content-type')?.includes('text/event-stream')
  const frame = (raw: string) => {
   const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n')
   if (!data) return
   if (data === '[DONE]') { ended = true; return }
   if (ended) invalid('DeepSeek sent content after stream completion')
   let value: unknown; try { value = JSON.parse(data) } catch { invalid('DeepSeek returned an invalid stream frame') }
   if (!plain(value) || !Array.isArray(value.choices) || value.choices.length > 1) invalid('DeepSeek returned an invalid stream response')
   const v = value as Record<string, unknown>
   if (v.usage !== undefined && v.usage !== null) usage = v.usage
   if (!(v.choices as unknown[]).length) return
   const choice = (v.choices as unknown[])[0]
   if (!plain(choice) || choice.index !== 0 || !plain(choice.delta)) invalid('DeepSeek returned an invalid stream choice')
   const c = choice as Record<string, unknown>, delta = c.delta as Record<string, unknown>
   if (finish !== undefined && (typeof delta.content === 'string' && delta.content || delta.tool_calls !== undefined)) invalid('DeepSeek sent content after a finished decision')
   if (delta.content !== undefined && delta.content !== null) {
    boundedText(delta.content, 200_000, false); content += delta.content
    if (content.length > 200_000) invalid('DeepSeek response exceeds resource budget')
    if (delta.content) { try { onProgress?.({ type: 'content', delta: delta.content }) } catch {} }
   }
   if (delta.tool_calls !== undefined) {
    if (!Array.isArray(delta.tool_calls) || delta.tool_calls.length > 16) invalid('DeepSeek returned invalid streamed tool calls')
    for (const rawCall of delta.tool_calls as unknown[]) {
     if (!plain(rawCall) || !Number.isInteger(rawCall.index) || (rawCall.index as number) < 0 || (rawCall.index as number) > 15) invalid('DeepSeek returned invalid tool index')
     const call = rawCall as Record<string, unknown>, index = call.index as number, accumulated = calls.get(index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } }
     if (call.id !== undefined) { boundedText(call.id, 80); accumulated.id += call.id }
     if (call.type !== undefined && call.type !== 'function') invalid('DeepSeek returned invalid tool type')
     if (call.function !== undefined) {
      if (!plain(call.function)) invalid('DeepSeek returned invalid tool fragments')
      const fn = call.function as Record<string, unknown>
      if (fn.name !== undefined) { boundedText(fn.name, 80, false); accumulated.function.name += fn.name }
      if (fn.arguments !== undefined) { boundedText(fn.arguments, 20_000, false); accumulated.function.arguments += fn.arguments }
     }
     if (accumulated.id.length > 80 || accumulated.function.name.length > 80 || accumulated.function.arguments.length > 20_000) invalid('DeepSeek tool call exceeds resource budget')
     calls.set(index, accumulated)
    }
   }
   if (c.finish_reason !== undefined && c.finish_reason !== null) { if (finish !== undefined) invalid('DeepSeek repeated stream completion'); finish = c.finish_reason }
  }
  const abort = () => { void reader.cancel().catch(() => {}) }; combined.addEventListener('abort', abort, { once: true })
  try {
   while (true) {
    if (combined.aborted) throw Error('Agent request cancelled')
    const part = await reader.read(); if (combined.aborted) throw Error('Agent request cancelled'); if (part.done) break
    bytes += part.value.length; if (bytes > 2_000_000) invalid('DeepSeek response exceeds resource budget')
    buffer += decoder.decode(part.value, { stream: true })
    if (streaming) { let boundary: RegExpExecArray | null; while ((boundary = /\r?\n\r?\n/.exec(buffer))) { frame(buffer.slice(0, boundary.index)); buffer = buffer.slice(boundary.index + boundary[0].length) } }
   }
   buffer += decoder.decode()
   if (streaming) { if (buffer.trim()) frame(buffer); if (!ended) invalid('DeepSeek stream ended before completion'); return decision(content, calls.size ? [...calls].sort((a, b) => a[0] - b[0]).map(([, value]) => value) : undefined, finish, usage) }
   let value: unknown; try { value = JSON.parse(buffer) } catch { invalid('DeepSeek returned invalid JSON') }
   if (!plain(value) || !Array.isArray(value.choices) || value.choices.length !== 1 || !plain(value.choices[0]) || !plain(value.choices[0].message)) invalid('DeepSeek returned an invalid tool response')
   const v = value as { choices: Array<{ finish_reason: unknown; message: Record<string, unknown> }>; usage?: unknown }, c = v.choices[0]
   return decision(c.message.content, c.message.tool_calls, c.finish_reason, v.usage)
  } finally { combined.removeEventListener('abort', abort); if (!ended) await reader.cancel().catch(() => {}); reader.releaseLock() }
 } catch (error) {
  if (signal.aborted) throw Error('Agent request cancelled')
  if (timeout.aborted) throw Error('DeepSeek timed out after 90 seconds')
  if (error instanceof AgentProviderError) throw error
  throw Error('Cannot reach DeepSeek. Check your connection and retry.')
 }
}
