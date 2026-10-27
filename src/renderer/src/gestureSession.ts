import type { InteractionCommand } from '../../shared/localInputTypes'
export interface HandPoint { x: number; y: number; z: number }
export type HandPose = InteractionCommand
const distance = (a: HandPoint, b: HandPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
function angle(a: HandPoint, b: HandPoint, c: HandPoint): number {
  const ab = distance(a, b); const cb = distance(c, b)
  if (ab < 0.001 || cb < 0.001) return 0
  const dot = (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) + (a.z - b.z) * (c.z - b.z)
  return Math.acos(Math.max(-1, Math.min(1, dot / (ab * cb)))) * 180 / Math.PI
}
/** Handedness is anatomical. Landmarks are raw, unmirrored camera coordinates. */
export function classifyHand(points: HandPoint[], handedness: 'Left' | 'Right', aspectRatio = 1): HandPose | null {
  if (points.length !== 21 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))) return null
  if (!Number.isFinite(aspectRatio) || aspectRatio < 0.25 || aspectRatio > 4) return null
  const palm = distance(points[5], points[17])
  if (palm < 0.045 || palm > 0.7) return null
  const ux = points[5].x - points[0].x; const uy = points[5].y - points[0].y; const uz = points[5].z - points[0].z
  const vx = points[17].x - points[0].x; const vy = points[17].y - points[0].y; const vz = points[17].z - points[0].z
  const nz = ux * vy - uy * vx; const norm = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz)
  const facing = norm > 0 && Math.abs(nz) / norm > 0.65
  const back = facing && (handedness === 'Right' ? nz < 0 : nz > 0)
  const states = [5, 9, 13, 17].map(base => {
    const straight = angle(points[base], points[base + 1], points[base + 2]) > 155 && angle(points[base + 1], points[base + 2], points[base + 3]) > 150
    if (straight && distance(points[base + 3], points[0]) > distance(points[base + 1], points[0]) * 1.12) return 'extended'
    if (angle(points[base], points[base + 1], points[base + 2]) < 130 && distance(points[base + 3], points[base]) < palm * 0.65) return 'folded'
    return 'unknown'
  })
  const thumbLateral = ((points[4].x - points[5].x) * (points[5].x - points[17].x) + (points[4].y - points[5].y) * (points[5].y - points[17].y) + (points[4].z - points[5].z) * (points[5].z - points[17].z)) / (palm * palm)
  const thumbExtended = thumbLateral > 0.2 && angle(points[1], points[2], points[3]) > 145 && angle(points[2], points[3], points[4]) > 140 && distance(points[4], points[5]) > palm * 0.65 && distance(points[4], points[5]) > distance(points[3], points[5]) * 1.1
  const thumbFolded = distance(points[4], points[5]) < palm * 0.6 || angle(points[2], points[3], points[4]) < 130
  if (back && thumbExtended && states.every(s => s === 'folded')) return 'start-voice'
  if (back && thumbExtended && states[0] === 'extended' && states.slice(1).every(s => s === 'folded')) return 'stop-voice-and-send'
  const thumbRetracted = thumbFolded || distance(points[4], points[5]) < distance(points[3], points[5]) * 0.95 || (thumbLateral < 0.1 && distance(points[4], points[5]) < palm * 1.5)
  const curled = [9, 13, 17].every(base => angle(points[base], points[base + 1], points[base + 2]) < 130 && (
    distance(points[base + 3], points[base]) < palm * 0.65 || (
      distance(points[base + 3], points[base]) < palm * 1.25 && distance(points[base + 3], points[0]) < distance(points[base + 1], points[0]) * 0.95
    )
  ))
  if (thumbExtended || !thumbRetracted || states[0] !== 'extended' || !curled) return null
  const dx = (points[5].x - points[8].x) * aspectRatio
  const dy = points[8].y - points[5].y
  const planar = Math.hypot(dx, dy)
  if (planar < palm * 0.65 || planar < Math.abs(points[8].z - points[5].z) * 0.8) return null
  if (Math.abs(dx) > Math.abs(dy) * 1.35) return dx < 0 ? 'next-page' : 'previous-page'
  if (Math.abs(dy) > Math.abs(dx) * 1.35) return dy < 0 ? 'scroll-up' : 'scroll-down'
  return null
}
export class GestureGate {
  private candidate: InteractionCommand | null = null
  private since = 0
  private fired = false
  private lastFire = -Infinity
  private neutralSince: number | null = null
  private lastAt = -Infinity
  update(command: InteractionCommand | null, time: number, recording: boolean): InteractionCommand | null {
    if (!Number.isFinite(time) || time < this.lastAt) return null
    if (time - this.lastAt > 400 && this.lastAt !== -Infinity) { this.candidate = null; this.since = time }
    this.lastAt = time
    if ((command === 'stop-voice-and-send' && !recording) || (command === 'start-voice' && recording)) { this.candidate = null; this.neutralSince = null; return null }

    if (!command) {
      this.candidate = null
      this.neutralSince ??= time
      if (time - this.neutralSince >= 250) this.fired = false
      return null
    }
    this.neutralSince = null
    if (this.fired || time - this.lastFire < 900) return null
    if (command !== this.candidate) { this.candidate = command; this.since = time; return null }
    const hold = command === 'start-voice' ? 700 : command === 'stop-voice-and-send' ? 1000 : 600
    if (time - this.since < hold) return null
    this.fired = true; this.lastFire = time
    return command
  }
  invalidateHold(): void { this.candidate = null; this.since = 0 }
  reset(): void { this.candidate = null; this.since = 0; this.fired = false; this.neutralSince = null; this.lastAt = -Infinity; this.lastFire = -Infinity }
}


