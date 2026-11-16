import { Application, RendererType, type ApplicationOptions, type WebGLRenderer } from 'pixi.js'
import type { RenderBackend } from '../types/engine.ts'

let backend: RenderBackend | null = null

export interface RendererOptions {
  /** Force a backend. By default WebGPU is tried first when the browser exposes it. */
  preference?: 'webgpu' | 'webgl'
}

/**
 * Initialize the PixiJS Application with WebGPU primary / WebGL 2.0 fallback.
 * Returns the Application instance.
 *
 * Rejects when the browser offers neither WebGPU nor WebGL 2. PixiJS would
 * otherwise fall back to its Canvas 2D renderer (or to WebGL 1), which the
 * engine doesn't support.
 *
 * Must be called once. The canvas is attached to the DOM by the caller.
 */
export async function createRenderer(canvas: HTMLCanvasElement, options: RendererOptions = {}): Promise<Application> {
  const app = new Application()

  // PixiJS v8 auto-detects WebGPU availability.
  // We try WebGPU first; if not supported, it falls back to WebGL.
  const supportsWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator
  const tryWebGPU = options.preference ? options.preference === 'webgpu' && supportsWebGPU : supportsWebGPU

  // Pre-acquire a desynchronized WebGL2 context for low-latency painting.
  // PixiJS will detect and reuse the existing context on this canvas.
  if (!tryWebGPU) {
    try {
      canvas.getContext('webgl2', {
        desynchronized: true,
        preserveDrawingBuffer: false,
        antialias: false,
        alpha: true,
        premultipliedAlpha: true,
      })
    } catch { /* let PixiJS create its own context */ }
  }

  const initOptions: Partial<ApplicationOptions> = {
    canvas,
    backgroundAlpha: 0,
    antialias: false,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    width: canvas.clientWidth,
    height: canvas.clientHeight,
  }

  try {
    await app.init({ ...initOptions, preference: tryWebGPU ? 'webgpu' : 'webgl' })
  } catch (err) {
    // If WebGPU fails, force WebGL
    if (!tryWebGPU) throw err
    console.warn('[QUAR] WebGPU init failed, falling back to WebGL 2.0:', err)
    await app.init({ ...initOptions, preference: 'webgl' })
  }

  try {
    backend = detectBackend(app)
  } catch (err) {
    backend = null
    app.destroy()
    throw err
  }

  if (backend === 'webgpu') {
    console.log('%c[QUAR] WebGPU initialized', 'color: #f59e0b; font-weight: bold')
  } else {
    console.log('%c[QUAR] WebGL 2.0 fallback', 'color: #fbbf24; font-weight: bold')
  }
  return app
}

/** The backend PixiJS chose, or an error if the engine can't run on it. */
function detectBackend(app: Application): RenderBackend {
  const { renderer } = app
  if (renderer.type === RendererType.WEBGPU) return 'webgpu'
  if (renderer.type === RendererType.WEBGL) {
    if ((renderer as WebGLRenderer).context.webGLVersion === 2) return 'webgl2'
    throw new Error('This browser only offers WebGL 1. QUAR Artist needs WebGPU or WebGL 2.')
  }
  throw new Error('This browser offers neither WebGPU nor WebGL. QUAR Artist needs WebGPU or WebGL 2.')
}

export function getBackend(): RenderBackend | null {
  return backend
}
