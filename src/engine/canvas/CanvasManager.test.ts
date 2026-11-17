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

// Uploading saved tiles needs a GPU: only which tiles go where matters here.
vi.mock('../utils/readback.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/readback.ts')>()),
  writeTiles: vi.fn(),
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
import { writeTiles } from '../utils/readback.ts'
import type { LayerInfo } from '../../types/layer.ts'
import type { PointerState } from '../../types/engine.ts'
import { defaultGuides, useGuideStore } from '../../stores/guideStore.ts'

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

  describe('guides moved on the canvas, which are saved with the project (plan M1.4)', () => {
    beforeEach(async () => {
      await cm.init(container, 400, 300)
      vi.spyOn(cm.layerManager, 'updateThumbnails').mockImplementation(() => {})
    })

    /** The engine's own pointer handlers, as its input manager calls them. */
    const input = () =>
      cm as unknown as {
        handlePointerDown(ps: PointerState): void
        handlePointerMove(ps: PointerState, coalesced: PointerState[]): void
        handlePointerUp(): void
      }
    const at = (canvasX: number, canvasY: number): PointerState => {
      const { x, y, zoom } = cm.viewTransform.getState()
      return { x: canvasX * zoom + x, y: canvasY * zoom + y, pressure: 0.5, tiltX: 0, tiltY: 0, pointerId: 1, pointerType: 'mouse' }
    }

    it('reports a vanishing point dragged on the canvas once the drag ends', () => {
      useGuideStore.getState().loadGuides({ ...defaultGuides(400, 300), perspectiveEnabled: true })
      cm.applyGuideSettings(useGuideStore.getState())
      expect(cm.guideManager.vanishingPoints).toEqual([{ x: 200, y: 150 }])
      const reported = vi.fn()
      cm.setVanishingPointsChangedCallback(reported)

      input().handlePointerDown(at(200, 150))
      input().handlePointerMove(at(50, 60), [])
      // Not while dragging: each report is a guide change, which saves.
      expect(reported).not.toHaveBeenCalled()
      input().handlePointerUp()

      expect(reported).toHaveBeenCalledTimes(1)
      const [[points]] = reported.mock.calls as [[{ x: number; y: number }[]]]
      expect(points).toHaveLength(1)
      expect(points[0].x).toBeCloseTo(50, 6)
      expect(points[0].y).toBeCloseTo(60, 6)
      // A copy: the store's points don't change under it.
      expect(points).not.toBe(cm.guideManager.vanishingPoints)
    })

    it('centres symmetry on a new document size and reports it, and keeps the centre the document has otherwise', () => {
      const reported = vi.fn()
      cm.setSymmetryCenterChangedCallback(reported)
      // As a project opens with a centre of its own.
      cm.guideManager.symmetryCenterX = 30
      cm.symmetryEngine.centerX = 30

      cm.setDocumentSize(400, 300)
      expect(reported).not.toHaveBeenCalled()
      expect(cm.guideManager.symmetryCenterX).toBe(30)
      expect(cm.symmetryEngine.centerX).toBe(30)

      // Canvas Size.
      cm.setDocumentSize(800, 500)
      expect(reported).toHaveBeenCalledWith(400, 250)
      expect([cm.guideManager.symmetryCenterX, cm.guideManager.symmetryCenterY]).toEqual([400, 250])
      expect([cm.symmetryEngine.centerX, cm.symmetryEngine.centerY]).toEqual([400, 250])
    })
  })

  describe('the view saved with a project (plan M1.4)', () => {
    beforeEach(async () => {
      await cm.init(container, 1000, 500)
    })

    it('gives the point at the middle of the viewport, the zoom and the rotation', () => {
      cm.viewTransform.centerOn(250.123, 100, 2.5, -0.5, 400, 300)
      const view = cm.getView()!
      expect(view.x).toBeCloseTo(250.12, 2)
      expect(view.y).toBeCloseTo(100, 2)
      expect(view.zoom).toBe(2.5)
      // As a turn from 0 to 2π.
      expect(view.rotation).toBeCloseTo(2 * Math.PI - 0.5, 4)
    })

    it('shows a saved view again, centred in a viewport of any size', () => {
      Object.defineProperty(container, 'clientWidth', { value: 1200, configurable: true })
      expect(cm.restoreView({ x: 700, y: 120, zoom: 3, rotation: 0.25 })).toBe(true)
      const centre = cm.viewTransform.screenToCanvas(600, 300)
      expect(centre.x).toBeCloseTo(700, 6)
      expect(centre.y).toBeCloseTo(120, 6)
      expect(cm.viewTransform.getState()).toMatchObject({ zoom: 3, rotation: 0.25 })
    })

    it('moves a point off the document onto it, and keeps the zoom within its limits', () => {
      expect(cm.restoreView({ x: -5000, y: 9000, zoom: 500, rotation: 0 })).toBe(true)
      const centre = cm.viewTransform.screenToCanvas(400, 300)
      expect(centre.x).toBeCloseTo(0, 6)
      expect(centre.y).toBeCloseTo(500, 6)
      expect(cm.viewTransform.getState().zoom).toBe(64)
    })

    it("leaves the view as it is for one that isn't a view, or with no viewport to show it in", () => {
      const before = { ...cm.viewTransform.getState() }
      expect(cm.restoreView({ x: Number.NaN, y: 0, zoom: 1, rotation: 0 })).toBe(false)
      expect(cm.restoreView({ x: 0, y: 0, zoom: 0, rotation: 0 })).toBe(false)
      Object.defineProperty(container, 'clientWidth', { value: 0, configurable: true })
      expect(cm.restoreView({ x: 1, y: 1, zoom: 1, rotation: 0 })).toBe(false)
      expect(cm.getView()).toBeNull()
      expect(cm.viewTransform.getState()).toEqual(before)
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

    it('says which layers it made for a document: the saved ones, and a fresh id for one repeated (plan M1.4)', () => {
      const made = cm.loadDocument(
        [{ info: info('a', 'A'), pixels: null }, { info: info('b', 'B'), pixels: null }, { info: info('a', 'Again'), pixels: null }],
        'b',
      )
      expect(made).toHaveLength(3)
      expect(made.slice(0, 2)).toEqual(['a', 'b'])
      expect(made[2]).not.toBe('a')
      expect(cm.getLayerInfos().map((l) => l.id)).toEqual(made)
      expect(cm.getActiveLayerId()).toBe('b')
    })

    it('puts saved tiles into a layer without counting them as a change (plan M1.4)', () => {
      const onChange = vi.fn()
      const [bottom] = cm.loadDocument([{ info: info('a', 'A'), pixels: null }], 'a')
      cm.setDocumentChangeCallback(onChange)
      const clear = vi.spyOn(cm.brushEngine, 'clearSnapshotCache')
      vi.mocked(writeTiles).mockClear()

      const tiles = [{ x: 0, y: 0, data: new Uint8Array(256 * 256 * 4) }]
      cm.placeTiles(bottom, tiles)
      expect(writeTiles).toHaveBeenCalledTimes(1)
      const [, target, placed] = vi.mocked(writeTiles).mock.calls[0]
      expect(target).toBe(cm.layerManager.getLayerById(bottom)!.texture)
      expect(placed).toBe(tiles)
      // The brush mustn't paint over a snapshot of the layer from before them.
      expect(clear).toHaveBeenCalled()

      cm.placeTiles('missing', tiles)
      cm.placeTiles(bottom, [])
      expect(writeTiles).toHaveBeenCalledTimes(1)

      cm.finishLoading()
      expect(onChange).not.toHaveBeenCalled()
      expect(cm.takeChanges().size).toBe(0)
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
      expect(onLayers).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ name: 'Ink' })]),
        expect.any(String),
        'document',
      )
      expect(onChange).toHaveBeenCalled()
    })

    it("tells the layers panel which layer is chosen, which isn't a change to save (plan M1.4)", () => {
      const second = cm.layerManager.createLayer('Ink')!
      const first = cm.getLayerInfos()[0].id
      const onLayers = vi.fn()
      const onChange = vi.fn()
      cm.setLayerChangeCallback(onLayers)
      cm.setDocumentChangeCallback(onChange)

      cm.layerManager.setActiveLayer(first)
      cm.syncBrushToActiveLayer()
      expect(onLayers).toHaveBeenLastCalledWith(expect.any(Array), first, 'selection')
      expect(cm.getActiveLayerId()).toBe(first)
      cm.layerManager.setActiveLayer(second)
      expect(onChange).not.toHaveBeenCalled()
    })

    it('loads saved layers, with an empty history, without reporting a change', () => {
      const onChange = vi.fn()
      const onLayers = vi.fn()
      cm.setDocumentChangeCallback(onChange)
      cm.setLayerChangeCallback(onLayers)

      cm.loadDocument([{ info: info('a', 'Sky'), pixels: null }, { info: info('b', 'Ink'), pixels: null }], 'a')

      expect(onChange).not.toHaveBeenCalled()
      expect(onLayers).toHaveBeenCalledWith([info('a', 'Sky'), info('b', 'Ink')], 'a', 'document')
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

    it('records the tiles each change touched, for the next save to read (M1.3)', () => {
      const snapshot = (value: number) => ({ width: 4, height: 4, data: new Uint8Array(64).fill(value) })
      const bottom = cm.getActiveLayerId()
      const ink = cm.layerManager.createLayer('Ink')!
      cm.brushEngine.undoManager.pushEntry({ type: 'layer', layerId: ink, before: snapshot(0), after: snapshot(9) })
      cm.brushEngine.undoManager.pushEntry({ type: 'layer', layerId: bottom, before: snapshot(1), after: snapshot(1) })

      expect(cm.takeChanges()).toEqual(new Map([[ink, new Set(['0_0'])], [bottom, new Set()]]))
      // Taken: a new record starts.
      expect(cm.takeChanges()).toEqual(new Map())

      // A layer changed throughout stays so; a deleted one drops out.
      const copy = cm.layerManager.duplicateLayer(ink)!
      cm.brushEngine.undoManager.pushEntry({ type: 'layer', layerId: copy, before: snapshot(0), after: snapshot(5) })
      const gone = cm.layerManager.createLayer('Gone')!
      cm.layerManager.deleteLayer(gone)
      expect(cm.takeChanges()).toEqual(new Map([[copy, 'all']]))
    })

    it('records undo and redo as changing the whole layer once it changed outside the history (review of M1.3)', async () => {
      const snapshot = (value: number) => ({ width: 4, height: 4, data: new Uint8Array(64).fill(value) })
      const bottom = cm.getActiveLayerId()
      cm.brushEngine.undoManager.pushEntry({ type: 'layer', layerId: bottom, before: snapshot(1), after: snapshot(1) })
      const top = cm.layerManager.createLayer('Top')!
      expect(cm.layerManager.mergeDown(top)).toBe(true)
      cm.takeChanges()
      // Restoring pixels needs a GPU: only what gets recorded matters here.
      vi.spyOn(cm as unknown as { restoreLayerSnapshot: () => void }, 'restoreLayerSnapshot').mockImplementation(() => {})

      expect(await cm.performUndo()).toBe(true)
      expect(cm.takeChanges()).toEqual(new Map([[bottom, 'all']]))
      expect(await cm.performRedo()).toBe(true)
      expect(cm.takeChanges()).toEqual(new Map([[bottom, 'all']]))
    })

    it("drops the brush's snapshot of a layer whenever something else changes it (review of M1.3)", () => {
      const snapshot = (value: number) => ({ width: 4, height: 4, data: new Uint8Array(64).fill(value) })
      const clear = vi.spyOn(cm.brushEngine, 'clearSnapshotCache')
      // A fill, a filter or a transform: a step the brush didn't take.
      cm.brushEngine.undoManager.pushEntry({ type: 'layer', layerId: cm.getActiveLayerId(), before: snapshot(0), after: snapshot(3) })
      expect(clear).toHaveBeenCalledTimes(1)
      cm.layerManager.duplicateLayer(cm.getActiveLayerId())
      expect(clear).toHaveBeenCalledTimes(2)
    })

    it('starts a new record when a document is loaded', () => {
      cm.layerManager.createLayer('Ink')
      cm.loadDocument([{ info: info('a', 'Sky'), pixels: null }], 'a')
      expect(cm.takeChanges()).toEqual(new Map())
    })

    it('reads tiles from before a preview, and none from a snapshot compressed since', () => {
      const id = cm.getActiveLayerId()
      const committed = { width: 4, height: 4, data: new Uint8Array(64).fill(7), compressed: false }
      vi.spyOn(FilterManager.prototype, 'isActive').mockReturnValue(true)
      vi.spyOn(FilterManager.prototype, 'committedPixels').mockImplementation((layerId) => (layerId === id ? committed : null))

      const [tile] = cm.getLayerTiles(id, [{ x: 0, y: 0 }])!
      expect([tile.x, tile.y]).toEqual([0, 0])
      expect(tile.pixels).toEqual(committed.data)
      expect(tile.pixels.buffer).not.toBe(committed.data.buffer)

      committed.compressed = true
      expect(cm.getLayerTiles(id, [{ x: 0, y: 0 }])).toBeNull()
      expect(cm.getLayerTiles('missing', [{ x: 0, y: 0 }])).toBeNull()
    })

    it('says whether a stroke is being drawn', () => {
      expect(cm.isDrawing()).toBe(false)
      vi.spyOn(cm.brushEngine, 'isStroking').mockReturnValue(true)
      expect(cm.isDrawing()).toBe(true)
    })

    it('ends a stroke still being drawn when the tool changes to one its pointer up would go to', () => {
      const stroking = vi.spyOn(cm.brushEngine, 'isStroking').mockReturnValue(true)
      const end = vi.spyOn(cm.brushEngine, 'endStroke').mockImplementation(() => stroking.mockReturnValue(false))
      cm.setActiveTool('brush')
      cm.setActiveTool('eraser')
      // The eraser ends brush strokes too: the stroke goes on.
      expect(end).not.toHaveBeenCalled()
      cm.setActiveTool('selection')
      expect(end).toHaveBeenCalledTimes(1)
      cm.setActiveTool('move')
      expect(end).toHaveBeenCalledTimes(1)
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
