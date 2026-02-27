import { describe, it, expect, vi } from 'vitest'

vi.mock('pixi.js', () => {
  class MockColorMatrixFilter {
    _matrix: number[] = [1,0,0,0,0, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,1,0]
    _hueApplied = 0
    _satApplied = 0
    _brightApplied = 1
    hue(deg: number, multiply: boolean) { this._hueApplied = deg }
    saturate(amount: number, multiply: boolean) { this._satApplied = amount }
    brightness(b: number, multiply: boolean) { this._brightApplied = b }
    reset() { this._hueApplied = 0; this._satApplied = 0; this._brightApplied = 1 }
  }
  return { ColorMatrixFilter: MockColorMatrixFilter, Filter: class {} }
})

import { createHSBAdjustmentFilter, updateHSBUniforms } from './hsbAdjustmentFilter.ts'

describe('hsbAdjustmentFilter', () => {
  it('creates a ColorMatrixFilter with hue applied', () => {
    const filter = createHSBAdjustmentFilter(45, 0, 0)
    expect((filter as any)._hueApplied).toBe(45)
  })

  it('applies saturation as fraction', () => {
    const filter = createHSBAdjustmentFilter(0, -30, 0)
    expect((filter as any)._satApplied).toBe(-0.3) // -30/100
  })

  it('applies brightness as multiplier', () => {
    const filter = createHSBAdjustmentFilter(0, 0, 50)
    expect((filter as any)._brightApplied).toBe(1.5) // 1 + 50/100
  })

  it('supports full range values', () => {
    const filter = createHSBAdjustmentFilter(-180, -100, -100)
    expect((filter as any)._hueApplied).toBe(-180)
    expect((filter as any)._satApplied).toBe(-1)
    expect((filter as any)._brightApplied).toBe(0)
  })

  describe('updateHSBUniforms', () => {
    it('resets and reapplies all three properties', () => {
      const filter = createHSBAdjustmentFilter(0, 0, 0)
      updateHSBUniforms(filter, 90, 50, -25)
      expect((filter as any)._hueApplied).toBe(90)
      expect((filter as any)._satApplied).toBe(0.5)
      expect((filter as any)._brightApplied).toBe(0.75) // 1 + (-25/100)
    })
  })
})
