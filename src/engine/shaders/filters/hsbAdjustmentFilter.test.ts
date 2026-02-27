import { describe, it, expect, vi } from 'vitest'

vi.mock('pixi.js', () => {
  class MockGlProgram {
    static from() { return new MockGlProgram() }
  }
  class MockGpuProgram {
    static from() { return new MockGpuProgram() }
  }
  class MockFilter {
    resources: unknown
    constructor(opts: { resources?: unknown }) {
      this.resources = opts.resources
    }
  }
  return { Filter: MockFilter, GlProgram: MockGlProgram, GpuProgram: MockGpuProgram }
})

import { createHSBAdjustmentFilter, updateHSBUniforms } from './hsbAdjustmentFilter.ts'

describe('hsbAdjustmentFilter', () => {
  it('creates filter with correct initial uniforms', () => {
    const filter = createHSBAdjustmentFilter(45, -30, 20)
    const u = (filter as any).resources.hsbUniforms
    expect(u.uHueShift.value).toBe(45)
    expect(u.uSaturation.value).toBe(-30)
    expect(u.uBrightness.value).toBe(20)
  })

  it('supports full range values', () => {
    const filter = createHSBAdjustmentFilter(-180, -100, -100)
    const u = (filter as any).resources.hsbUniforms
    expect(u.uHueShift.value).toBe(-180)
    expect(u.uSaturation.value).toBe(-100)
    expect(u.uBrightness.value).toBe(-100)
  })

  describe('updateHSBUniforms', () => {
    it('updates all three uniforms', () => {
      const filter = createHSBAdjustmentFilter(0, 0, 0)
      updateHSBUniforms(filter, 90, 50, -25)
      const u = (filter as any).resources.hsbUniforms
      expect(u.uHueShift.value).toBe(90)
      expect(u.uSaturation.value).toBe(50)
      expect(u.uBrightness.value).toBe(-25)
    })
  })
})
