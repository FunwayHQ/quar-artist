import type { Filter } from 'pixi.js'
import type { FilterParams, SharpenParams, CurvesParams } from '@app-types/filter.ts'
import { createGaussianBlurFilters } from '../shaders/filters/gaussianBlurFilter.ts'
import { createHSBAdjustmentFilter } from '../shaders/filters/hsbAdjustmentFilter.ts'

export interface FilterPipeline {
  filters: Filter[]
  /** For sharpen: the blur radius needed to generate the pre-blur texture. */
  preBlurRadius?: number
  /** CPU-based operation type (for filters that can't use GPU shaders on WebGPU). */
  cpuOperation?: 'sharpen' | 'curves'
  /** Params for CPU-based operations. */
  cpuParams?: SharpenParams | CurvesParams
}

/**
 * Route filter params to the correct filter constructors.
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
      // Sharpen uses GPU blur + CPU unsharp mask (custom shaders don't work on WebGPU)
      return {
        filters: createGaussianBlurFilters(params.radius, width, height),
        cpuOperation: 'sharpen',
        cpuParams: params,
      }

    case 'hsbAdjustment':
      return {
        filters: [createHSBAdjustmentFilter(params.hueShift, params.saturation, params.brightness)],
      }

    case 'curves':
      // Curves uses CPU-based LUT application (custom shaders don't work on WebGPU)
      return {
        filters: [],
        cpuOperation: 'curves',
        cpuParams: params,
      }
  }
}
