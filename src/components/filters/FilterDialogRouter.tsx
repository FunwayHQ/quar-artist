import { useFilterStore } from '@stores/filterStore.ts'
import { FilterDialog } from '@components/dialogs/FilterDialog.tsx'
import { GaussianBlurPanel } from './GaussianBlurPanel.tsx'
import { SharpenPanel } from './SharpenPanel.tsx'
import { HSBAdjustmentPanel } from './HSBAdjustmentPanel.tsx'
import { CurvesPanel } from './CurvesPanel.tsx'
import type { FilterParams, GaussianBlurParams, SharpenParams, HSBAdjustmentParams, CurvesParams } from '@app-types/filter.ts'

interface FilterDialogRouterProps {
  onApply: () => void
  onCancel: () => void
}

const FILTER_TITLES: Record<string, string> = {
  gaussianBlur: 'Gaussian Blur',
  sharpen: 'Sharpen',
  hsbAdjustment: 'HSB Adjustment',
  curves: 'Curves',
}

export function FilterDialogRouter({ onApply, onCancel }: FilterDialogRouterProps) {
  const activeFilter = useFilterStore((s) => s.activeFilter)
  const params = useFilterStore((s) => s.params)
  const updateParams = useFilterStore((s) => s.updateParams)

  if (!activeFilter || !params) return null

  const handleChange = (newParams: FilterParams) => {
    updateParams(newParams)
  }

  const title = FILTER_TITLES[activeFilter] ?? 'Filter'

  return (
    <FilterDialog title={title} onApply={onApply} onCancel={onCancel}>
      {params.type === 'gaussianBlur' && (
        <GaussianBlurPanel
          params={params as GaussianBlurParams}
          onChange={handleChange}
        />
      )}
      {params.type === 'sharpen' && (
        <SharpenPanel
          params={params as SharpenParams}
          onChange={handleChange}
        />
      )}
      {params.type === 'hsbAdjustment' && (
        <HSBAdjustmentPanel
          params={params as HSBAdjustmentParams}
          onChange={handleChange}
        />
      )}
      {params.type === 'curves' && (
        <CurvesPanel
          params={params as CurvesParams}
          onChange={handleChange}
        />
      )}
    </FilterDialog>
  )
}
