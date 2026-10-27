import { useEffect, useId, useRef, useState } from 'react'
import { COLOR_PRESETS, colorLabel, highlightColorHex, isHexColor } from '../../../shared/colors'
import './colorPicker.css'
export interface ColorPickerProps { value: string; onChange(value: string): void; label: string; disabled?: boolean; allowTransparent?: boolean }
export default function ColorPicker({ value, onChange, label, disabled = false, allowTransparent = false }: ColorPickerProps) {
  const id = useId(), hex = value === 'transparent' ? 'transparent' : highlightColorHex(value), [draft, setDraft] = useState(hex === 'transparent' ? '' : hex)
  const committed = useRef(hex)
  useEffect(() => { setDraft(hex === 'transparent' ? '' : hex); committed.current = hex }, [hex])
  function applyDraft() { const next = draft.toLowerCase(); if (!disabled && isHexColor(next) && committed.current !== next) { committed.current = next; onChange(next) } }
  const invalid = !!draft && !isHexColor(draft), custom = hex !== 'transparent' && !COLOR_PRESETS.some(preset => preset.value === hex)
  return <div className="color-picker">
    <label htmlFor={`${id}-preset`}>{label}</label><div className="color-picker-fields">
      <span className="color-picker-preview" style={{ background: hex }} aria-hidden="true"/>
      <select id={`${id}-preset`} aria-label={label} disabled={disabled} value={hex} onChange={event => onChange(event.target.value)}>
        {COLOR_PRESETS.map(preset => <option key={preset.value} value={preset.value}>{preset.name}</option>)}
        {custom && <option value={hex}>{colorLabel(hex)}</option>}
        {allowTransparent && <option value="transparent">Transparent</option>}
      </select>
      <input aria-label={`${label} custom hex`} aria-invalid={invalid} title="Six-digit hex color. Press Enter or leave this field to apply." placeholder="#RRGGBB" value={draft} disabled={disabled} maxLength={7} spellCheck={false} onChange={event => setDraft(event.target.value)} onBlur={applyDraft} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); applyDraft() } }}/>
    </div>
    {invalid && <small className="color-picker-error">Use # and six hex digits.</small>}
  </div>
}
