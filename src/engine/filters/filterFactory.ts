import type { Filter } from 'pixi.js'
import type { FilterParams } from '@app-types/filter.ts'
import { createGaussianBlurFilters } from '../shaders/filters/gaussianBlurFilter.ts'
import { createSharpenFilter } from '../shaders/filters/sharpenFilter.ts'
import { createHSBAdjustmentFilter } from '../shaders/filters/hsbAdjustmentFilter.ts'
import { createCurvesFilter, createLUTTexture } from '../shaders/filters/curvesFilter.ts'

export interface FilterPipeline {
  filters: Filter[]
  /** For sharpen: the blur radius needed to generate the pre-blur texture. */
  preBlurRadius?: number
}

/**
 * Route filter params to the correct shader constructors.
 */
export function createFilterPipeline(
  params: FilterParams,
  width: number,
  height: number,
): FilterPipeline {
  switch (params.type) {
    case 'gaussianBlur':
      return {
        filters: createGaussianBlurFilters(params.radius, width, height),
      }

    case 'sharpen':
      return {
        filters: [createSharpenFilter(params.amount, params.threshold)],
        preBlurRadius: params.radius,
      }

    case 'hsbAdjustment':
      return {
        filters: [createHSBAdjustmentFilter(params.hueShift, params.saturation, params.brightness)],
      }

    case 'curves': {
      const lutTexture = createLUTTexture(params.channels)
      return {
        filters: [createCurvesFilter(lutTexture)],
      }
    }
  }
}
