import type { SharpenParams } from '@app-types/filter.ts'
import { FilterSlider } from './FilterSlider.tsx'

interface SharpenPanelProps {
  params: SharpenParams
  onChange: (params: SharpenParams) => void
}

export function SharpenPanel({ params, onChange }: SharpenPanelProps) {
  return (
    <>
      <FilterSlider
        label="Amount"
        value={params.amount}
        min={0}
        max={500}
        step={1}
        unit="%"
        onChange={(amount) => onChange({ ...params, amount })}
      />
      <FilterSlider
        label="Radius"
        value={params.radius}
        min={0.1}
        max={100}
        step={0.1}
        unit="px"
        onChange={(radius) => onChange({ ...params, radius })}
      />
      <FilterSlider
        label="Threshold"
        value={params.threshold}
        min={0}
        max={255}
        step={1}
        onChange={(threshold) => onChange({ ...params, threshold })}
      />
    </>
  )
}
