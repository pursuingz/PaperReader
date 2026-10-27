import { HandLandmarker } from '@mediapipe/tasks-vision'
import { classifyHand, GestureGate } from './gestureSession'
import type { LocalVisionAssets } from '../../shared/localInputTypes'
const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage(message: unknown): void; close(): void }
let detector: HandLandmarker | null = null
const gate = new GestureGate()
const urls: string[] = []
let lastTime = -Infinity
let recordingSessionId: string | null = null
scope.onmessage = async event => {
  const data = event.data
  if (data.type === 'init') {
    try {
      const assets = data.assets as LocalVisionAssets
      const loader = URL.createObjectURL(new Blob([assets.wasmLoader], { type: 'text/javascript' })); urls.push(loader)
      const wasm = URL.createObjectURL(new Blob([assets.wasmBinary], { type: 'application/wasm' })); urls.push(wasm)
      detector = await HandLandmarker.createFromOptions({ wasmLoaderPath: loader, wasmBinaryPath: wasm }, { baseOptions: { modelAssetBuffer: new Uint8Array(assets.handModel), delegate: 'CPU' }, runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: 0.7, minHandPresenceConfidence: 0.7, minTrackingConfidence: 0.7 })
      scope.postMessage({ type: 'ready' })
    } catch { scope.postMessage({ type: 'error', error: 'Local hand model could not initialize. Check packaged vision assets.' }) }
    return
  }
  if (data.type === 'reset') { gate.reset(); return }
  if (data.type === 'dispose') { detector?.close(); urls.forEach(url => URL.revokeObjectURL(url)); scope.close(); return }
  if (data.type !== 'frame') return
  const bitmap = data.bitmap as ImageBitmap
  try {
    if (!detector || data.time <= lastTime) { scope.postMessage({ type: 'result', time: data.time, command: null }); return }
    lastTime = data.time
    if ((data.recordingSessionId ?? null) !== recordingSessionId) { recordingSessionId = data.recordingSessionId ?? null; gate.invalidateHold() }
    const result = detector.detectForVideo(bitmap, data.time)
    const landmarks = result.landmarks[0]
    const category = result.handedness[0]?.[0]
    // MediaPipe labels assume mirrored input; transferred frames are deliberately raw.
    const handedness = category?.categoryName === 'Left' ? 'Right' : 'Left'
    const pose = landmarks && category?.score >= 0.75 ? classifyHand(landmarks, handedness, bitmap.width / bitmap.height) : null
    const command = gate.update(pose, data.time, !!data.recording)
    scope.postMessage({ type: 'result', time: data.time, command, recordingSessionId: data.recordingSessionId ?? null })
  } catch { scope.postMessage({ type: 'error', error: 'Local hand tracking failed. Disable and enable the camera to retry.' }) } finally { bitmap.close() }
}


