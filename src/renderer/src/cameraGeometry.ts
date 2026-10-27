export interface CameraViewport { width: number; height: number }
export interface CameraBox extends CameraViewport { x: number; y: number }
const minimum = { width: 200, height: 150 }
const maximum = { width: 640, height: 480 }
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
export function constrainCameraBox(box: CameraBox, viewport: CameraViewport): CameraBox {
  const width = clamp(box.width, Math.min(minimum.width, viewport.width), Math.min(maximum.width, viewport.width))
  const height = clamp(box.height, Math.min(minimum.height, viewport.height), Math.min(maximum.height, viewport.height))
  return { x: clamp(box.x, 0, viewport.width - width), y: clamp(box.y, 0, viewport.height - height), width, height }
}
export function initialCameraBox(viewport: CameraViewport): CameraBox {
  return constrainCameraBox({ x: viewport.width - 300, y: viewport.height - 230, width: 280, height: 210 }, viewport)
}
export function moveCameraBox(box: CameraBox, dx: number, dy: number, viewport: CameraViewport): CameraBox {
  return constrainCameraBox({ ...box, x: box.x + dx, y: box.y + dy }, viewport)
}
export function resizeCameraBox(box: CameraBox, dx: number, dy: number, viewport: CameraViewport): CameraBox {
  const anchored = constrainCameraBox(box, viewport)
  const width = Math.min(viewport.width - anchored.x, anchored.width + dx)
  const height = Math.min(viewport.height - anchored.y, anchored.height + dy)
  return constrainCameraBox({ ...anchored, width, height }, viewport)
}
