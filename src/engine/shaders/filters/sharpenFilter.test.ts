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

import { createSharpenFilter, updateSharpenUniforms } from './sharpenFilter.ts'

describe('sharpenFilter', () => {
  it('creates a filter with correct uniforms', () => {
    const filter = createSharpenFilter(200, 10)
    const u = (filter as any).resources.sharpenUniforms
    expect(u.uAmount.value).toBe(2) // 200/100
    expect(u.uThreshold.value).toBe(10)
  })

  it('normalizes amount from percentage', () => {
    const filter = createSharpenFilter(500, 0)
    expect((filter as any).resources.sharpenUniforms.uAmount.value).toBe(5)
  })

  describe('updateSharpenUniforms', () => {
    it('updates amount and threshold', () => {
      const filter = createSharpenFilter(100, 0)
      updateSharpenUniforms(filter, 300, 128)
      const u = (filter as any).resources.sharpenUniforms
      expect(u.uAmount.value).toBe(3)
      expect(u.uThreshold.value).toBe(128)
    })
  })
})
