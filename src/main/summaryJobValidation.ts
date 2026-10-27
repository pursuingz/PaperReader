import { object, validId } from './validation'
import type { SummaryJobQuery, SummaryResumeRequest } from '../shared/summaryJobTypes'
export function validateSummaryJobQuery(value: unknown): SummaryJobQuery {
 object(value)
 if(Object.keys(value).sort().join(',')!=='language,paperId'||!['en','zh'].includes(value.language as string))throw new Error('Invalid Summary job query')
 validId(value.paperId)
 return {paperId:value.paperId,language:value.language as SummaryJobQuery['language']}
}
export function validateSummaryResumeRequest(value: unknown): SummaryResumeRequest {
 object(value)
 if(Object.keys(value).sort().join(',')!=='checkpointId,paperId,requestId'||typeof value.checkpointId!=='string'||!/^[a-f0-9]{64}$/.test(value.checkpointId))throw new Error('Invalid Summary checkpoint identity')
 validId(value.paperId);validId(value.requestId)
 return {paperId:value.paperId,requestId:value.requestId,checkpointId:value.checkpointId}
}
