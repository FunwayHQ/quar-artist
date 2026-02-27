import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock pixi.js — PixiJS can't run in jsdom
vi.mock('pixi.js', () => {
  const mockTexture = {
    destroy: vi.fn(),
    width: 800,
    height: 600,
  }
  class MockApplication {}
  class MockSprite {
    texture: unknown
    alpha = 1
    mask: unknown = null
    position = { set: vi.fn() }
    blendMode = 'normal'
    constructor(texture?: unknown) {
      this.texture = texture ?? mockTexture
    }
  }
  class MockGraphics {
    clear = vi.fn()
    circle = vi.fn()
    fill = vi.fn()
    rect = vi.fn()
  }
  class MockContainer {
    blendMode = 'normal'
    addChild = vi.fn()
    removeChild = vi.fn()
    removeChildren = vi.fn()
  }
  class MockTexture {
    destroy = vi.fn()
    static from = vi.fn(() => new MockTexture())
  }
  return {
    Application: MockApplication,
    RenderTexture: { create: vi.fn(() => ({ ...mockTexture, destroy: vi.fn() })) },
    Sprite: MockSprite,
    Graphics: MockGraphics,
    Container: MockContainer,
    Texture: MockTexture,
  }
})

// Mock the renderer
vi.mock('../renderer.ts', () => ({
  createRenderer: vi.fn().mockResolvedValue({
    renderer: { type: 0x01, resize: vi.fn(), render: vi.fn() },
    stage: {
      position: { set: vi.fn() },
      scale: { set: vi.fn() },
      rotation: 0,
      addChild: vi.fn(),
    },
    destroy: vi.fn(),
  }),
}))

// Mock ResizeObserver (not available in jsdom)
const mockObserve = vi.fn()
const mockDisconnect = vi.fn()

class MockResizeObserver {
  _cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) { this._cb = cb }
  observe = mockObserve
  disconnect = mockDisconnect
  unobserve = vi.fn()
}

vi.stubGlobal('ResizeObserver', MockResizeObserver)

// Import AFTER mocks are set up
import { CanvasManager } from './CanvasManager.ts'

describe('CanvasManager', () => {
  let cm: CanvasManager
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    cm = new CanvasManager()
    container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true })
    Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true })
    document.body.appendChild(container)
  })

  afterEach(() => {
    cm.destroy()
    if (container.parentNode) {
      document.body.removeChild(container)
    }
  })

  describe('init', () => {
    it('creates two canvas elements in the container', async () => {
      await cm.init(container)
      const canvases = container.querySelectorAll('canvas')
      expect(canvases).toHaveLength(2)
    })

    it('static canvas is positioned absolute', async () => {
      await cm.init(container)
      const canvases = container.querySelectorAll('canvas')
      expect(canvases[0].style.position).toBe('absolute')
    })

    it('overlay canvas has pointer-events: auto', async () => {
      await cm.init(container)
      const canvases = container.querySelectorAll('canvas')
      expect(canvases[1].style.pointerEvents).toBe('auto')
    })

    it('sets up ResizeObserver on the container', async () => {
      await cm.init(container)
      expect(mockObserve).toHaveBeenCalledWith(container)
    })
  })

  describe('getPixiApp', () => {
    it('returns null before init', () => {
      expect(cm.getPixiApp()).toBeNull()
    })

    it('returns the app after init', async () => {
      await cm.init(container)
      expect(cm.getPixiApp()).not.toBeNull()
    })
  })

  describe('getOverlayCtx', () => {
    it('returns null before init', () => {
      expect(cm.getOverlayCtx()).toBeNull()
    })
  })

  describe('viewTransform and inputManager', () => {
    it('exposes viewTransform instance', () => {
      expect(cm.viewTransform).toBeDefined()
      expect(cm.viewTransform.getState()).toEqual({
        x: 0,
        y: 0,
        zoom: 1,
        rotation: 0,
      })
    })

    it('exposes inputManager, brushEngine, layerManager, and compositor', () => {
      expect(cm.inputManager).toBeDefined()
      expect(cm.brushEngine).toBeDefined()
      expect(cm.layerManager).toBeDefined()
      expect(cm.compositor).toBeDefined()
    })
  })

  describe('performUndo / performRedo', () => {
    it('returns false when nothing to undo', async () => {
      expect(await cm.performUndo()).toBe(false)
    })

    it('returns false when nothing to redo', async () => {
      expect(await cm.performRedo()).toBe(false)
    })

    it('exposes undo/redo methods', () => {
      expect(typeof cm.performUndo).toBe('function')
      expect(typeof cm.performRedo).toBe('function')
    })
  })

  describe('selection integration', () => {
    it('exposes selectionController', () => {
      expect(cm.selectionController).toBeDefined()
      expect(cm.selectionController.manager).toBeDefined()
    })

    it('exposes transformManager', () => {
      expect(cm.transformManager).toBeDefined()
    })

    it('setActiveTool changes internal tool routing', () => {
      cm.setActiveTool('selection')
      // Should not throw
      expect(typeof cm.setActiveTool).toBe('function')
    })

    it('selection actions are available', () => {
      expect(typeof cm.selectAll).toBe('function')
      expect(typeof cm.deselectAll).toBe('function')
      expect(typeof cm.invertSelection).toBe('function')
    })

    it('selectAll/deselectAll work', () => {
      cm.selectAll()
      expect(cm.selectionController.hasSelection()).toBe(true)
      cm.deselectAll()
      expect(cm.selectionController.hasSelection()).toBe(false)
    })

    it('setSelectionSubTool changes the sub-tool', () => {
      cm.setSelectionSubTool('ellipse')
      expect(cm.selectionController.getSubTool()).toBe('ellipse')
    })
  })

  describe('destroy', () => {
    it('removes canvases from DOM', async () => {
      await cm.init(container)
      expect(container.querySelectorAll('canvas')).toHaveLength(2)
      cm.destroy()
      expect(container.querySelectorAll('canvas')).toHaveLength(0)
    })

    it('disconnects ResizeObserver', async () => {
      await cm.init(container)
      cm.destroy()
      expect(mockDisconnect).toHaveBeenCalled()
    })

    it('sets pixi app to null', async () => {
      await cm.init(container)
      cm.destroy()
      expect(cm.getPixiApp()).toBeNull()
    })

    it('survives being called before init completes (StrictMode)', async () => {
      const initPromise = cm.init(container)
      cm.destroy()
      await initPromise
    })

    it('is safe to call without init', () => {
      expect(() => cm.destroy()).not.toThrow()
    })
  })
})
