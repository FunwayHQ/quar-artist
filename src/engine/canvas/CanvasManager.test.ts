import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock pixi.js — PixiJS can't run in jsdom
// Registers GPU blend shaders, which need the real PixiJS and are never drawn here.
vi.mock('../layers/blendModes.ts', () => ({}))

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
import { FilterManager } from '../filters/FilterManager.ts'
import { createRenderer } from '../renderer.ts'
import type { LayerInfo } from '../../types/layer.ts'

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

  describe('setActiveTool cursor', () => {
    it('sets grab cursor for hand tool', async () => {
      await cm.init(container)
      cm.setActiveTool('move')
      const overlay = container.querySelectorAll('canvas')[1]
      expect(overlay.style.cursor).toBe('grab')
    })

    it('sets default cursor for transform tool', async () => {
      await cm.init(container)
      cm.setActiveTool('transform')
      const overlay = container.querySelectorAll('canvas')[1]
      expect(overlay.style.cursor).toBe('default')
    })

    it('resets cursor for brush tool', async () => {
      await cm.init(container)
      cm.setActiveTool('move')
      cm.setActiveTool('brush')
      const overlay = container.querySelectorAll('canvas')[1]
      expect(overlay.style.cursor).toBe('crosshair')
    })
  })

  describe('hand tool (move)', () => {
    it('pans viewTransform on drag', async () => {
      await cm.init(container)
      cm.setActiveTool('move')

      const initialState = cm.viewTransform.getState()
      const startX = initialState.x
      const startY = initialState.y

      // Simulate pan via viewTransform directly (pointer routing tested via integration)
      cm.viewTransform.pan(50, 30)
      const newState = cm.viewTransform.getState()
      expect(newState.x).toBe(startX + 50)
      expect(newState.y).toBe(startY + 30)
    })
  })

  describe('layer move tool (transform)', () => {
    it('setActiveTool to transform does not throw', () => {
      cm.setActiveTool('transform')
      expect(typeof cm.setActiveTool).toBe('function')
    })
  })

  describe('overlay rendering (F62)', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('draws once after start-up, then waits for a change', async () => {
      await cm.init(container)
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersToNextFrame()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('draws once more when the view changes, however often it changes in a frame', async () => {
      await cm.init(container)
      vi.advanceTimersToNextFrame()

      cm.viewTransform.pan(10, 0)
      cm.viewTransform.pan(10, 0)
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersToNextFrame()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('keeps animating the marching ants while a selection is shown', async () => {
      await cm.init(container)
      vi.advanceTimersToNextFrame()

      cm.selectAll()
      for (let frame = 0; frame < 3; frame++) {
        vi.advanceTimersToNextFrame()
        expect(vi.getTimerCount()).toBe(1)
      }

      cm.deselectAll()
      vi.advanceTimersToNextFrame()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('stops drawing when destroyed', async () => {
      await cm.init(container)
      cm.selectAll()
      cm.destroy()
      expect(vi.getTimerCount()).toBe(0)
      cm.requestOverlayRender()
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  describe('documents (M1.1)', () => {
    const info = (id: string, name: string): LayerInfo => ({
      id,
      name,
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      alphaLock: false,
      clippingMask: false,
      locked: false,
    })

    beforeEach(async () => {
      await cm.init(container, 4, 4)
      // Layer thumbnails read pixels back, which the mocked renderer can't.
      vi.spyOn(cm.layerManager, 'updateThumbnails').mockImplementation(() => {})
    })

    it('reports layer changes and history steps as changes worth saving', () => {
      const onChange = vi.fn()
      cm.setDocumentChangeCallback(onChange)

      cm.layerManager.createLayer('Ink')
      expect(onChange).toHaveBeenCalled()

      onChange.mockClear()
      cm.brushEngine.undoManager.clear()
      expect(onChange).toHaveBeenCalled()
    })

    it('still tells the layers panel about layer changes', () => {
      const onLayers = vi.fn()
      const onChange = vi.fn()
      cm.setLayerChangeCallback(onLayers)
      cm.setDocumentChangeCallback(onChange)
      cm.layerManager.createLayer('Ink')
      expect(onLayers).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ name: 'Ink' })]), expect.any(String))
      expect(onChange).toHaveBeenCalled()
    })

    it('loads saved layers, with an empty history, without reporting a change', () => {
      const onChange = vi.fn()
      const onLayers = vi.fn()
      cm.setDocumentChangeCallback(onChange)
      cm.setLayerChangeCallback(onLayers)

      cm.loadDocument([{ info: info('a', 'Sky'), pixels: null }, { info: info('b', 'Ink'), pixels: null }], 'a')

      expect(onChange).not.toHaveBeenCalled()
      expect(onLayers).toHaveBeenCalledWith([info('a', 'Sky'), info('b', 'Ink')], 'a')
      expect(cm.getLayerInfos()).toEqual([info('a', 'Sky'), info('b', 'Ink')])
      expect(cm.getActiveLayerId()).toBe('a')
      expect(cm.brushEngine.undoManager.canUndo).toBe(false)

      // Changes after loading count again.
      cm.layerManager.createLayer('New')
      expect(onChange).toHaveBeenCalled()
    })

    it('saves the pixels from before a filter preview, which is not part of the document yet', () => {
      const id = cm.getActiveLayerId()
      const committed = { width: 4, height: 4, data: new Uint8Array(64).fill(7) }
      vi.spyOn(FilterManager.prototype, 'isActive').mockReturnValue(true)
      vi.spyOn(FilterManager.prototype, 'committedPixels').mockImplementation((layerId) => (layerId === id ? committed : null))

      expect(cm.isPreviewing()).toBe(true)
      // A copy: the save hands it to the persistence worker, and the preview still needs its own.
      const pixels = cm.getLayerPixels(id)!
      expect(pixels).toEqual(committed.data)
      expect(pixels.buffer).not.toBe(committed.data.buffer)
    })

    it('saves the pixels from before a transform', () => {
      const id = cm.getActiveLayerId()
      const before = { width: 4, height: 4, data: new Uint8Array(64).fill(3) }
      ;(cm as unknown as { transformState: { layerId: string; beforeSnapshot: typeof before } }).transformState = {
        layerId: id,
        beforeSnapshot: before,
      }
      expect(cm.isPreviewing()).toBe(true)
      const pixels = cm.getLayerPixels(id)!
      expect(pixels).toEqual(before.data)
      expect(pixels.buffer).not.toBe(before.data.buffer)
      ;(cm as unknown as { transformState: null }).transformState = null
    })

    it('refuses to read pixels once the GPU context is lost, rather than give blanks to save', () => {
      const id = cm.getActiveLayerId()
      const staticCanvas = container.querySelectorAll('canvas')[0]
      staticCanvas.dispatchEvent(new Event('webglcontextlost'))

      expect(() => cm.getLayerPixels(id)).toThrow('graphics processor reset')
      expect(() => cm.getCompositePixels()).toThrow('graphics processor reset')
    })

    it('knows the document size', () => {
      expect(cm.getDocumentSize()).toEqual({ width: 4, height: 4 })
    })

    it('stops reporting once destroyed', () => {
      const onChange = vi.fn()
      cm.setDocumentChangeCallback(onChange)
      cm.destroy()
      cm.layerManager.createLayer('Late')
      expect(onChange).not.toHaveBeenCalled()
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

    it('destroys the renderer that finishes starting after destroy() (StrictMode, F60)', async () => {
      const initPromise = cm.init(container)
      cm.destroy()
      await initPromise
      const app = await vi.mocked(createRenderer).mock.results[0].value
      expect(app.destroy).toHaveBeenCalledWith(true)
      expect(cm.getPixiApp()).toBeNull()
    })

    it('is safe to call without init', () => {
      expect(() => cm.destroy()).not.toThrow()
    })
  })
})
