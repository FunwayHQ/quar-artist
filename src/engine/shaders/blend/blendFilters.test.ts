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

import { createBlendFilter, needsCustomBlend } from './blendFilters.ts'
import type { BlendMode } from '../../../types/layer.ts'

describe('blendFilters', () => {
  describe('needsCustomBlend', () => {
    it('returns false for normal', () => {
      expect(needsCustomBlend('normal')).toBe(false)
    })

    it('returns true for all custom modes', () => {
      const modes: BlendMode[] = [
        'multiply',
        'screen',
        'overlay',
        'softLight',
        'add',
        'color',
        'luminosity',
      ]
      for (const mode of modes) {
        expect(needsCustomBlend(mode)).toBe(true)
      }
    })
  })

  describe('createBlendFilter', () => {
    it('returns null for normal blend', () => {
      expect(createBlendFilter('normal')).toBeNull()
    })

    it('returns a Filter for multiply', () => {
      const filter = createBlendFilter('multiply')
      expect(filter).not.toBeNull()
    })

    it('returns a Filter for screen', () => {
      expect(createBlendFilter('screen')).not.toBeNull()
    })

    it('returns a Filter for overlay', () => {
      expect(createBlendFilter('overlay')).not.toBeNull()
    })

    it('returns a Filter for softLight', () => {
      expect(createBlendFilter('softLight')).not.toBeNull()
    })

    it('returns a Filter for add', () => {
      expect(createBlendFilter('add')).not.toBeNull()
    })

    it('returns a Filter for color', () => {
      expect(createBlendFilter('color')).not.toBeNull()
    })

    it('returns a Filter for luminosity', () => {
      expect(createBlendFilter('luminosity')).not.toBeNull()
    })

    it('accepts a custom opacity parameter', () => {
      const filter = createBlendFilter('multiply', 0.7)
      expect(filter).not.toBeNull()
    })
  })
})
