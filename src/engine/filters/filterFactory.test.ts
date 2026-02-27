import { describe, it, expect, vi } from 'vitest'

vi.mock('pixi.js', () => {
  class MockBlurFilter {
    strength: number
    quality: number
    constructor(opts?: { strength?: number; quality?: number }) {
      this.strength = opts?.strength ?? 8
      this.quality = opts?.quality ?? 4
    }
  }
  class MockColorMatrixFilter {
    hue() {}
    saturate() {}
    brightness() {}
    reset() {}
  }
  return {
    BlurFilter: MockBlurFilter,
    ColorMatrixFilter: MockColorMatrixFilter,
    Filter: class {},
  }
})

import { createFilterPipeline } from './filterFactory.ts'
import type { GaussianBlurParams, SharpenParams, HSBAdjustmentParams, CurvesParams } from '@app-types/filter.ts'

describe('filterFactory', () => {
  it('creates 1-filter pipeline for gaussian blur (built-in BlurFilter)', () => {
    const params: GaussianBlurParams = { type: 'gaussianBlur', radius: 10 }
    const pipeline = createFilterPipeline(params, 800, 600)
    expect(pipeline.filters).toHaveLength(1)
    expect(pipeline.cpuOperation).toBeUndefined()
  })

  it('creates blur filters + CPU sharpen operation for sharpen', () => {
    const params: SharpenParams = { type: 'sharpen', amount: 100, radius: 5, threshold: 10 }
    const pipeline = createFilterPipeline(params, 800, 600)
    expect(pipeline.filters).toHaveLength(1) // Blur filter for pre-blur
    expect(pipeline.cpuOperation).toBe('sharpen')
    expect(pipeline.cpuParams).toBe(params)
  })

  it('creates 1-filter pipeline for HSB adjustment (built-in ColorMatrixFilter)', () => {
    const params: HSBAdjustmentParams = { type: 'hsbAdjustment', hueShift: 45, saturation: 20, brightness: -10 }
    const pipeline = createFilterPipeline(params, 800, 600)
    expect(pipeline.filters).toHaveLength(1)
    expect(pipeline.cpuOperation).toBeUndefined()
  })

  it('creates empty filter pipeline + CPU curves operation for curves', () => {
    const params: CurvesParams = {
      type: 'curves',
      channels: {
        rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        red: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        green: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
        blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
      },
    }
    const pipeline = createFilterPipeline(params, 800, 600)
    expect(pipeline.filters).toHaveLength(0)
    expect(pipeline.cpuOperation).toBe('curves')
    expect(pipeline.cpuParams).toBe(params)
  })
})
