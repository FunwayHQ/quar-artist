import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Application, RenderTexture } from 'pixi.js'
import type { StrokePoint } from '../../types/brush.ts'

// Layer textures stand in as plain objects whose readback is one colour.
vi.mock('../utils/readback.ts', () => ({
  readPixels: vi.fn((_renderer: unknown, texture: { width: number; height: number; fill: number }) => ({
    pixels: new Uint8ClampedArray(texture.width * texture.height * 4).fill(texture.fill),
    width: texture.width,
    height: texture.height,
  })),
}))

import { BrushEngine } from './BrushEngine.ts'
import { DEFAULT_PRESETS } from './BrushParams.ts'

type FakeTexture = RenderTexture & { fill: number; destroyed: boolean }

function texture(): FakeTexture {
  return { width: 4, height: 4, fill: 0, destroyed: false } as unknown as FakeTexture
}

function point(x: number, y: number): StrokePoint {
  return { x, y, pressure: 0.5, tiltX: 0, tiltY: 0, timestamp: 0 }
}

describe('BrushEngine', () => {
  let brush: BrushEngine
  let changes: [string, unknown][]

  beforeEach(() => {
    brush = new BrushEngine()
    brush.setApp({ renderer: { render: vi.fn() } } as unknown as Application)
    brush.setPreset(DEFAULT_PRESETS[0])
    changes = []
    brush.undoManager.setPixelChangeCallback((id, tiles) => changes.push([id, tiles]))
  })

  function paintOn(layer: FakeTexture, id: string) {
    brush.setActiveLayerTexture(layer)
    brush.setActiveLayerId(id)
  }

  describe('a stroke whose layer changes before it ends (review of M1.3)', () => {
    it('ends on the layer it began on, and draws no more', () => {
      const a = texture()
      const b = texture()
      paintOn(a, 'a')
      brush.beginStroke(point(1, 1))
      a.fill = 9 // what the stroke drew

      paintOn(b, 'b')
      expect(brush.isStroking()).toBe(false)
      expect(changes).toEqual([['a', new Set(['0_0'])]])
      expect(brush.undoManager.canUndo).toBe(true)

      // The rest of it goes nowhere: no second step, nothing recorded for b.
      brush.continueStroke([point(2, 2)])
      brush.endStroke()
      expect(changes).toHaveLength(1)
    })

    it('is dropped when the layer it began on was deleted', () => {
      const a = texture()
      paintOn(a, 'a')
      brush.beginStroke(point(1, 1))
      a.destroyed = true

      paintOn(texture(), 'b')
      expect(brush.isStroking()).toBe(false)
      expect(changes).toEqual([['a', 'all']])
      expect(brush.undoManager.canUndo).toBe(false)
    })

    it('goes on when given the texture it already paints on', () => {
      const a = texture()
      paintOn(a, 'a')
      brush.beginStroke(point(1, 1))
      paintOn(a, 'a')
      expect(brush.isStroking()).toBe(true)
      brush.endStroke()
      expect(changes).toHaveLength(1)
    })
  })
})
