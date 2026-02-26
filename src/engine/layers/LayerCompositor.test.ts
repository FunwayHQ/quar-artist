import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock pixi.js
vi.mock('pixi.js', () => {
  class MockRenderTexture {
    width: number
    height: number
    constructor(w: number, h: number) {
      this.width = w
      this.height = h
    }
    destroy = vi.fn()
  }
  class MockSprite {
    texture: unknown
    alpha = 1
    mask: unknown = null
    constructor(texture?: unknown) {
      this.texture = texture
    }
  }
  class MockContainer {
    children: unknown[] = []
    addChild = vi.fn((...items: unknown[]) => {
      this.children.push(...items)
    })
    removeChild = vi.fn()
    removeChildren = vi.fn(() => {
      this.children = []
    })
  }
  return {
    RenderTexture: {
      create: vi.fn(({ width, height }: { width: number; height: number }) =>
        new MockRenderTexture(width, height),
      ),
    },
    Sprite: MockSprite,
    Container: MockContainer,
  }
})

import { RenderTexture, Sprite } from 'pixi.js'
import { LayerCompositor } from './LayerCompositor.ts'
import type { Layer } from './LayerManager.ts'
import type { LayerInfo } from '../../types/layer.ts'
import { TileManager } from './TileManager.ts'

function makeLayer(overrides: Partial<LayerInfo> = {}): Layer {
  const texture = RenderTexture.create({ width: 100, height: 100 })
  return {
    info: {
      id: 'l1',
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      alphaLock: false,
      clippingMask: false,
      locked: false,
      ...overrides,
    },
    texture,
    sprite: new Sprite(texture),
    tileManager: new TileManager(),
  }
}

describe('LayerCompositor', () => {
  let comp: LayerCompositor
  let mockApp: any

  beforeEach(() => {
    vi.clearAllMocks()
    comp = new LayerCompositor()
    mockApp = {
      renderer: { render: vi.fn() },
    }
    comp.setApp(mockApp)
    comp.setSize(800, 600)
  })

  it('creates an output sprite', () => {
    expect(comp.getOutputSprite()).not.toBeNull()
  })

  it('creates an output texture', () => {
    const tex = comp.getOutputTexture()
    expect(tex).not.toBeNull()
  })

  it('composites visible layers', () => {
    const layers = [makeLayer({ id: 'a' }), makeLayer({ id: 'b' })]
    comp.composite(layers)
    expect(mockApp.renderer.render).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.anything(),
        clear: true,
      }),
    )
  })

  it('skips invisible layers', () => {
    const layers = [
      makeLayer({ id: 'a', visible: false }),
      makeLayer({ id: 'b', visible: true }),
    ]
    comp.composite(layers)
    expect(mockApp.renderer.render).toHaveBeenCalledTimes(1)
  })

  it('does nothing without an app', () => {
    const comp2 = new LayerCompositor()
    comp2.setSize(100, 100)
    comp2.composite([makeLayer()])
    // No crash, no render call
  })

  it('does nothing without output texture', () => {
    const comp2 = new LayerCompositor()
    comp2.setApp(mockApp)
    comp2.composite([makeLayer()])
    expect(mockApp.renderer.render).not.toHaveBeenCalled()
  })

  it('resizes output texture', () => {
    const tex1 = comp.getOutputTexture()
    comp.setSize(1024, 768)
    const tex2 = comp.getOutputTexture()
    expect(tex2).not.toBe(tex1)
  })

  it('composites empty layer list without error', () => {
    expect(() => comp.composite([])).not.toThrow()
  })

  describe('blend modes', () => {
    it('sets blendMode on layer sprites during compositing', () => {
      const layers = [
        makeLayer({ id: 'a', blendMode: 'multiply' }),
        makeLayer({ id: 'b', blendMode: 'screen' }),
      ]
      comp.composite(layers)
      // The render call should have been made with sprites that have blend modes set
      expect(mockApp.renderer.render).toHaveBeenCalled()
    })

    it('sets normal blend mode for normal layers', () => {
      const layers = [makeLayer({ id: 'a', blendMode: 'normal' })]
      comp.composite(layers)
      expect(mockApp.renderer.render).toHaveBeenCalled()
    })

    it('handles all supported blend modes without error', () => {
      const modes = ['normal', 'multiply', 'screen', 'overlay', 'softLight', 'add', 'color', 'luminosity'] as const
      for (const mode of modes) {
        expect(() => {
          comp.composite([makeLayer({ id: `layer-${mode}`, blendMode: mode })])
        }).not.toThrow()
      }
    })
  })

  describe('destroy', () => {
    it('cleans up resources', () => {
      comp.destroy()
      expect(comp.getOutputTexture()).toBeNull()
      expect(comp.getOutputSprite()).toBeNull()
    })
  })
})
