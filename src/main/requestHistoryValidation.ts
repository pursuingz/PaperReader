import { validateAIImages, validateChatNotesSelection, validateChatNotesSnapshot } from './aiSourceValidation'
import { validateNoteOrganizationRecipe } from './noteOrganization'
import { validId } from './validation'
import type { AIImageReference, ChatNotesSnapshot } from '../shared/aiSourceTypes'
import type { AIRequestContext, AIRequestHistory, AIRequestOwner, EffectiveAIRequest } from '../shared/requestTypes'
import { GENERAL_AI_SYSTEM_PROMPT, PAPER_AI_SYSTEM_PROMPT } from '../shared/aiPrompts'
import { object, text, validateRequest, validateSettings } from './validation'

export const REQUEST_SNAPSHOT_LIMIT = 4 * 1024 * 1024
export const REQUEST_MANIFEST_LIMIT = 1024 * 1024
export const REQUEST_SCOPE_LIMIT = 128 * 1024 * 1024
export const REQUEST_RECORD_LIMIT = 1000
export function requestFields(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid request fields')
}
export function requestUUID(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error('Invalid request UUID identifier')
}
export function requestOwnerKey(owner: AIRequestOwner) { return owner.scope === 'paper' ? `paper:${owner.paperId}` : `general:${owner.conversationId}` }
export function validateRequestOwner(value: unknown): asserts value is AIRequestOwner {
  object(value)
  if (value.scope === 'paper') { requestFields(value, ['scope', 'paperId']); requestUUID(value.paperId) }
  else if (value.scope === 'general') { requestFields(value, ['scope', 'conversationId']); requestUUID(value.conversationId) }
  else throw new Error('Invalid request owner scope')
}
export function validateRequestContext(value: unknown): asserts value is AIRequestContext {
  object(value); requestFields(value, ['label', 'mode', 'action', 'page', 'selectionCharacters', 'images', 'notesSelection']); text(value.label, 300)
  if(value.images!==undefined){validateAIImages(value.images);if(value.mode==='general'||value.action==='organize-notes')throw Error('Invalid image context')}
  if(value.notesSelection!==undefined){validateChatNotesSelection(value.notesSelection);if(!['notes','paper-notes'].includes(value.mode as string))throw Error('Invalid notes selection context')}
  if (!value.label.trim() || !['page', 'paper', 'notes', 'paper-notes', 'general'].includes(value.mode as string) || !['ask', 'organize-notes'].includes(value.action as string)) throw new Error('Invalid request context')
  if (value.page !== null && (!Number.isSafeInteger(value.page) || (value.page as number) < 1 || (value.page as number) > 100000)) throw new Error('Invalid request context page')
  if (!Number.isSafeInteger(value.selectionCharacters) || (value.selectionCharacters as number) < 0 || (value.selectionCharacters as number) > 30000) throw new Error('Invalid request selection size')
  if (value.mode === 'general' && (value.page !== null || value.action !== 'ask' || value.selectionCharacters !== 0)) throw new Error('Invalid general request context')
  if (value.action === 'organize-notes' && value.mode !== 'notes') throw new Error('Invalid notes organization context')
}
function validatePaperBody(content: string, extras?:{images:AIImageReference[];notesSnapshot?:ChatNotesSnapshot}) {
  let body: unknown
  try { body = JSON.parse(content) } catch { throw new Error('Invalid paper request body') }
  object(body); requestFields(body, ['contextMode', 'paperTitle', 'sources', 'question']); object(body.sources)
  requestFields(body.sources, ['page', 'selection', 'pages', 'pageCount', 'coveredPages', 'missingPages', 'note', ...(extras?['notesSnapshot','imageSources']:[])])
  const sources = body.sources
  if (sources.page !== undefined) { object(sources.page); requestFields(sources.page, ['page', 'text']) }
  if (sources.pages !== undefined) {
    if (!Array.isArray(sources.pages) || sources.pages.length > 200) throw new Error('Invalid paper page limit')
    for (const page of sources.pages) { object(page); requestFields(page, ['page', 'text']) }
    const covered = sources.pages.filter(page => typeof page.text === 'string' && page.text.trim()).map(page => page.page)
    const missing = sources.pages.filter(page => typeof page.text === 'string' && !page.text.trim()).map(page => page.page)
    if (sources.pageCount !== sources.pages.length || JSON.stringify(sources.coveredPages) !== JSON.stringify(covered) || JSON.stringify(sources.missingPages) !== JSON.stringify(missing)) throw new Error('Invalid paper page coverage')
  } else if (sources.pageCount !== undefined || sources.coveredPages !== undefined || sources.missingPages !== undefined) throw new Error('Invalid paper page coverage')
  const mode = body.contextMode
  if (mode === 'page' && (sources.pages !== undefined || sources.note !== undefined || sources.notesSnapshot!==undefined || !sources.page)) throw new Error('Invalid page request sources')
  if (mode !== 'page' && (sources.page !== undefined || sources.selection !== undefined)) throw new Error('Invalid paper request sources')
  if (mode === 'notes' && sources.pages !== undefined || mode === 'paper' && (sources.note !== undefined||sources.notesSnapshot!==undefined)) throw new Error('Invalid request sources')
  if(extras&&sources.imageSources!==undefined&&JSON.stringify(sources.imageSources)!==JSON.stringify(extras.images))throw Error('Frozen image provenance mismatch')
  if(extras&&JSON.stringify(sources.notesSnapshot)!==JSON.stringify(extras.notesSnapshot))throw Error('Frozen notes source mismatch')
  validateRequest({ ...(extras?{attachments:extras.images}:{}), requestId: 'validation', paperId: 'validation', question: body.question, context: { mode, paperTitle: body.paperTitle, page: sources.page?.page ?? 1, pageText: sources.page?.text ?? '', ...(sources.selection === undefined ? {} : { selection: sources.selection }), ...(sources.pages === undefined ? {} : { pages: sources.pages }), ...(sources.note === undefined ? {} : { note: sources.note }), ...(sources.notesSnapshot===undefined?{}:{notesSnapshot:sources.notesSnapshot}) }, history: [] })
}
export function validateEffectiveAIRequest(value: unknown): asserts value is EffectiveAIRequest {
  object(value); requestFields(value, ['version', 'promptVersion', 'model', 'messages', 'thinking', 'stream', 'tokenBudgets', 'maxCharacters', ...(value.version===2?['paperId','images','notesSnapshot','recipe']:[])])
  if(value.version===1){if(!['paper-v1','general-v1'].includes(value.promptVersion as string))throw Error('Invalid request prompt version')}
  else if(value.version===2){
    if(!['paper-v2','organization-v2'].includes(value.promptVersion as string))throw Error('Invalid request prompt version')
    validId(value.paperId);const refs=validateAIImages(value.images);if(refs.length!==(value.images as unknown[]).length)throw Error('Duplicate frozen image references')
    if(value.notesSnapshot!==undefined){validateChatNotesSnapshot(value.notesSnapshot);for(const ref of value.notesSnapshot.images)if(!refs.some(r=>JSON.stringify(r)===JSON.stringify(ref)))throw Error('Missing frozen notes image')}
    if(value.promptVersion==='organization-v2'){
      const recipe=validateNoteOrganizationRecipe(value.recipe)
      object(value.recipe);requestFields(value.recipe,['version','processingVersion','source','blocks','prompts','limits'])
      object(value.recipe.prompts);requestFields(value.recipe.prompts,['system','plan','organize','repair'])
      object(value.recipe.limits);requestFields(value.recipe.limits,Object.keys(recipe.limits))
      if(!Array.isArray(value.recipe.blocks))throw Error('Invalid organization recipe blocks')
      for(const block of value.recipe.blocks){object(block);requestFields(block,['id','text','start','end'])}
      if(refs.length||value.notesSnapshot!==undefined)throw Error('Organization is Text only')
      if(!Array.isArray(value.messages)||value.messages.length!==2||value.messages[0]?.content!==recipe.prompts.system)throw Error('Organization recipe system or message envelope mismatch')
      const body=JSON.parse(value.messages.at(-1)?.content??'{}')
      if(body.contextMode!=='notes'||body.sources?.note!==recipe.source)throw Error('Organization source mismatch')
      object(body.sources);requestFields(body.sources,['note'])
    }
    else if(value.recipe!==undefined)throw Error('Unexpected organization recipe')
  }else throw Error('Invalid request prompt version')
  validateSettings({ model: value.model }); object(value.thinking); requestFields(value.thinking, ['type'])
  if (value.thinking.type !== 'disabled' || typeof value.stream !== 'boolean' || !Array.isArray(value.tokenBudgets) || value.tokenBudgets.length !== 2 || value.tokenBudgets[0] !== 4096 || value.tokenBudgets[1] !== 8192) throw new Error('Invalid request token budget or thinking policy')
  if (!Number.isSafeInteger(value.maxCharacters) || (value.maxCharacters as number) < 1 || (value.maxCharacters as number) > 200000) throw new Error('Invalid response character limit')
  if (!Array.isArray(value.messages) || value.messages.length < 2 || value.messages.length > 22) throw new Error('Invalid request message limit')
  for (const [index, message] of value.messages.entries()) {
    object(message); requestFields(message, ['role', 'content']); text(message.content, REQUEST_SNAPSHOT_LIMIT)
    if (index === 0 ? message.role !== 'system' : !['user', 'assistant'].includes(message.role as string)) throw new Error('Invalid request message role')
  }
  const expectedPrompt = value.promptVersion === 'paper-v1' ? PAPER_AI_SYSTEM_PROMPT : GENERAL_AI_SYSTEM_PROMPT
  if ((value.version===1&&value.messages[0].content !== expectedPrompt) || !value.messages[0].content.trim() || value.messages.at(-1)!.role !== 'user') throw new Error('Invalid canonical system prompt')
  let recentCharacters = 0
  for (const message of value.messages.slice(1, -1)) { text(message.content, 200000); recentCharacters += message.content.length }
  if (recentCharacters > 60000) throw new Error('Invalid recent history character limit')
  const last = value.messages.at(-1)!.content
  if(value.version===2) validatePaperBody(last,{images:value.images as AIImageReference[],notesSnapshot:value.notesSnapshot as ChatNotesSnapshot|undefined})
  else if (value.promptVersion === 'paper-v1') validatePaperBody(last)
  else { text(last, 20000); if (!last.trim() || last !== last.trim()) throw new Error('Invalid general question') }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > REQUEST_SNAPSHOT_LIMIT) throw new Error('Request snapshot exceeds the 4 MiB limit')
}
export function validateRequestHistory(value: unknown, owner: AIRequestOwner): asserts value is AIRequestHistory {
  object(value); requestFields(value, ['version', 'owner', 'records']); validateRequestOwner(value.owner)
  if (value.version !== 1 || requestOwnerKey(value.owner) !== requestOwnerKey(owner)) throw new Error('Invalid request manifest owner')
  if (!Array.isArray(value.records) || value.records.length > REQUEST_RECORD_LIMIT) throw new Error('Request manifest record limit exceeded')
  const ids = new Set<string>(), requests = new Map<string, Record<string, unknown>>()
  for (const record of value.records) {
    object(record); requestFields(record, ['requestId', 'snapshotId', 'userMessageId', 'assistantMessageId', 'retryOf', 'createdAt', 'status', 'context', 'model', 'userSha256', 'snapshotSha256', 'answerSha256'])
    for (const field of ['requestId', 'userMessageId', 'assistantMessageId']) { requestUUID(record[field]); if (ids.has(record[field])) throw new Error('Duplicate request manifest identifier'); ids.add(record[field]) }
    requestUUID(record.snapshotId); if (record.retryOf !== null) requestUUID(record.retryOf)
    if (typeof record.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.createdAt) || !Number.isFinite(Date.parse(record.createdAt))) throw new Error('Invalid request timestamp')
    if (!['pending', 'response-ready', 'completed', 'failed', 'cancelled', 'interrupted'].includes(record.status as string)) throw new Error('Invalid request status')
    for (const field of ['userSha256', 'snapshotSha256']) if (typeof record[field] !== 'string' || !/^[0-9a-f]{64}$/.test(record[field])) throw new Error('Invalid request hash')
    if (record.answerSha256 !== undefined && (typeof record.answerSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(record.answerSha256))) throw new Error('Invalid answer hash')
    if (['response-ready', 'completed'].includes(record.status as string) && record.answerSha256 === undefined) throw new Error('Invalid missing answer hash')
    validateSettings({ model: record.model }); validateRequestContext(record.context)
    if ((owner.scope === 'general') !== (record.context.mode === 'general')) throw new Error('Invalid request context owner')
    if (record.retryOf !== null) {
      const parent = requests.get(record.retryOf)
      if (!parent || parent.snapshotId !== record.snapshotId || parent.snapshotSha256 !== record.snapshotSha256 || parent.userSha256 !== record.userSha256 || parent.model !== record.model || JSON.stringify(parent.context) !== JSON.stringify(record.context)) throw new Error('Invalid original retry binding')
    }
    requests.set(record.requestId as string, record)
  }
}

export function validateEffectiveContext(payload:EffectiveAIRequest,context:AIRequestContext,owner:AIRequestOwner):void {
 if(payload.version!==2)return
 if(owner.scope!=='paper'||payload.paperId!==owner.paperId)throw Error('Snapshot paper owner does not match')
 const body=JSON.parse(payload.messages.at(-1)!.content)
 if(body.contextMode!==context.mode||(payload.promptVersion==='organization-v2')!==(context.action==='organize-notes')||JSON.stringify(context.images??[])!==JSON.stringify(payload.images)||JSON.stringify(context.notesSelection)!==JSON.stringify(payload.notesSnapshot?.selection))throw Error('Snapshot source context does not match its historical display')
}
