import type { AIResult, PaperState } from '../../shared/types'

/** A missing PDF must not turn recovered notes into a writable empty state. */
export function recoverPaperState(result: PromiseSettledResult<PaperState>): PaperState | null {
    return result.status === 'fulfilled'
        ? { ...result.value, lastPage: Math.max(1, result.value.lastPage) }
        : null
}

/** Cancelled or superseded requests have no right to mutate a paper. */
export function acceptsAIResult(activeId: string | null, requestId: string, paperId: string, result: AIResult): boolean {
    return activeId === requestId && result.requestId === requestId && result.paperId === paperId
}

/** Tokens are allocated synchronously at click time, before cancellation awaits. */
export async function continueLatestTransition(token: number, currentToken: () => number, cancellation: Promise<void>): Promise<boolean> {
    await cancellation
    return token === currentToken()
}

/** Debouncing delays the read as well as the write, so new chat/page state survives. */
export function deferredPaperStateSave(
    paperId: string,
    current: () => { paper: { id: string } | null; state: PaperState; loaded: boolean },
    save: (paperId: string, state: PaperState) => Promise<void>
): () => Promise<void> {
    return async () => {
        const latest = current()
        if (latest.paper?.id !== paperId || !latest.loaded) return
        await save(paperId, latest.state)
    }
}
