export type SpeechLanguage = 'auto' | 'zh' | 'en'
export interface LocalInputOwner { conversationId: string; contextRevision: number; draftRevision: number }
export interface LocalSpeechStatus { runnerReady: boolean; modelReady: boolean; ready: boolean; downloading: boolean; modelId: 'whisper-base-multilingual'; modelBytes: number; error?: string }
export interface LocalSpeechStart { sessionId: string; language: SpeechLanguage }
export interface LocalSpeechChunk { sessionId: string; sequence: number; pcm16: ArrayBuffer }
export interface LocalSpeechResult { sessionId: string; text: string; final: boolean }
export interface LocalVisionAssets { wasmLoader: string; wasmBinary: ArrayBuffer; handModel: ArrayBuffer }
export interface LocalSpeechAPI {
  status(): Promise<LocalSpeechStatus>
  visionAssets(): Promise<LocalVisionAssets>
  downloadModel(): Promise<LocalSpeechStatus>
  importModel(): Promise<LocalSpeechStatus>
  start(request: LocalSpeechStart): Promise<void>
  append(request: LocalSpeechChunk): Promise<LocalSpeechResult>
  finalize(request: { sessionId: string }): Promise<LocalSpeechResult>
  cancel(request: { sessionId: string }): Promise<void>
  enableDevice(request: { device: 'microphone' | 'camera'; enabled: boolean }): Promise<void>
}
export type InteractionCommand = 'previous-page' | 'next-page' | 'scroll-up' | 'scroll-down' | 'start-voice' | 'stop-voice-and-send'
export interface VoiceInputState { phase: 'idle' | 'starting' | 'recording' | 'finalizing' | 'error'; transcript: string; level: number; error?: string }
export interface VoiceTranscriptFinishOptions { send: boolean; reason: 'final' | 'cancel' | 'error' }
export interface VoiceSessionCallbacks {
  getOwner(): LocalInputOwner
  isBusy(): boolean
  isInputBlocked?(): boolean
  appendTranscript(text: string, owner: LocalInputOwner): void
  sendFinal(text: string, owner: LocalInputOwner): void | Promise<void>
  onState(state: VoiceInputState): void
  beginTranscript?(sessionId: string, owner: LocalInputOwner): void
  previewTranscript?(sessionId: string, text: string, owner: LocalInputOwner): void
  finishTranscript?(sessionId: string, text: string, owner: LocalInputOwner, options: VoiceTranscriptFinishOptions): void | Promise<void>
}


