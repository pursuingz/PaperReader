import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

export default function CopyAnswer({ content, copy }: { content: string; copy(text: string): Promise<void> }) {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const alive = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (timer.current) clearTimeout(timer.current) } }, [])
  async function write() {
    setStatus('copying')
    if (timer.current) clearTimeout(timer.current)
    try {
      await copy(content)
      if (!alive.current) return
      setStatus('copied')
      timer.current = setTimeout(() => setStatus('idle'), 2200)
    } catch { if (alive.current) setStatus('error') }
  }
  return <div className="answer-actions">
    <button aria-label={status === 'copied' ? 'Copied' : 'Copy answer'} disabled={status === 'copying'} onClick={() => void write()}>{status === 'copied' ? <Check size={13}/> : <Copy size={13}/>}{status === 'copied' ? 'Copied' : 'Copy'}</button>
    {status === 'error' && <span role="status">Could not copy. Try again.</span>}
  </div>
}
