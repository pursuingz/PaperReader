export type LiteratureErrorCode='not-found'|'rate-limited'|'timeout'|'network'|'non-pdf'|'invalid-pdf'|'invalid-metadata'|'import-failed'|'source-policy'|'cancelled'|'resource-limit'
export class LiteratureError extends Error {
 constructor(readonly code:LiteratureErrorCode,message:string,readonly retryable:boolean,readonly status?:number,readonly hostname?:string){super(message);this.name='LiteratureError'}
}
export function literatureNetworkError(error:unknown,signal:AbortSignal):LiteratureError{
 if(signal.aborted)return new LiteratureError('cancelled','arXiv acquisition cancelled.',true)
 if(error instanceof LiteratureError)return error
 const text=error instanceof Error?error.message:''
 if(/timed? ?out|timeout/i.test(text))return new LiteratureError('timeout','arXiv request timed out. Retry explicitly.',true)
 if(/\b429\b/.test(text))return new LiteratureError('rate-limited','arXiv rate limit (HTTP 429). Retry later.',true,429)
 return new LiteratureError('network','arXiv connection failed. Retry explicitly.',true)
}
