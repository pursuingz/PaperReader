export interface QuestionReuseReview { paperId: string; originalDraft: string; question: string }
export function prepareQuestionReuse(paperId: string, draft: string, question: string):
  { kind: 'fill'; question: string } | { kind: 'review'; review: QuestionReuseReview } {
  if (!question.trim() || question.length > 200_000) throw new Error('Choose a readable question of up to 200,000 characters.')
  return draft.length ? { kind: 'review', review: { paperId, originalDraft: draft, question } } : { kind: 'fill', question }
}
export function commitQuestionReuse(review: QuestionReuseReview, paperId: string | null, draft: string): string {
  if (review.paperId !== paperId) throw new Error('The paper changed. Choose the question again.')
  if (review.originalDraft !== draft) throw new Error('Your draft changed. Close this review and choose the question again.')
  return review.question
}
