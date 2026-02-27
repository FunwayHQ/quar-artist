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
  return { BlurFilter: MockBlurFilter, Filter: class {} }
})

import { createGaussianBlurFilters, updateGaussianBlurUniforms } from './gaussianBlurFilter.ts'

describe('gaussianBlurFilter', () => {
  it('creates one BlurFilter', () => {
    const filters = createGaussianBlurFilters(5, 1024, 768)
    expect(filters).toHaveLength(1)
  })

  it('sets correct strength from radius', () => {
    const filters = createGaussianBlurFilters(15, 800, 600)
    expect((filters[0] as any).strength).toBe(15)
  })

  it('sets quality based on radius', () => {
    const filters = createGaussianBlurFilters(20, 500, 500)
    // quality = ceil(20/4) = 5, clamped to [2, 10]
    expect((filters[0] as any).quality).toBe(5)
  })

  it('clamps quality to minimum of 2', () => {
    const filters = createGaussianBlurFilters(1, 500, 500)
    expect((filters[0] as any).quality).toBe(2)
  })

  describe('updateGaussianBlurUniforms', () => {
    it('updates strength and quality on existing filters', () => {
      const filters = createGaussianBlurFilters(5, 100, 100)
      updateGaussianBlurUniforms(filters, 40, 200, 150)
      expect((filters[0] as any).strength).toBe(40)
      expect((filters[0] as any).quality).toBe(10) // ceil(40/4)=10, clamped to max 10
    })
  })
})
