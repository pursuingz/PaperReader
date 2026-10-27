import type { AIRequestRecord, DesktopAPI, GeneralAIProgress, GeneralAIRequest, GeneralChatMessage, GeneralChatState } from '../../shared/types'

export type GeneralChatAPI = Pick<DesktopAPI, 'loadGeneralChat' | 'saveGeneralChat' | 'askGeneralAI' | 'retryAIRequest' | 'cancelAI'> & Partial<Pick<DesktopAPI,'reanswerAgentChat'>>
export interface GeneralChatOptions { hasApiKey: boolean; onSettings: () => void; onNotice: (message: string) => void; isBlocked?: () => boolean; onRequestStart?(request:{requestId:string;question:string}):void; onRequestFinished?(requestId:string):void }
export interface GeneralChatPreview { requestId: string; conversationId: string; attempt: 1 | 2; content: string }
export interface GeneralChatSnapshot { ready: boolean; busy: boolean; state: GeneralChatState | null; draft: string; preview: GeneralChatPreview | null; status: string; error: string | null }
type Active = GeneralAIRequest & { epoch: number }
const QUESTION_LIMIT = 16000, ANSWER_LIMIT = 200000, MESSAGE_LIMIT = 1000, HISTORY_LIMIT = 2000000
const cleanText = (value: unknown, limit: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'General chat could not finish. Try again.'

/** Session-local draft and preview; only a matching final result becomes a stored assistant. */
export class GeneralChatSession {
  private snapshot: GeneralChatSnapshot = { ready: false, busy: false, state: null, draft: '', preview: null, status: 'Loading general chat…', error: null }
  private listeners = new Set<() => void>()
  private epoch = 0
  private loadGeneration = 0
  private active: Active | null = null
  private cancellation: Promise<void> | null = null
  private tail: Promise<unknown> = Promise.resolve()
  private dirty = false
  constructor(private readonly api: GeneralChatAPI, private options: GeneralChatOptions) {}
  setOptions(options: GeneralChatOptions): void { this.options = options }
  getSnapshot = (): GeneralChatSnapshot => this.snapshot
  get needsSave(): boolean { return this.dirty }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private update(value: Partial<GeneralChatSnapshot>): void { this.snapshot = { ...this.snapshot, ...value }; for (const listener of this.listeners) listener() }
  private fail(error: unknown, status = 'Request failed'): void { const message = messageOf(error); this.update({ error: message, status }); this.options.onNotice(message) }
  setDraft = (draft: string): void => { this.update({ draft }) }
  private current(job: Active): boolean { return this.active === job && job.epoch === this.epoch }
  private write(value: GeneralChatState): Promise<void> {
    const snapshot = structuredClone(value), operation = this.tail.then(() => this.api.saveGeneralChat(snapshot))
    this.tail = operation.catch(() => undefined); return operation
  }
  async load(): Promise<void> {
    if (this.active || this.cancellation || this.dirty) return
    const generation = ++this.loadGeneration
    this.update({ ready: false, state: null, preview: null, error: null, status: 'Loading general chat…' })
    try {
      const state = await this.api.loadGeneralChat()
      if (generation !== this.loadGeneration) return
      this.update({ ready: true, state: structuredClone(state), status: 'Saved locally' })
    } catch (error) { if (generation === this.loadGeneration) this.fail(error, 'General chat unavailable · existing data preserved') }
  }
  retryLoad = (): Promise<void> => this.load()
  async flush(): Promise<void> {
    await this.tail
    if (!this.dirty || !this.snapshot.state) return
    const state = this.snapshot.state
    try {
      await this.write(state)
      if (this.snapshot.state === state) { this.dirty = false; this.update({ error: null, status: 'Saved locally' }) }
    } catch (error) { this.fail(error, 'Complete answer not saved · retry saving'); throw error }
  }
  receiveProgress(event: GeneralAIProgress): void {
    const job = this.active
    if (!job || !this.current(job) || !this.snapshot.ready || event.requestId !== job.requestId || event.conversationId !== job.conversationId || ![1, 2].includes(event.attempt)) return
    const previous = this.snapshot.preview
    if (event.type === 'reset') {
      if (previous && previous.attempt >= event.attempt) return
      this.update({ preview: { requestId: job.requestId, conversationId: job.conversationId, attempt: event.attempt, content: '' }, status: event.attempt === 2 ? 'Retrying response…' : 'Receiving response…' })
    } else if (event.type === 'delta' && previous?.attempt === event.attempt && typeof event.content === 'string' && previous.content.length + event.content.length <= ANSWER_LIMIT) this.update({ preview: { ...previous, content: previous.content + event.content } })
  }
  private canBegin(question: string): boolean {
    if (this.options.isBlocked?.()) return false
    if (!this.snapshot.ready || !this.snapshot.state || this.snapshot.busy) return false
    if (!this.options.hasApiKey) { this.options.onSettings(); this.fail(new Error('Connect DeepSeek in Settings to send a general question.')); return false }
    if (!cleanText(question, QUESTION_LIMIT)) { this.fail(new Error('Write a question of at most 16,000 characters.')); return false }
    if (this.snapshot.state.messages.length + 2 > MESSAGE_LIMIT || this.snapshot.state.messages.reduce((sum, message) => sum + message.content.length, 0) + question.length + ANSWER_LIMIT > HISTORY_LIMIT) { this.fail(new Error('General conversation storage limit reached. Existing messages are preserved.')); return false }
    return true
  }
  send = async (onCommitted?:()=>void): Promise<void> => { const question = this.snapshot.draft.trim(); if (this.canBegin(question)) await this.run(question,undefined,undefined,onCommitted) }
  retryRequest = async (record: AIRequestRecord): Promise<void> => {
    const original = this.snapshot.state?.messages.find(message => message.id === record.userMessageId && message.role === 'user')
    if (record.context.mode !== 'general' || record.context.action !== 'ask' || !original) { this.fail(new Error('The original general question is unavailable.')); return }
    if (this.canBegin(original.content)) await this.run(original.content, record)
  }
  reanswerTask = async(taskId:string,question:string):Promise<void>=>{
    if(!this.api.reanswerAgentChat){this.fail(Error('Saved-answer retry is unavailable in this version.'));return}
    if(this.canBegin(question))await this.run(question,undefined,taskId)
  }
  private async run(question: string, retry?: AIRequestRecord, answerReplayTaskId?:string,onCommitted?:()=>void): Promise<void> {
    const state = this.snapshot.state!
    const job: Active = { epoch: ++this.epoch, requestId: crypto.randomUUID(), conversationId: state.conversationId, userMessageId: crypto.randomUUID(), assistantMessageId: crypto.randomUUID(), question }
    this.options.onRequestStart?.({requestId:job.requestId,question});
    this.active = job; this.update({ busy: true, preview: null, error: null, status: 'Saving question…' })
    try {
      await this.flush(); if (!this.current(job)) return
      const user: GeneralChatMessage = { id: job.userMessageId, role: 'user', content: question, createdAt: new Date().toISOString() }
      const withUser: GeneralChatState = { ...this.snapshot.state!, messages: [...this.snapshot.state!.messages, user] }
      await this.write(withUser)
      // A cancellation during the save still leaves an honestly displayed, saved user question.
      this.update({ state: withUser })
      if (!this.current(job)) return
      if (!retry && !answerReplayTaskId && this.snapshot.draft.trim() === question) this.update({ draft: '' })
      onCommitted?.()
      this.update({ status: answerReplayTaskId?'Answering again from saved sources…':retry ? 'Replaying original request…' : 'Waiting for DeepSeek…' })
      const request: GeneralAIRequest = { requestId: job.requestId, conversationId: job.conversationId, userMessageId: job.userMessageId, assistantMessageId: job.assistantMessageId, question }
      let result:import('../../shared/types').GeneralAIResult|import('../../shared/types').AIReplayResult
      if(answerReplayTaskId){const task=await this.api.reanswerAgentChat!({owner:{kind:'general',id:job.conversationId},taskId:answerReplayTaskId,chatTurn:{requestId:job.requestId,userMessageId:job.userMessageId,assistantMessageId:job.assistantMessageId}});result={requestId:job.requestId,conversationId:job.conversationId,content:task.answer,agentTaskId:task.id,agentStatus:task.status}}
      else result=retry ? await this.api.retryAIRequest({ owner: { scope: 'general', conversationId: job.conversationId }, originalRequestId: retry.requestId, requestId: job.requestId, userMessageId: job.userMessageId, assistantMessageId: job.assistantMessageId }) : await this.api.askGeneralAI(request)
      if (!this.current(job)) return
      if (!('conversationId' in result) || result.requestId !== job.requestId || result.conversationId !== job.conversationId) throw new Error('DeepSeek returned a response for another conversation; no answer was saved.')
      if(typeof result.agentTaskId==='string'&&/^[\w-]{1,200}$/.test(result.agentTaskId)&&['queued','running','waiting-selection','partial','failed','cancelled','interrupted','succeeded'].includes(result.agentStatus??'')&&typeof result.content==='string'&&!result.content.trim()){
        this.update({preview:null,error:null,status:result.agentStatus==='waiting-selection'?'Choose a paper in this turn to continue':result.agentStatus==='failed'?'Request could not finish · see activity':result.agentStatus==='cancelled'?'Task stopped · completed work preserved':'Task progress saved locally'});return
      }
      if (!cleanText(result.content, ANSWER_LIMIT)) throw new Error('DeepSeek returned an invalid or incomplete general response; no answer was saved.')
      if (result.historyWarning) this.options.onNotice(result.historyWarning)
      const assistant: GeneralChatMessage = { id: job.assistantMessageId, role: 'assistant', content: result.content, createdAt: new Date().toISOString() }
      const completed = { ...withUser, messages: [...withUser.messages, assistant] }
      this.dirty = true; this.update({ state: completed, preview: null, status: 'Saving complete answer…' })
      try {
        await this.write(completed)
        if (this.snapshot.state === completed) this.dirty = false
        if (this.current(job)) this.update({ status: 'Saved locally', error: null })
      } catch (error) { if (this.current(job)) this.fail(error, 'Complete answer not saved · retry saving') }
    } catch (error) { if (this.current(job)) this.fail(error) }
    finally { this.options.onRequestFinished?.(job.requestId); if (this.current(job)) { this.active = null; this.update({ busy: false, preview: null }) } }
  }
  cancel = (keepAgent = false): Promise<void> => {
    if (this.cancellation) return this.cancellation
    const job = this.active
    this.active = null; this.epoch++ // Revoke identity before calling or awaiting cancellation.
    this.update({ preview: null, busy: !!job, ...(job ? { status: 'Cancelled · partial response not saved' } : {}) })
    if (!job) return Promise.resolve()
    const operation = this.api.cancelAI(job.requestId, keepAgent ? {keepAgent:true} : undefined).catch(error => { this.fail(error, 'Cancellation could not finish'); throw error }).finally(() => { this.cancellation = null; if (!this.active) this.update({ busy: false }) })
    this.cancellation = operation; return operation
  }
  prepareToLeave = async (): Promise<void> => { await this.cancel(true); await this.flush() }
}
