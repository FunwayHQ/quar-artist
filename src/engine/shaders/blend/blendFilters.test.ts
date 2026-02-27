import { describe, it, expect, vi } from 'vitest'

// Mock pixi.js
vi.mock('pixi.js', () => {
  class MockFilter {
    glProgram: unknown
    resources: unknown
    constructor(opts: any) {
      this.glProgram = opts.glProgram
      this.resources = opts.resources
    }
  }
  class MockGlProgram {
    vertex: string
    fragment: string
    constructor(v: string, f: string) {
      this.vertex = v
      this.fragment = f
    }
    static from({ vertex, fragment }: { vertex: string; fragment: string }) {
      return new MockGlProgram(vertex, fragment)
    }
  }
  return {
    Filter: MockFilter,
    GlProgram: MockGlProgram,
  }
})

import { createBlendFilter, needsCustomBlend, CUSTOM_BLEND_MODES } from './blendFilters.ts'
import { ALL_BLEND_MODES } from '../../../types/layer.ts'
import type { BlendMode } from '../../../types/layer.ts'

describe('blendFilters', () => {
  describe('needsCustomBlend', () => {
    it('returns false for normal', () => {
      expect(needsCustomBlend('normal')).toBe(false)
    })

    it('returns true for all non-normal modes', () => {
      const modes = ALL_BLEND_MODES.filter((m) => m !== 'normal')
      for (const mode of modes) {
        expect(needsCustomBlend(mode)).toBe(true)
      }
    })
  })

  describe('CUSTOM_BLEND_MODES', () => {
    it('contains 9 custom shader modes', () => {
      expect(CUSTOM_BLEND_MODES.size).toBe(9)
    })

    it('includes expected modes', () => {
      expect(CUSTOM_BLEND_MODES.has('vividLight')).toBe(true)
      expect(CUSTOM_BLEND_MODES.has('linearLight')).toBe(true)
      expect(CUSTOM_BLEND_MODES.has('pinLight')).toBe(true)
      expect(CUSTOM_BLEND_MODES.has('hardMix')).toBe(true)
      expect(CUSTOM_BLEND_MODES.has('subtract')).toBe(true)
      expect(CUSTOM_BLEND_MODES.has('divide')).toBe(true)
      expect(CUSTOM_BLEND_MODES.has('darkerColor')).toBe(true)
      expect(CUSTOM_BLEND_MODES.has('lighterColor')).toBe(true)
      expect(CUSTOM_BLEND_MODES.has('dissolve')).toBe(true)
    })

    it('does not include PixiJS-native modes', () => {
      expect(CUSTOM_BLEND_MODES.has('normal')).toBe(false)
      expect(CUSTOM_BLEND_MODES.has('multiply')).toBe(false)
      expect(CUSTOM_BLEND_MODES.has('screen')).toBe(false)
      expect(CUSTOM_BLEND_MODES.has('darken')).toBe(false)
    })
  })

  describe('createBlendFilter', () => {
    it('returns null for normal blend', () => {
      expect(createBlendFilter('normal')).toBeNull()
    })

    // Original 7 modes
    const originalModes: BlendMode[] = [
      'multiply', 'screen', 'overlay', 'softLight', 'add', 'color', 'luminosity',
    ]
    for (const mode of originalModes) {
      it(`returns a Filter for ${mode}`, () => {
        expect(createBlendFilter(mode)).not.toBeNull()
      })
    }

    // Batch 1 — PixiJS-native modes
    const batch1Modes: BlendMode[] = [
      'darken', 'lighten', 'colorDodge', 'colorBurn', 'hardLight',
      'difference', 'exclusion', 'hue', 'saturation',
    ]
    for (const mode of batch1Modes) {
      it(`returns a Filter for ${mode}`, () => {
        expect(createBlendFilter(mode)).not.toBeNull()
      })
    }

    // Batch 2 — Custom shader modes
    const batch2Modes: BlendMode[] = [
      'vividLight', 'linearLight', 'pinLight', 'hardMix',
      'subtract', 'divide', 'darkerColor', 'lighterColor', 'dissolve',
    ]
    for (const mode of batch2Modes) {
      it(`returns a Filter for ${mode}`, () => {
        expect(createBlendFilter(mode)).not.toBeNull()
      })
    }

    it('returns a Filter for all 25 non-normal modes', () => {
      const nonNormal = ALL_BLEND_MODES.filter((m) => m !== 'normal')
      for (const mode of nonNormal) {
        expect(createBlendFilter(mode)).not.toBeNull()
      }
    })

    it('accepts a custom opacity parameter', () => {
      const filter = createBlendFilter('multiply', 0.7)
      expect(filter).not.toBeNull()
    })
  })
})
