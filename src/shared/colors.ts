export const COLOR_PRESETS = [
  { name: 'Slate', value: '#334155' }, { name: 'Black', value: '#111827' },
  { name: 'Gray', value: '#94a3b8' }, { name: 'White', value: '#ffffff' },
  { name: 'Red', value: '#dc2626' }, { name: 'Coral', value: '#ed6376' },
  { name: 'Orange', value: '#ea580c' }, { name: 'Yellow', value: '#f3d653' },
  { name: 'Mint', value: '#4b8f82' }, { name: 'Green', value: '#16a34a' },
  { name: 'Blue', value: '#2563eb' }, { name: 'Purple', value: '#9333ea' }
] as const
export const LEGACY_HIGHLIGHT_COLORS = { yellow: '#f3d653', coral: '#f49dad', mint: '#83c6ac' } as const
export function isHexColor(value: unknown): value is `#${string}` { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) }
export function isHighlightColor(value: unknown): value is keyof typeof LEGACY_HIGHLIGHT_COLORS | `#${string}` { return isHexColor(value) || typeof value === 'string' && Object.hasOwn(LEGACY_HIGHLIGHT_COLORS, value) }
export function highlightColorHex(value: unknown): string {
  if (isHexColor(value)) return value.toLowerCase()
  if (typeof value === 'string' && Object.hasOwn(LEGACY_HIGHLIGHT_COLORS, value)) return LEGACY_HIGHLIGHT_COLORS[value as keyof typeof LEGACY_HIGHLIGHT_COLORS]
  throw Error('Invalid highlight color')
}
export function colorLabel(value: string): string {
  if (value === 'transparent') return 'Transparent'
  const hex = highlightColorHex(value)
  return COLOR_PRESETS.find(preset => preset.value === hex)?.name ?? (hex === '#f49dad' ? 'Coral' : hex === '#83c6ac' ? 'Mint' : hex.toUpperCase())
}
export function colorRgb(value: string): [number, number, number] {
  const hex = highlightColorHex(value)
  return [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number]
}
