import { useEffect, useMemo, useRef, useState } from 'react'
import { Mic, Square, Camera, CameraOff, Download, FolderOpen, X } from 'lucide-react'
import type { InteractionCommand, LocalSpeechAPI, LocalSpeechStatus, SpeechLanguage, VoiceInputState, VoiceSessionCallbacks } from '../../../shared/localInputTypes'
import { VoiceSession } from '../voiceSession'
import { CameraGestureSession, type CameraInputState } from '../localCameraSession'
import { FloatingCameraPreview } from './FloatingCameraPreview'
import './VoiceInputControls.css'
export interface VoiceInputController { readonly recording: boolean; sendSegment(send: () => Promise<boolean>): Promise<void>; finishToDraft(): Promise<void>; cancel(): Promise<void> }
export interface VoiceInputControlsProps {
  api: LocalSpeechAPI
  callbacks: Omit<VoiceSessionCallbacks, 'onState'> & { onState?(state: VoiceInputState): void }
  onCommand?(command: InteractionCommand): void
  onController?(controller: VoiceInputController): () => void
  disabled?: boolean
  suspended?: boolean
}
export function VoiceInputControls({ api, callbacks, onCommand, onController, disabled = false, suspended = false }: VoiceInputControlsProps) {
  const [voiceState, setVoiceState] = useState<VoiceInputState>({ phase: 'idle', transcript: '', level: 0 })
  const [cameraState, setCameraState] = useState<CameraInputState>({ phase: 'off' })
  const [cameraRequested, setCameraRequested] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const cameraBoundary = useRef({ guide: false, interacting: false })
  const [status, setStatus] = useState<LocalSpeechStatus | null>(null)
  const [language, setLanguage] = useState<SpeechLanguage>('auto')
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string>()
  const video = useRef<HTMLVideoElement>(null)
  const latest = useRef({ callbacks, onCommand, onController, disabled, suspended, language, modelReady: !!status?.ready })
  latest.current = { callbacks, onCommand, onController, disabled, suspended, language, modelReady: !!status?.ready }
  const liveTranscript = !!(callbacks.beginTranscript && callbacks.previewTranscript && callbacks.finishTranscript)
  const voice = useMemo(() => new VoiceSession(api, {
    getOwner: () => latest.current.callbacks.getOwner(),
    isBusy: () => latest.current.disabled || latest.current.suspended || latest.current.callbacks.isBusy(),
    isInputBlocked: () => latest.current.disabled || latest.current.suspended || (latest.current.callbacks.isInputBlocked?.() ?? latest.current.callbacks.isBusy()),
    appendTranscript: (text, owner) => latest.current.callbacks.appendTranscript(text, owner),
    sendFinal: (text, owner) => latest.current.callbacks.sendFinal(text, owner),
    ...(liveTranscript ? {
      beginTranscript: (sessionId, owner) => latest.current.callbacks.beginTranscript!(sessionId, owner),
      previewTranscript: (sessionId, text, owner) => latest.current.callbacks.previewTranscript!(sessionId, text, owner),
      finishTranscript: (sessionId, text, owner, options) => latest.current.callbacks.finishTranscript!(sessionId, text, owner, options)
    } : {}),
    onState: state => { setVoiceState(state); latest.current.callbacks.onState?.(state) }
  }), [api, liveTranscript])
  const camera = useMemo(() => new CameraGestureSession(api, {
    onState: setCameraState,
    isRecording: () => voice.recording,
    getRecordingSessionId: () => voice.sessionId,
    isSuspended: () => latest.current.disabled || latest.current.suspended || cameraBoundary.current.guide || cameraBoundary.current.interacting,
    onCommand: command => {
      if (command === 'start-voice') { if (latest.current.modelReady) void voice.start(latest.current.language) }
      else if (command === 'stop-voice-and-send') { if (voice.recording) void voice.stop(true) }
      else latest.current.onCommand?.(command)
    }
  }), [api, voice])
  useEffect(() => { let cancelled = false; void api.status().then(result => { if (!cancelled) setStatus(result) }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Local input unavailable.') }); return () => { cancelled = true } }, [api])
  useEffect(() => latest.current.onController?.({ get recording() { return voice.recording }, sendSegment: send => voice.sendSegment(send), finishToDraft: () => voice.finishToDraft(), cancel: () => voice.cancel() }), [voice, !!onController])
  useEffect(() => () => { void voice.dispose() }, [voice])
  useEffect(() => () => { void camera.dispose() }, [camera])
  async function install(importLocal: boolean) {
    if (installing) return
    setInstalling(true); setError(undefined)
    try { setStatus(await (importLocal ? api.importModel() : api.downloadModel())) } catch (err) { setError(err instanceof Error ? err.message : 'Model installation failed.') } finally { setInstalling(false) }
  }
  const activeVoice = voiceState.phase === 'recording'
  const finalizing = voiceState.phase === 'finalizing'
  const starting = voiceState.phase === 'starting'
  const capturedSpeech = voice.hasCapturedSpeech
  const cameraOn = cameraRequested
  function changeGuide(open: boolean) { cameraBoundary.current.guide = open; camera.resetGestures(); setGuideOpen(open) }
  function changeInteraction(active: boolean) { cameraBoundary.current.interacting = active; camera.resetGestures() }
  function closeCamera() { cameraBoundary.current = { guide: false, interacting: false }; setGuideOpen(false); setCameraRequested(false); void camera.disable() }
  function toggleCamera() { if (cameraOn) closeCamera(); else if (video.current) { setCameraRequested(true); changeGuide(true); void camera.enable(video.current) } }
  return <><div className="local-input-controls">
    <div className="local-input-actions">
      <button type="button" className={`local-input-mic ${activeVoice ? 'is-recording' : ''}`} title={activeVoice ? 'Stop recording and add transcript to draft' : 'Record locally in Chinese or English'} aria-label={activeVoice ? 'Stop recording to draft' : 'Start local voice input'} aria-pressed={activeVoice} disabled={disabled || suspended || !status?.ready || starting || finalizing || capturedSpeech} onClick={() => { if (activeVoice) void voice.stop(false); else void voice.start(language) }}>{activeVoice ? <Square size={16}/> : <Mic size={16}/>}</button>
      <select aria-label="Speech language" value={language} disabled={activeVoice || starting || finalizing} onChange={event => setLanguage(event.target.value as SpeechLanguage)}><option value="auto">中 / EN</option><option value="zh">中文</option><option value="en">English</option></select>
      <button type="button" title={cameraOn ? 'Disable camera gestures' : 'Enable local camera gestures'} aria-label={cameraOn ? 'Disable camera gestures' : 'Enable camera gestures'} aria-pressed={cameraOn} disabled={disabled && !cameraOn} onClick={toggleCamera}>{cameraOn ? <CameraOff size={16}/> : <Camera size={16}/>}</button>
      {(activeVoice || starting || finalizing) && <button type="button" aria-label="Cancel recording" title="Cancel recording" onClick={() => { void voice.cancel() }}><X size={14}/></button>}
      {(activeVoice || starting || finalizing) && <span className="local-input-status" role="status">{starting ? 'Opening microphone…' : finalizing ? 'Finalizing locally…' : 'Recording · local'}</span>}
      {activeVoice && <meter aria-label="Microphone activity" min={0} max={1} value={voiceState.level}/>}
    </div>
    {capturedSpeech && <div className="local-input-setup" role="group" aria-label="Captured speech recovery"><span>Captured speech is kept locally in memory.</span><button type="button" disabled={disabled || suspended || starting || finalizing} onClick={() => { void voice.retryCapturedSpeech() }}>{finalizing ? 'Retrying captured speech…' : 'Retry captured speech'}</button><button type="button" onClick={() => { void voice.discardCapturedSpeech() }}>Discard captured speech</button></div>}
    {status && !status.modelReady && <div className="local-input-setup"><span>Offline voice model · 148 MB</span><button type="button" disabled={installing || !status.runnerReady} onClick={() => { void install(false) }}><Download size={13}/>{installing ? 'Installing…' : 'Download'}</button><button type="button" disabled={installing} onClick={() => { void install(true) }}><FolderOpen size={13}/>Import</button>{!status.runnerReady && <span>Speech runtime is missing.</span>}</div>}
    {!liveTranscript && voiceState.transcript && (activeVoice || finalizing) && <p className="local-input-provisional" aria-label="Provisional local transcript">{voiceState.transcript}</p>}
    {(error || voiceState.error) && <p className="local-input-error" role="alert">{error || voiceState.error}</p>}
  </div><FloatingCameraPreview open={cameraRequested} videoRef={video} state={cameraState} guideOpen={guideOpen} voiceReady={!!status?.ready} suspended={disabled || suspended} onGuideChange={changeGuide} onInteractionChange={changeInteraction} onClose={closeCamera}/></>
}


