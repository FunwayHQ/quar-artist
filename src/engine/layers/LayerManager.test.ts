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
  class MockContainer {
    children: unknown[] = []
    addChild(child: unknown) { this.children.push(child) }
  }
  return {
    RenderTexture: {
      create: vi.fn(({ width, height }: { width: number; height: number }) =>
        new MockRenderTexture(width, height),
      ),
    },
    Sprite: MockSprite,
    Container: MockContainer,
    Application: class {},
  }
})

import { LayerManager } from './LayerManager.ts'
import { MAX_LAYERS, type LayerInfo } from '../../types/layer.ts'

describe('LayerManager', () => {
  let lm: LayerManager

  beforeEach(() => {
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

    it('gives layers ids that never repeat, even in a new session (F98)', () => {
      lm.init()
      lm.createLayer('Layer 2')
      // A second manager stands in for the next page load, which used to restart at layer_1.
      const next = new LayerManager()
      next.setSize(1024, 768)
      next.init()
      next.createLayer('Layer 2')
      const ids = [...lm.getLayerInfos(), ...next.getLayerInfos()].map((l) => l.id)
      expect(new Set(ids).size).toBe(4)
      for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
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

  describe('replaceLayers (opening a project)', () => {
    const info = (id: string, name: string, extra: Partial<LayerInfo> = {}): LayerInfo => ({
      id,
      name,
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      alphaLock: false,
      clippingMask: false,
      locked: false,
      ...extra,
    })

    it('replaces every layer, keeping ids, order and properties', () => {
      lm.init()
      const old = lm.getLayers()[0]

      const created = lm.replaceLayers(
        [info('a', 'Sky'), info('b', 'Ink', { opacity: 0.5, blendMode: 'multiply', locked: true })],
        'a',
      )

      expect(created).toHaveLength(2)
      expect(lm.getLayerInfos()).toEqual([
        info('a', 'Sky'),
        info('b', 'Ink', { opacity: 0.5, blendMode: 'multiply', locked: true }),
      ])
      expect(lm.getActiveLayerId()).toBe('a')
      expect((old.texture as unknown as { destroyed: boolean }).destroyed).toBe(true)
      expect(created.every((l) => l.texture.width === 1024 && l.texture.height === 768)).toBe(true)
    })

    it('makes the top layer active when the saved one is missing', () => {
      lm.replaceLayers([info('a', 'Sky'), info('b', 'Ink')], 'gone')
      expect(lm.getActiveLayerId()).toBe('b')
      lm.replaceLayers([info('a', 'Sky'), info('b', 'Ink')], null)
      expect(lm.getActiveLayerId()).toBe('b')
    })

    it('starts with one empty layer when there are none', () => {
      lm.replaceLayers([], null)
      expect(lm.count).toBe(1)
      expect(lm.getLayerInfos()[0].name).toBe('Layer 1')
      expect(lm.getActiveLayerId()).toBe(lm.getLayerInfos()[0].id)
    })

    it('gives a repeated id a new one, and drops saved thumbnails', () => {
      lm.replaceLayers([info('a', 'Sky', { thumbnail: 'data:old' }), info('a', 'Copy')], 'a')
      const [first, second] = lm.getLayerInfos()
      expect(first.id).toBe('a')
      expect(second.id).not.toBe('a')
      expect(first.thumbnail).toBeUndefined()
    })

    it('keeps no more than the layer limit', () => {
      const many = Array.from({ length: MAX_LAYERS + 3 }, (_, i) => info(`l${i}`, `Layer ${i}`))
      lm.replaceLayers(many, null)
      expect(lm.count).toBe(MAX_LAYERS)
    })

    it('reports the change', () => {
      const onChange = vi.fn()
      lm.setChangeCallback(onChange)
      lm.replaceLayers([info('a', 'Sky')], 'a')
      expect(onChange).toHaveBeenCalledWith([info('a', 'Sky')], 'a')
    })
  })
})

