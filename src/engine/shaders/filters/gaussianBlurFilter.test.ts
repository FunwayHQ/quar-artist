import { describe, it, expect, vi } from 'vitest'

vi.mock('pixi.js', () => {
  class MockGlProgram {
    vertex: string
    fragment: string
    constructor(v: string, f: string) { this.vertex = v; this.fragment = f }
    static from({ vertex, fragment }: { vertex: string; fragment: string }) {
      return new MockGlProgram(vertex, fragment)
    }
  }
  class MockGpuProgram {
    static from() { return new MockGpuProgram() }
  }
  class MockFilter {
    glProgram: unknown
    gpuProgram: unknown
    resources: unknown
    constructor(opts: { glProgram?: unknown; gpuProgram?: unknown; resources?: unknown }) {
      this.glProgram = opts.glProgram
      this.gpuProgram = opts.gpuProgram
      this.resources = opts.resources
    }
  }
  return { Filter: MockFilter, GlProgram: MockGlProgram, GpuProgram: MockGpuProgram }
})

import { createGaussianBlurFilters, updateGaussianBlurUniforms } from './gaussianBlurFilter.ts'

describe('gaussianBlurFilter', () => {
  it('creates two filters (horizontal and vertical)', () => {
    const filters = createGaussianBlurFilters(5, 1024, 768)
    expect(filters).toHaveLength(2)
  })

  it('sets correct direction uniforms', () => {
    const filters = createGaussianBlurFilters(10, 800, 600)
    const hDir = (filters[0] as any).resources.blurUniforms.uDirection.value
    const vDir = (filters[1] as any).resources.blurUniforms.uDirection.value
    expect(hDir[0]).toBe(1)
    expect(hDir[1]).toBe(0)
    expect(vDir[0]).toBe(0)
    expect(vDir[1]).toBe(1)
  })

  it('sets radius uniform', () => {
    const filters = createGaussianBlurFilters(15, 500, 500)
    expect((filters[0] as any).resources.blurUniforms.uRadius.value).toBe(15)
  })

  it('sets resolution uniform', () => {
    const filters = createGaussianBlurFilters(5, 1920, 1080)
    const res = (filters[0] as any).resources.blurUniforms.uResolution.value
    expect(res[0]).toBe(1920)
    expect(res[1]).toBe(1080)
  })

  describe('updateGaussianBlurUniforms', () => {
    it('updates radius and resolution on existing filters', () => {
      const filters = createGaussianBlurFilters(5, 100, 100)
      updateGaussianBlurUniforms(filters, 20, 200, 150)
      const u = (filters[0] as any).resources.blurUniforms
      expect(u.uRadius.value).toBe(20)
      expect(u.uResolution.value[0]).toBe(200)
      expect(u.uResolution.value[1]).toBe(150)
    })
  })
})
