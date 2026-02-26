import { describe, it, expect, beforeEach } from 'vitest'
import { BrushTextureManager } from './BrushTextureManager.ts'
import type { ShapeTextureId, GrainTextureId } from '../../types/brush.ts'

const ALL_SHAPES: ShapeTextureId[] = [
  'hard-round',
  'soft-round',
  'pencil-grain',
  'ink-splatter',
  'watercolor-bleed',
  'oil-bristle',
  'marker-flat',
  'pastel-rough',
  'charcoal-grain',
  'smudge-soft',
  'flat-square',
  'airbrush-gradient',
]

const ALL_GRAINS: GrainTextureId[] = [
  'paper-fine',
  'paper-rough',
  'canvas-weave',
  'noise-perlin',
]

describe('BrushTextureManager', () => {
  let manager: BrushTextureManager

  beforeEach(() => {
    manager = new BrushTextureManager()
  })

  describe('shape textures', () => {
    it('returns correct size', () => {
      expect(manager.getShapeSize()).toBe(128)
    })

    for (const id of ALL_SHAPES) {
      it(`generates ${id} shape texture`, () => {
        const tex = manager.getShape(id)
        const size = manager.getShapeSize()
        expect(tex).toBeInstanceOf(Uint8Array)
        expect(tex.length).toBe(size * size)
      })
    }

    it('caches shape textures (returns same reference)', () => {
      const tex1 = manager.getShape('hard-round')
      const tex2 = manager.getShape('hard-round')
      expect(tex1).toBe(tex2)
    })

    it('hard-round has solid center', () => {
      const tex = manager.getShape('hard-round')
      const size = manager.getShapeSize()
      const center = tex[Math.floor(size / 2) * size + Math.floor(size / 2)]
      expect(center).toBe(255)
    })

    it('hard-round has transparent corners', () => {
      const tex = manager.getShape('hard-round')
      const size = manager.getShapeSize()
      expect(tex[0]).toBe(0) // top-left
      expect(tex[size - 1]).toBe(0) // top-right
      expect(tex[(size - 1) * size]).toBe(0) // bottom-left
      expect(tex[size * size - 1]).toBe(0) // bottom-right
    })

    it('soft-round center is brightest', () => {
      const tex = manager.getShape('soft-round')
      const size = manager.getShapeSize()
      const center = tex[Math.floor(size / 2) * size + Math.floor(size / 2)]
      const edge = tex[Math.floor(size / 2) * size + size - 2]
      expect(center).toBeGreaterThan(edge)
    })

    it('all 12 shape textures are unique', () => {
      const checksums = new Set<number>()
      for (const id of ALL_SHAPES) {
        const tex = manager.getShape(id)
        // Weighted checksum across the entire texture
        let sum = 0
        for (let i = 0; i < tex.length; i++) sum += tex[i] * ((i % 97) + 1)
        checksums.add(sum)
      }
      expect(checksums.size).toBe(ALL_SHAPES.length)
    })
  })

  describe('grain textures', () => {
    it('returns correct size', () => {
      expect(manager.getGrainSize()).toBe(256)
    })

    for (const id of ALL_GRAINS) {
      it(`generates ${id} grain texture`, () => {
        const tex = manager.getGrain(id)
        const size = manager.getGrainSize()
        expect(tex).toBeInstanceOf(Uint8Array)
        expect(tex.length).toBe(size * size)
      })
    }

    it('caches grain textures (returns same reference)', () => {
      const tex1 = manager.getGrain('paper-fine')
      const tex2 = manager.getGrain('paper-fine')
      expect(tex1).toBe(tex2)
    })

    it('grain textures have non-zero values', () => {
      for (const id of ALL_GRAINS) {
        const tex = manager.getGrain(id)
        let hasNonZero = false
        for (let i = 0; i < tex.length; i++) {
          if (tex[i] > 0) { hasNonZero = true; break }
        }
        expect(hasNonZero).toBe(true)
      }
    })

    it('all 4 grain textures are unique', () => {
      const checksums = new Set<number>()
      for (const id of ALL_GRAINS) {
        const tex = manager.getGrain(id)
        let sum = 0
        for (let i = 0; i < 200; i++) sum += tex[i]
        checksums.add(sum)
      }
      expect(checksums.size).toBe(ALL_GRAINS.length)
    })
  })

  describe('deterministic generation', () => {
    it('generates identical textures on repeated calls', () => {
      const mgr1 = new BrushTextureManager()
      const mgr2 = new BrushTextureManager()
      const tex1 = mgr1.getShape('pencil-grain')
      const tex2 = mgr2.getShape('pencil-grain')
      expect(Array.from(tex1)).toEqual(Array.from(tex2))
    })

    it('generates identical grains on repeated calls', () => {
      const mgr1 = new BrushTextureManager()
      const mgr2 = new BrushTextureManager()
      const tex1 = mgr1.getGrain('noise-perlin')
      const tex2 = mgr2.getGrain('noise-perlin')
      expect(Array.from(tex1)).toEqual(Array.from(tex2))
    })
  })

  describe('clear', () => {
    it('clears cached textures', () => {
      const tex1 = manager.getShape('hard-round')
      manager.clear()
      const tex2 = manager.getShape('hard-round')
      expect(tex1).not.toBe(tex2) // Different reference after clear
      expect(Array.from(tex1)).toEqual(Array.from(tex2)) // Same content (deterministic)
    })
  })
})
