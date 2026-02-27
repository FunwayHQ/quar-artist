import { describe, it, expect, vi, beforeEach } from 'vitest'

// Polyfill ImageData for jsdom
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as any).ImageData = class ImageData {
    width: number; height: number; data: Uint8ClampedArray
    constructor(data: Uint8ClampedArray, width: number, height?: number) {
      this.data = data; this.width = width; this.height = height ?? (data.length / (width * 4))
    }
  }
}

vi.mock('pixi.js', () => {
  class MockTexture {
    static from = vi.fn(() => new MockTexture())
    destroy = vi.fn()
  }
  class MockSprite {
    texture: unknown
    filters: unknown[] = []
    constructor(texture?: unknown) { this.texture = texture }
  }
  class MockContainer {
    children: unknown[] = []
    addChild(child: unknown) { this.children.push(child) }
    destroy = vi.fn()
  }
  class MockRenderTexture {
    static create = vi.fn(() => new MockRenderTexture())
    destroy = vi.fn()
  }
  class MockFilter {
    resources: unknown
    destroy = vi.fn()
    constructor(opts?: { resources?: unknown }) {
      this.resources = opts?.resources
    }
  }
  class MockGlProgram {
    static from() { return new MockGlProgram() }
  }
  class MockGpuProgram {
    static from() { return new MockGpuProgram() }
  }
  return {
    Texture: MockTexture,
    Sprite: MockSprite,
    Container: MockContainer,
    RenderTexture: MockRenderTexture,
    Filter: MockFilter,
    GlProgram: MockGlProgram,
    GpuProgram: MockGpuProgram,
  }
})

// Mock canvas getContext for jsdom
const mockCtx2d = {
  putImageData: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(64) })),
  clearRect: vi.fn(),
}
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx2d) as any

import { FilterManager } from './FilterManager.ts'
import type { LayerSnapshot } from '../undo/UndoManager.ts'

function mockApp() {
  return {
    renderer: {
      render: vi.fn(),
      extract: {
        pixels: vi.fn(() => ({
          width: 4,
          height: 4,
          pixels: new Uint8ClampedArray(64),
        })),
      },
    },
  } as any
}

function makeSnapshot(w: number, h: number): LayerSnapshot {
  return { width: w, height: h, data: new Uint8Array(w * h * 4) }
}

describe('FilterManager', () => {
  let fm: FilterManager

  beforeEach(() => {
    fm = new FilterManager()
  })

  it('starts inactive', () => {
    expect(fm.isActive()).toBe(false)
  })

  describe('beginPreview', () => {
    it('activates the filter session', () => {
      fm.setApp(mockApp())
      const texture = {} as any
      fm.beginPreview(texture, 'layer-1', makeSnapshot(4, 4), null, 4, 4)
      expect(fm.isActive()).toBe(true)
    })
  })

  describe('cancel', () => {
    it('deactivates and restores original', () => {
      const app = mockApp()
      fm.setApp(app)
      const texture = {} as any
      fm.beginPreview(texture, 'layer-1', makeSnapshot(4, 4), null, 4, 4)
      fm.cancel()
      expect(fm.isActive()).toBe(false)
      // Should have called render to restore
      expect(app.renderer.render).toHaveBeenCalled()
    })

    it('is safe to call when not active', () => {
      fm.cancel() // no error
      expect(fm.isActive()).toBe(false)
    })
  })

  describe('apply', () => {
    it('returns before/after snapshots and layerId', () => {
      const app = mockApp()
      fm.setApp(app)
      const texture = {} as any
      const snapshot = makeSnapshot(4, 4)
      snapshot.data[0] = 100 // mark as non-zero
      fm.beginPreview(texture, 'layer-1', snapshot, null, 4, 4)

      const result = fm.apply()
      expect(result).not.toBeNull()
      expect(result!.layerId).toBe('layer-1')
      expect(result!.before.data[0]).toBe(100)
    })

    it('returns null when not active', () => {
      expect(fm.apply()).toBeNull()
    })
  })

  describe('destroy', () => {
    it('cleans up', () => {
      fm.setApp(mockApp())
      fm.beginPreview({} as any, 'l1', makeSnapshot(4, 4), null, 4, 4)
      fm.destroy()
      expect(fm.isActive()).toBe(false)
    })
  })
})
