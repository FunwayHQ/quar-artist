import type { GaussianBlurParams } from '@app-types/filter.ts'
import { FilterSlider } from './FilterSlider.tsx'

interface GaussianBlurPanelProps {
  params: GaussianBlurParams
  onChange: (params: GaussianBlurParams) => void
}

export function GaussianBlurPanel({ params, onChange }: GaussianBlurPanelProps) {
  return (
    <FilterSlider
      label="Radius"
      value={params.radius}
      min={1}
      max={100}
      step={1}
      unit="px"
      onChange={(radius) => onChange({ ...params, radius })}
    />
  )
}
