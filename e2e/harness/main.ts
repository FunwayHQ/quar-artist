/**
 * Engine harness page: boots the real engine (real PixiJS, real GPU, no mocks)
 * and exposes `window.__quar` so Playwright tests can script it and read
 * pixels back. Served by the Vite dev server at /e2e/harness/index.html.
 *
 * Query parameters:
 *   w, h       document size in pixels (default 64×64)
 *   renderer   'webgl' (default) or 'webgpu'
 *
 * Actions mirror what the UI does (see LayersPanel and App), so tests exercise
 * the same engine calls a user triggers.
 */
import { Graphics, type Texture } from 'pixi.js'
import { CanvasManager } from '@engine/canvas/CanvasManager.ts'
import { getBackend } from '@engine/renderer.ts'
import { DEFAULT_PRESETS } from '@engine/brush/BrushParams.ts'
import { exportImage } from '../../src/io/formats/image/ImageExporter.ts'
import { cutTiles, tileBounds, tileKey } from '../../src/utils/tiles.ts'
import type {
  BrushOptions,
  EncodedPixels,
  HarnessInfo,
  LayerProps,
  PointerOptions,
  PointInput,
  QuarHarness,
  Rect,
  RendererPreference,
  RGBA,
} from './protocol.ts'

const params = new URLSearchParams(location.search)
const width = positiveInt(params.get('w'), 64)
const height = positiveInt(params.get('h'), 64)
const preference: RendererPreference = params.get('renderer') === 'webgpu' ? 'webgpu' : 'webgl'

window.__quarBoot = boot()

async function boot(): Promise<HarnessInfo> {
  const stage = document.getElementById('stage')
  if (!stage) throw new Error('harness: #stage is missing')
  stage.style.width = `${width}px`
  stage.style.height = `${height}px`

  const manager = new CanvasManager()
  await manager.init(stage, width, height, { preference })
  // Identity view: one CSS pixel of the stage is one document pixel.
  manager.viewTransform.reset()

  const canvases = stage.querySelectorAll('canvas')
  const overlay = canvases[canvases.length - 1]
  // Synthetic pointers can't be captured (setPointerCapture throws for ids
  // the browser didn't create). Events are dispatched on the overlay itself,
  // so capture isn't needed.
  overlay.setPointerCapture = () => {}

  const info: HarnessInfo = { backend: getBackend() ?? 'webgl2', width, height }
  window.__quar = createHarness(manager, overlay, info)
  return info
}

function createHarness(manager: CanvasManager, overlay: HTMLCanvasElement, info: HarnessInfo): QuarHarness {
  const app = manager.getPixiApp()
  if (!app) throw new Error('harness: engine has no PixiJS application')
  const layers = manager.layerManager

  const layerById = (id: string) => {
    const layer = layers.getLayerById(id)
    if (!layer) throw new Error(`harness: no layer with id ${id}`)
    return layer
  }

  /** WebGL readbacks are premultiplied; WebGPU ones go through a 2D canvas and are straight. */
  const read = (texture: Texture): EncodedPixels => {
    const { pixels, width: w, height: h } = app.renderer.extract.pixels({ target: texture })
    return encode(pixels, w, h, info.backend === 'webgl2')
  }

  /** After writing to a texture outside the tools: drop caches the tools rely on. */
  const afterDirectEdit = () => {
    manager.brushEngine.clearSnapshotCache()
    manager.compositor.invalidateCache()
    manager.recomposite()
  }

  const dispatch = (type: string, p: PointInput, options: PointerOptions, buttons: number) => {
    const rect = overlay.getBoundingClientRect()
    overlay.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: options.pointerType ?? 'mouse',
        isPrimary: true,
        clientX: rect.left + p.x,
        clientY: rect.top + p.y,
        pressure: buttons === 0 ? 0 : (p.pressure ?? 0.5),
        tiltX: p.tiltX ?? 0,
        tiltY: p.tiltY ?? 0,
        button: type === 'pointermove' ? -1 : (options.button ?? 0),
        buttons,
      }),
    )
  }

  const stroke = async (points: PointInput[], options: PointerOptions = {}) => {
    if (points.length === 0) return
    const pressed = 1 << buttonBit(options.button ?? 0)
    dispatch('pointerdown', points[0], options, pressed)
    for (const p of points.slice(1)) dispatch('pointermove', p, options, pressed)
    dispatch('pointerup', points[points.length - 1], options, 0)
    // Let frame-batched composites run.
    await nextFrame()
    await nextFrame()
  }

  return {
    info,

    layers: () => layers.getLayerInfos().map((l) => ({ ...l, thumbnail: undefined })),
    activeLayerId: () => layers.getActiveLayerId(),

    addLayer(name) {
      const id = layers.createLayer(name)
      if (!id) throw new Error('harness: layer limit reached')
      manager.syncBrushToActiveLayer()
      return id
    },

    selectLayer(id) {
      layerById(id)
      layers.setActiveLayer(id)
      manager.syncBrushToActiveLayer()
    },

    setLayerProps(id, props: LayerProps) {
      const layer = layerById(id)
      if (props.opacity !== undefined) layers.setLayerOpacity(id, props.opacity)
      if (props.blendMode !== undefined) layers.setBlendMode(id, props.blendMode)
      if (props.visible !== undefined) layers.setVisibility(id, props.visible)
      // The panel only offers toggles for these two.
      if (props.alphaLock !== undefined && props.alphaLock !== layer.info.alphaLock) layers.toggleAlphaLock(id)
      if (props.clippingMask !== undefined && props.clippingMask !== layer.info.clippingMask) {
        layers.toggleClippingMask(id)
      }
      manager.recomposite()
    },

    mergeDown(id) {
      layers.mergeDown(id)
      manager.brushEngine.clearSnapshotCache()
      manager.syncBrushToActiveLayer()
      manager.recomposite()
    },

    fillRect(layerId, color: RGBA, rect: Rect = { x: 0, y: 0, width: info.width, height: info.height }) {
      const layer = layerById(layerId)
      const [r, g, b, a] = color
      const shape = new Graphics()
        .rect(rect.x, rect.y, rect.width, rect.height)
        .fill({ color: (r << 16) | (g << 8) | b, alpha: a / 255 })
      app.renderer.render({ container: shape, target: layer.texture, clear: false })
      shape.destroy()
      afterDirectEdit()
    },

    setBrush(options: BrushOptions) {
      const size = options.size ?? 8
      const [r, g, b, a] = options.color ?? [255, 0, 0, 255]
      manager.brushEngine.setPreset({
        ...DEFAULT_PRESETS[0],
        id: 'harness',
        name: 'Harness brush',
        size,
        minSize: size,
        maxSize: size,
        opacity: options.opacity ?? 1,
        hardness: options.hardness ?? 1,
        spacing: options.spacing ?? 0.1,
        smoothing: 0,
        pressureSizeEnabled: options.pressureSize ?? false,
        pressureOpacityEnabled: options.pressureOpacity ?? false,
        isEraser: false,
        scatter: 0,
        rotationJitter: 0,
        usesSmudge: false,
        pressureCurve: undefined,
      })
      manager.brushEngine.setColor({ r: r / 255, g: g / 255, b: b / 255, a: a / 255 })
    },

    setTool: (tool) => manager.setActiveTool(tool),
    stroke,
    tap: (x, y, options) => stroke([{ x, y }], options),

    async selectRect(rect: Rect) {
      manager.setActiveTool('selection')
      manager.setSelectionSubTool('rectangle')
      manager.setSelectionMode('replace')
      await stroke([
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        { x: rect.x + rect.width, y: rect.y + rect.height },
      ])
    },

    selection() {
      const selection = manager.selectionController.manager
      return { active: selection.hasSelection(), bounds: selection.getBounds() }
    },

    undo: () => manager.performUndo(),
    redo: () => manager.performRedo(),

    reopen() {
      const saved = manager.getLayerInfos().map((info) => {
        const pixels = manager.getLayerPixels(info.id)
        // AutoSave stores a copy, as IndexedDB would.
        return { info, pixels: pixels && new Uint8Array(pixels) }
      })
      manager.loadDocument(saved, manager.getActiveLayerId())
    },

    readTiles(layerId, tiles) {
      const read = manager.getLayerTiles(layerId, tiles)
      const pixels = manager.getLayerPixels(layerId)
      if (!read || !pixels) throw new Error(`harness: the tiles of ${layerId} can't be read now`)
      const whole = new Map(cutTiles(pixels, info.width, info.height, tiles).map((t) => [tileKey(t.x, t.y), t.pixels]))
      return read.map(({ x, y, pixels: tile }) => {
        const { width: w, height: h } = tileBounds(x, y, info.width, info.height)
        const cut = whole.get(tileKey(x, y))
        if (!cut) throw new Error(`harness: tile ${tileKey(x, y)} was read but not asked for`)
        return { x, y, read: encode(tile, w, h, false), whole: encode(cut, w, h, false) }
      })
    },

    takeChanges() {
      const changes: Record<string, string[] | 'all'> = {}
      for (const [id, change] of manager.takeChanges()) changes[id] = change === 'all' ? 'all' : [...change].sort()
      return changes
    },

    readLayer: (layerId) => read(layerById(layerId).texture),

    readComposite() {
      manager.compositor.invalidateCache()
      manager.recomposite()
      const output = manager.compositor.getOutputTexture()
      if (!output) throw new Error('harness: compositor has no output texture')
      return read(output)
    },

    async exportPng() {
      // Same path as App's export handler, minus the download. The test decodes
      // the file itself: decoding it here, through a 2D canvas, would round
      // semi-transparent colours once more.
      const result = manager.getCompositePixels()
      if (!result) throw new Error('harness: no composite to export')
      const blob = await exportImage(result.pixels, result.width, result.height, { format: 'png' })
      return { base64: toBase64(new Uint8Array(await blob.arrayBuffer())) }
    },
  }
}

/** Copy, optionally unpremultiply, and base64-encode RGBA8 pixels. */
function encode(src: ArrayLike<number>, w: number, h: number, premultiplied: boolean): EncodedPixels {
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < data.length; i++) data[i] = src[i]
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a === 0) {
      // Colour is undefined where nothing is painted; normalise it.
      data[i] = data[i + 1] = data[i + 2] = 0
    } else if (premultiplied && a < 255) {
      data[i] = Math.min(255, Math.round((data[i] * 255) / a))
      data[i + 1] = Math.min(255, Math.round((data[i + 1] * 255) / a))
      data[i + 2] = Math.min(255, Math.round((data[i + 2] * 255) / a))
    }
  }
  return { width: w, height: h, base64: toBase64(data) }
}

function toBase64(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i += 0x4000) {
    binary += String.fromCharCode(...data.subarray(i, i + 0x4000))
  }
  return btoa(binary)
}

/** Bit of `buttons` for a DOM `button` value (middle and secondary are swapped). */
function buttonBit(button: number): number {
  if (button === 1) return 2
  if (button === 2) return 1
  return button
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function positiveInt(value: string | null, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}
