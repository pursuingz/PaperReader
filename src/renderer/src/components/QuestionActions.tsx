import { CornerDownLeft } from 'lucide-react'
import './conversationTools.css'

export interface QuestionActionsProps { content: string; disabled: boolean; onReuse(question: string): void }

export default function QuestionActions({ content, disabled, onReuse }: QuestionActionsProps) {
  return <div className="question-actions"><button type="button" aria-label="Reuse question" title="Edit this question in the composer; sending uses your current context" disabled={disabled || !content.trim()} onClick={() => onReuse(content)}><CornerDownLeft size={12}/>Reuse question</button></div>
}
