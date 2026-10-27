import type { CanvasExportOptions, CanvasRegion } from './notebookTypes'

export interface CanvasExportTile { region: CanvasRegion; width: number; height: number; scale: number }
function record(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid canvas region/export option fields')
}
export function validateCanvasRegion(value: unknown): asserts value is CanvasRegion {
  record(value, ['x', 'y', 'width', 'height'])
  for (const name of ['x', 'y', 'width', 'height']) if (typeof value[name] !== 'number' || !Number.isFinite(value[name])) throw new Error('Invalid canvas region geometry')
  const { x, y, width, height } = value as unknown as CanvasRegion
  if (Math.abs(x) > 10000000 || Math.abs(y) > 10000000 || width < .01 || height < .01 || x + width > 10000000 || y + height > 10000000 || x + width <= x || y + height <= y) throw new Error('Canvas region exceeds world bounds or precision')
}
function tileAxis(length: number, maximum: number): Array<{ offset: number; length: number }> {
  const count = Math.ceil(length / maximum), edges = Array.from({ length: count + 1 }, (_, index) => Math.min(index * maximum, length))
  if (count > 1 && length - edges[count - 1] < .01) edges[count - 1] -= .01
  return edges.slice(0, -1).map((offset, index) => ({ offset, length: edges[index + 1] - offset }))
}
export function canvasExportPlan(value: unknown): CanvasExportTile[] {
  record(value, ['format', 'scope', 'region'])
  if (value.format !== 'png' && value.format !== 'pdf') throw new Error('Invalid canvas export format')
  if (!['all', 'viewport', 'selection'].includes(value.scope as string)) throw new Error('Invalid canvas export scope')
  validateCanvasRegion(value.region)
  const options = value as unknown as CanvasExportOptions, region = { ...options.region }
  if (options.format === 'png') {
    const scale = Math.min(2, 4096 / Math.max(region.width, region.height), Math.sqrt(16000000 / (region.width * region.height))), width = Math.floor(region.width * scale), height = Math.floor(region.height * scale)
    if (width < 1 || height < 1) throw new Error('Canvas region is too narrow for a bounded PNG dimension')
    return [{ region, width, height, scale }]
  }
  const columns = Math.ceil(region.width / 1200), rows = Math.ceil(region.height / 1600)
  if (columns * rows > 50) throw new Error('Canvas PDF export exceeds the 50 tile limit. Choose a smaller region.')
  const tiles: CanvasExportTile[] = [], horizontal = tileAxis(region.width, 1200), vertical = tileAxis(region.height, 1600)
  for (const row of vertical) for (const column of horizontal) {
    const tile = { x: region.x + column.offset, y: region.y + row.offset, width: column.length, height: row.length }
    tiles.push({ region: tile, width: Math.ceil(tile.width), height: Math.ceil(tile.height), scale: 1 })
  }
  return tiles
}



