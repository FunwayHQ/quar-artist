import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock pixi.js
vi.mock('pixi.js', () => {
  class MockRenderTexture {
    width: number
    height: number
    destroyed = false
    constructor(w: number, h: number) {
      this.width = w
      this.height = h
    }
    destroy = vi.fn(() => { this.destroyed = true })
  }
  class MockSprite {
    texture: unknown
    alpha = 1
    mask: unknown = null
    constructor(texture?: unknown) {
      this.texture = texture
    }
  }
  return {
    RenderTexture: {
      create: vi.fn(({ width, height }: { width: number; height: number }) =>
        new MockRenderTexture(width, height),
      ),
    },
    Sprite: MockSprite,
    Application: class {},
  }
})

import { LayerManager, _resetLayerIdCounter } from './LayerManager.ts'

describe('LayerManager', () => {
  let lm: LayerManager

  beforeEach(() => {
    _resetLayerIdCounter()
    lm = new LayerManager()
    lm.setSize(1024, 768)
  })

  describe('init', () => {
    it('creates a default layer', () => {
      lm.init()
      expect(lm.count).toBe(1)
      expect(lm.getActiveLayer()).not.toBeNull()
    })

    it('default layer is named "Layer 1"', () => {
      lm.init()
      const infos = lm.getLayerInfos()
      expect(infos[0].name).toBe('Layer 1')
    })

    it('default layer is visible with normal blend', () => {
      lm.init()
      const info = lm.getLayerInfos()[0]
      expect(info.visible).toBe(true)
      expect(info.opacity).toBe(1)
      expect(info.blendMode).toBe('normal')
    })

    it('does not create another layer if already initialized', () => {
      lm.init()
      lm.init()
      expect(lm.count).toBe(1)
    })
  })

  describe('createLayer', () => {
    it('adds a layer and makes it active', () => {
      lm.init()
      const id = lm.createLayer('Layer 2')
      expect(id).not.toBeNull()
      expect(lm.count).toBe(2)
      expect(lm.getActiveLayerId()).toBe(id)
    })

    it('inserts above the active layer', () => {
      lm.init()
      const first = lm.getActiveLayerId()
      lm.createLayer('Layer 2')
      const infos = lm.getLayerInfos()
      // First layer is at index 0 (bottom), new layer at index 1 (top)
      expect(infos[0].id).toBe(first)
      expect(infos[1].name).toBe('Layer 2')
    })

    it('respects the 20-layer limit', () => {
      lm.init()
      for (let i = 0; i < 19; i++) {
        lm.createLayer()
      }
      expect(lm.count).toBe(20)
      expect(lm.createLayer()).toBeNull()
      expect(lm.count).toBe(20)
    })

    it('auto-names layers', () => {
      lm.init()
      lm.createLayer()
      const infos = lm.getLayerInfos()
      expect(infos[1].name).toBe('Layer 2')
    })
  })

  describe('deleteLayer', () => {
    it('removes a layer', () => {
      lm.init()
      const id = lm.createLayer('Temp')!
      expect(lm.count).toBe(2)
      lm.deleteLayer(id)
      expect(lm.count).toBe(1)
    })

    it('cannot delete the last layer', () => {
      lm.init()
      const id = lm.getActiveLayerId()
      expect(lm.deleteLayer(id)).toBe(false)
      expect(lm.count).toBe(1)
    })

    it('selects the layer below after deletion', () => {
      lm.init()
      const firstId = lm.getActiveLayerId()
      lm.createLayer('Layer 2')
      const secondId = lm.getActiveLayerId()
      lm.deleteLayer(secondId)
      expect(lm.getActiveLayerId()).toBe(firstId)
    })

    it('returns false for unknown id', () => {
      lm.init()
      expect(lm.deleteLayer('nonexistent')).toBe(false)
    })
  })

  describe('duplicateLayer', () => {
    it('creates a copy with " copy" suffix', () => {
      lm.init()
      const origId = lm.getActiveLayerId()
      const copyId = lm.duplicateLayer(origId)
      expect(copyId).not.toBeNull()
      expect(lm.count).toBe(2)

      const copy = lm.getLayerInfos().find((l) => l.id === copyId)
      expect(copy?.name).toBe('Layer 1 copy')
    })

    it('respects the 20-layer limit', () => {
      lm.init()
      for (let i = 0; i < 19; i++) {
        lm.createLayer()
      }
      expect(lm.duplicateLayer(lm.getActiveLayerId())).toBeNull()
    })

    it('returns null for unknown id', () => {
      lm.init()
      expect(lm.duplicateLayer('nonexistent')).toBeNull()
    })
  })

  describe('reorderLayers', () => {
    it('reorders layers by id array', () => {
      lm.init()
      const id1 = lm.getActiveLayerId()
      const id2 = lm.createLayer('B')!
      const id3 = lm.createLayer('C')!

      lm.reorderLayers([id3, id1, id2])
      const infos = lm.getLayerInfos()
      expect(infos[0].id).toBe(id3)
      expect(infos[1].id).toBe(id1)
      expect(infos[2].id).toBe(id2)
    })

    it('ignores invalid reorder (wrong length)', () => {
      lm.init()
      const id = lm.getActiveLayerId()
      lm.createLayer('B')

      lm.reorderLayers([id]) // Missing one layer
      expect(lm.count).toBe(2)
    })
  })

  describe('mergeDown', () => {
    it('requires the app to be set', () => {
      lm.init()
      lm.createLayer('Top')
      expect(lm.mergeDown(lm.getActiveLayerId())).toBe(false)
    })

    it('cannot merge the bottom layer', () => {
      lm.init()
      const bottomId = lm.getActiveLayerId()
      lm.createLayer('Top')
      expect(lm.mergeDown(bottomId)).toBe(false)
    })

    it('merges when app is set', () => {
      const mockApp = {
        renderer: { render: vi.fn() },
      } as any
      lm.setApp(mockApp)
      lm.init()
      lm.createLayer('Top')
      const topId = lm.getActiveLayerId()
      expect(lm.mergeDown(topId)).toBe(true)
      expect(lm.count).toBe(1)
    })
  })

  describe('setActiveLayer', () => {
    it('switches the active layer', () => {
      lm.init()
      const id1 = lm.getActiveLayerId()
      const id2 = lm.createLayer()!
      expect(lm.getActiveLayerId()).toBe(id2)
      lm.setActiveLayer(id1)
      expect(lm.getActiveLayerId()).toBe(id1)
    })

    it('ignores unknown id', () => {
      lm.init()
      const current = lm.getActiveLayerId()
      lm.setActiveLayer('nonexistent')
      expect(lm.getActiveLayerId()).toBe(current)
    })
  })

  describe('layer metadata', () => {
    it('setVisibility toggles visibility', () => {
      lm.init()
      const id = lm.getActiveLayerId()
      lm.setVisibility(id, false)
      expect(lm.getLayerInfos()[0].visible).toBe(false)
    })

    it('setLayerOpacity clamps to [0, 1]', () => {
      lm.init()
      const id = lm.getActiveLayerId()
      lm.setLayerOpacity(id, 2)
      expect(lm.getLayerInfos()[0].opacity).toBe(1)
      lm.setLayerOpacity(id, -1)
      expect(lm.getLayerInfos()[0].opacity).toBe(0)
      lm.setLayerOpacity(id, 0.5)
      expect(lm.getLayerInfos()[0].opacity).toBe(0.5)
    })

    it('setBlendMode updates blend mode', () => {
      lm.init()
      const id = lm.getActiveLayerId()
      lm.setBlendMode(id, 'multiply')
      expect(lm.getLayerInfos()[0].blendMode).toBe('multiply')
    })

    it('toggleAlphaLock flips the flag', () => {
      lm.init()
      const id = lm.getActiveLayerId()
      expect(lm.getLayerInfos()[0].alphaLock).toBe(false)
      lm.toggleAlphaLock(id)
      expect(lm.getLayerInfos()[0].alphaLock).toBe(true)
      lm.toggleAlphaLock(id)
      expect(lm.getLayerInfos()[0].alphaLock).toBe(false)
    })

    it('toggleClippingMask flips the flag', () => {
      lm.init()
      const id = lm.getActiveLayerId()
      expect(lm.getLayerInfos()[0].clippingMask).toBe(false)
      lm.toggleClippingMask(id)
      expect(lm.getLayerInfos()[0].clippingMask).toBe(true)
    })

    it('renameLayer updates the name', () => {
      lm.init()
      const id = lm.getActiveLayerId()
      lm.renameLayer(id, 'Background')
      expect(lm.getLayerInfos()[0].name).toBe('Background')
    })
  })

  describe('change callback', () => {
    it('fires on createLayer', () => {
      const cb = vi.fn()
      lm.setChangeCallback(cb)
      lm.init()
      expect(cb).toHaveBeenCalledTimes(1)
      expect(cb).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(String),
      )
    })

    it('fires on deleteLayer', () => {
      lm.init()
      const id = lm.createLayer()!
      const cb = vi.fn()
      lm.setChangeCallback(cb)
      lm.deleteLayer(id)
      expect(cb).toHaveBeenCalledTimes(1)
    })

    it('fires on setActiveLayer', () => {
      lm.init()
      const id1 = lm.getActiveLayerId()
      lm.createLayer()
      const cb = vi.fn()
      lm.setChangeCallback(cb)
      lm.setActiveLayer(id1)
      expect(cb).toHaveBeenCalledTimes(1)
    })
  })

  describe('getLayerById', () => {
    it('returns the layer with matching id', () => {
      lm.init()
      const id = lm.getActiveLayerId()
      const layer = lm.getLayerById(id)
      expect(layer).not.toBeNull()
      expect(layer!.info.id).toBe(id)
    })

    it('returns null for unknown id', () => {
      lm.init()
      expect(lm.getLayerById('nonexistent')).toBeNull()
    })
  })

  describe('getActiveTexture', () => {
    it('returns the texture of the active layer', () => {
      lm.init()
      expect(lm.getActiveTexture()).not.toBeNull()
    })

    it('returns null when no layers exist', () => {
      expect(lm.getActiveTexture()).toBeNull()
    })
  })

  describe('destroy', () => {
    it('clears all layers', () => {
      lm.init()
      lm.createLayer()
      lm.destroy()
      expect(lm.count).toBe(0)
      expect(lm.getActiveLayerId()).toBe('')
    })
  })
})
