import type { HSBAdjustmentParams } from '@app-types/filter.ts'
import { FilterSlider } from './FilterSlider.tsx'

interface HSBAdjustmentPanelProps {
  params: HSBAdjustmentParams
  onChange: (params: HSBAdjustmentParams) => void
}

export function HSBAdjustmentPanel({ params, onChange }: HSBAdjustmentPanelProps) {
  return (
    <>
      <FilterSlider
        label="Hue"
        value={params.hueShift}
        min={-180}
        max={180}
        step={1}
        unit="°"
        onChange={(hueShift) => onChange({ ...params, hueShift })}
      />
      <FilterSlider
        label="Saturation"
        value={params.saturation}
        min={-100}
        max={100}
        step={1}
        onChange={(saturation) => onChange({ ...params, saturation })}
      />
      <FilterSlider
        label="Brightness"
        value={params.brightness}
        min={-100}
        max={100}
        step={1}
        onChange={(brightness) => onChange({ ...params, brightness })}
      />
    </>
  )
}
