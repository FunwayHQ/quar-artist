import { describe, it, expect, vi } from 'vitest'

// Polyfill ImageData for jsdom
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as any).ImageData = class ImageData {
    width: number; height: number; data: Uint8ClampedArray
    constructor(data: Uint8ClampedArray, width: number, height?: number) {
      this.data = data; this.width = width; this.height = height ?? (data.length / (width * 4))
    }
  }
}

// Mock canvas getContext for jsdom
const mockCtx2d = {
  putImageData: vi.fn(),
}
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx2d) as any

vi.mock('pixi.js', () => {
  class MockGlProgram {
    static from() { return new MockGlProgram() }
  }
  class MockGpuProgram {
    static from() { return new MockGpuProgram() }
  }
  class MockFilter {
    resources: unknown
    constructor(opts?: { resources?: unknown }) {
      this.resources = opts?.resources
    }
  }
  class MockTexture {
    static from() { return new MockTexture() }
  }
  return {
    Filter: MockFilter,
    GlProgram: MockGlProgram,
    GpuProgram: MockGpuProgram,
    Texture: MockTexture,
  }
})

import { createFilterPipeline } from './filterFactory.ts'
import type { GaussianBlurParams, SharpenParams, HSBAdjustmentParams, CurvesParams } from '@app-types/filter.ts'

describe('filterFactory', () => {
  it('creates 2-filter pipeline for gaussian blur', () => {
    const params: GaussianBlurParams = { type: 'gaussianBlur', radius: 10 }
    const pipeline = createFilterPipeline(params, 800, 600)
    expect(pipeline.filters).toHaveLength(2)
    expect(pipeline.preBlurRadius).toBeUndefined()
  })

  it('creates 1-filter pipeline with preBlurRadius for sharpen', () => {
    const params: SharpenParams = { type: 'sharpen', amount: 100, radius: 5, threshold: 10 }
    const pipeline = createFilterPipeline(params, 800, 600)
    expect(pipeline.filters).toHaveLength(1)
    expect(pipeline.preBlurRadius).toBe(5)
  })

  it('creates 1-filter pipeline for HSB adjustment', () => {
    const params: HSBAdjustmentParams = { type: 'hsbAdjustment', hueShift: 45, saturation: 20, brightness: -10 }
    const pipeline = createFilterPipeline(params, 800, 600)
    expect(pipeline.filters).toHaveLength(1)
    expect(pipeline.preBlurRadius).toBeUndefined()
  })

  it('creates 1-filter pipeline for curves', () => {
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
    expect(pipeline.filters).toHaveLength(1)
    expect(pipeline.preBlurRadius).toBeUndefined()
  })
})
