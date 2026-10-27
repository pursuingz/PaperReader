export function cleanLocalSpeechOutput(output: string): string {
  return output.replace(/\x1b\[[0-9;]*m/g, '').replace(/<\|[^|\r\n]*\|>/g, '')
    .replace(/\[(?:BLANK_AUDIO|SILENCE|NOISE|MUSIC)\]/gi, '').replace(/\s+/g, ' ').trim()
}

export function localSpeechRunnerError(stderr: string, code: number | null, reason?: 'missing' | 'timeout' | 'limit' | 'cancelled'): Error | undefined {
  if (reason === 'cancelled') return new Error('Local transcription cancelled.')
  if (reason === 'missing') return new Error('Local speech runner is missing or cannot start. Reinstall the portable application.')
  if (reason === 'timeout') return new Error('Local speech runner timed out. Stop and retry a shorter recording.')
  if (reason === 'limit') return new Error('Local speech runner exceeded its transcript limit. Stop and retry a shorter recording.')
  if (/failed to (?:open|load|initialize).*model|whisper_init[^\r\n]*failed to open|failed to initialize whisper context|whisper_model_load:[^\r\n]*(?:failed|invalid|bad|unknown)|unable to (?:open|load).*model|invalid model|model.*(?:not found|does not exist)/i.test(stderr)) return new Error('Local speech model could not be loaded. Reimport the pinned multilingual model.')
  if (/failed to read audio|invalid (?:audio|wav)|unsupported audio|failed to (?:decode|load).*audio/i.test(stderr)) return new Error('Local speech audio could not be decoded. Check the microphone input and retry.')
  if (/output-file -.*without any other.*output-/i.test(stderr)) return new Error('Local speech runner returned no transcript because its stdout output is disabled.')
  if (code !== 0 || /(?:^|\n)(?:error:|whisper_full:.*failed|whisper_init.*failed)/i.test(stderr)) return new Error(`Local speech runner failed${code === null ? '' : ` (exit ${code})`}. Check the packaged runner and model.`)
  return undefined
}

function characters(text: string): { character: string; start: number; end: number }[] {
  const result: { character: string; start: number; end: number }[] = []
  let index = 0
  for (const character of text) {
    if (/[\p{L}\p{N}]/u.test(character)) result.push({ character: character.toLocaleLowerCase('en'), start: index, end: index + character.length })
    index += character.length
  }
  return result
}

export function mergeLocalSpeechOverlap(committed: string, hypothesis: string): string {
  const left = committed.trim(), right = hypothesis.trim()
  if (!left) return right
  if (!right) return left
  const a = characters(left).slice(-300), b = characters(right).slice(0, 300)
  let tail = right
  for (let length = Math.min(a.length, b.length); length >= 2; length--) {
    if (!a.slice(-length).every((value, index) => value.character === b[index].character)) continue
    const first = a[a.length - length]
    if (/[\p{Script=Latin}\p{N}]/u.test(first.character) && /[\p{Script=Latin}\p{N}]/u.test(left[first.start - 1] ?? '')) continue
    const end = b[length - 1].end
    if (/[\p{Script=Latin}\p{N}]/u.test(b[length - 1].character) && /[\p{Script=Latin}\p{N}]/u.test(right[end] ?? '')) continue
    tail = right.slice(end).replace(/^[\p{P}\p{Z}\s]+/u, '')
    break
  }
  if (!tail) return left
  return left + (/[\p{Script=Han}，。！？；：]$/u.test(left) && /^\p{Script=Han}/u.test(tail) ? '' : ' ') + tail
}
