/** Errors in this class contain only application-authored text, never provider data. */
export class SafeProviderError extends Error {}

// A maximum-size answer may arrive in one JSON event with every character escaped.
// Bound both unfinished lines and accumulated data without limiting network chunks.
const MAX_EVENT_CHARACTERS = 1_250_000
const DECODE_BYTES = 16_384
const invalidStream = () => new SafeProviderError('DeepSeek returned an invalid streaming response. Please retry.')

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Return only a terminal SSE answer. Deltas are temporary and must never be persisted. */
export async function readDeepSeekStream(
  response: Response,
  signal: AbortSignal,
  onDelta: (content: string) => void,
  maxCharacters: number
): Promise<{ content: string; finishReason: 'stop' | 'length' }> {
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream' || !response.body) {
    void response.body?.cancel().catch(() => undefined)
    throw invalidStream()
  }
  signal.throwIfAborted()
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let content = '', finishReason: 'stop' | 'length' | null = null, finished = false
  let line = '', skipLineFeed = false, dataLines: string[] = [], eventCharacters = 0, eventType = ''
  let cancelled = false
  const cancelReader = () => {
    if (cancelled) return
    cancelled = true
    // Do not wait for a stalled underlying source's cancel promise.
    void reader.cancel().catch(() => undefined)
  }
  let rejectAbort!: (reason: unknown) => void
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  void aborted.catch(() => undefined)
  const abort = () => { rejectAbort(signal.reason ?? new DOMException('Aborted', 'AbortError')); cancelReader() }
  signal.addEventListener('abort', abort, { once: true })

  function dispatch(): void {
    signal.throwIfAborted()
    if (!dataLines.length) { eventType = ''; return }
    const data = dataLines.join('\n')
    dataLines = []; eventCharacters = 0
    const type = eventType; eventType = ''
    if (type === 'error') throw new SafeProviderError('DeepSeek reported a streaming response error. Please retry.')
    if (data === '[DONE]') {
      if (!finishReason) throw new SafeProviderError('DeepSeek ended the stream without a complete response. Please retry.')
      finished = true
      return
    }
    let value: unknown
    try { value = JSON.parse(data) } catch { throw invalidStream() }
    if (!record(value)) throw invalidStream()
    if (value.error !== undefined) throw new SafeProviderError('DeepSeek reported a streaming response error. Please retry.')
    if (!Array.isArray(value.choices)) throw invalidStream()
    // Accept compatible usage-only chunks without adding them to the answer.
    if (value.choices.length === 0) return
    if (value.choices.length !== 1 || !record(value.choices[0]) || finishReason) throw invalidStream()
    const choice = value.choices[0]
    if (choice.index !== 0 || !record(choice.delta)) throw invalidStream()
    const delta = choice.delta
    if (delta.role !== undefined && delta.role !== 'assistant') throw invalidStream()
    if (delta.function_call != null || (delta.tool_calls != null && (!Array.isArray(delta.tool_calls) || delta.tool_calls.length))) throw invalidStream()
    const reason = choice.finish_reason
    if (reason != null && reason !== 'stop' && reason !== 'length') throw new SafeProviderError('DeepSeek did not return a complete response. Please retry.')
    if (delta.content != null) {
      if (typeof delta.content !== 'string') throw invalidStream()
      if (content.length + delta.content.length > maxCharacters) throw new SafeProviderError('DeepSeek response exceeds the 200000 character storage limit. Ask for a shorter answer and retry.')
      if (delta.content) {
        content += delta.content
        onDelta(delta.content)
        signal.throwIfAborted()
      }
    }
    if (reason === 'stop' || reason === 'length') finishReason = reason
  }

  function boundLine(): void {
    if (line.length + eventCharacters > MAX_EVENT_CHARACTERS) throw new SafeProviderError('DeepSeek streaming event exceeds the response size limit. Please retry.')
  }
  function finishLine(): void {
    if (!line) dispatch()
    else if (!line.startsWith(':')) {
      const separator = line.indexOf(':')
      const field = separator < 0 ? line : line.slice(0, separator)
      let value = separator < 0 ? '' : line.slice(separator + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'data') {
        dataLines.push(value); eventCharacters += value.length + 1
        if (eventCharacters > MAX_EVENT_CHARACTERS) throw new SafeProviderError('DeepSeek streaming event exceeds the response size limit. Please retry.')
      }
      if (field === 'event') eventType = value
    }
    line = ''
  }
  function feed(text: string): void {
    let start = 0
    if (skipLineFeed && text.length) { if (text[0] === '\n') start = 1; skipLineFeed = false }
    for (let index = start; index < text.length; index++) {
      const character = text[index]
      if (character !== '\n' && character !== '\r') continue
      line += text.slice(start, index); boundLine(); finishLine()
      if (finished) return
      if (character === '\r') {
        if (text[index + 1] === '\n') index++
        else if (index === text.length - 1) skipLineFeed = true
      }
      start = index + 1
    }
    line += text.slice(start); boundLine()
  }
  function decode(bytes?: Uint8Array, streaming = false): string {
    try { return decoder.decode(bytes, { stream: streaming }) } catch { throw invalidStream() }
  }

  try {
    while (!finished) {
      signal.throwIfAborted()
      const next = await Promise.race([reader.read(), aborted])
      signal.throwIfAborted()
      if (next.done) {
        feed(decode())
        if (!finished) throw new SafeProviderError('DeepSeek streaming response was interrupted before completion. Please retry.')
        break
      }
      for (let offset = 0; offset < next.value.length && !finished; offset += DECODE_BYTES) {
        signal.throwIfAborted()
        feed(decode(next.value.subarray(offset, offset + DECODE_BYTES), true))
      }
    }
    signal.throwIfAborted()
    if (finishReason === 'stop' && !content.trim()) throw new SafeProviderError('DeepSeek returned no readable response.')
    if (!finishReason) throw invalidStream()
    return { content, finishReason }
  } finally {
    signal.removeEventListener('abort', abort)
    cancelReader()
    reader.releaseLock()
  }
}
