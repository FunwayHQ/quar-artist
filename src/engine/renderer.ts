import { Application } from 'pixi.js'
import type { RenderBackend } from '../types/engine.ts'

let backend: RenderBackend | null = null

/**
 * Initialize the PixiJS Application with WebGPU primary / WebGL 2.0 fallback.
 * Returns the Application instance.
 *
 * Must be called once. The canvas is attached to the DOM by the caller.
 */
export async function createRenderer(canvas: HTMLCanvasElement): Promise<Application> {
  const app = new Application()

  // PixiJS v8 auto-detects WebGPU availability.
  // We try WebGPU first; if not supported, it falls back to WebGL.
  const supportsWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator

  // Pre-acquire a desynchronized WebGL2 context for low-latency painting.
  // PixiJS will detect and reuse the existing context on this canvas.
  if (!supportsWebGPU) {
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

  try {
    await app.init({
      canvas,
      backgroundAlpha: 0,
      antialias: false,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      preference: supportsWebGPU ? 'webgpu' : 'webgl',
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    })

    // Detect which backend PixiJS actually chose
    const rendererType = app.renderer.type
    // PixiJS v8: renderer.type is a number enum — 0x01 = WebGL, 0x02 = WebGPU
    if (rendererType === 0x02) {
      backend = 'webgpu'
      console.log('%c[QUAR] WebGPU initialized', 'color: #f59e0b; font-weight: bold')
    } else {
      backend = 'webgl2'
      console.log('%c[QUAR] WebGL 2.0 fallback', 'color: #fbbf24; font-weight: bold')
    }
  } catch (err) {
    // If WebGPU fails, force WebGL
    if (supportsWebGPU) {
      console.warn('[QUAR] WebGPU init failed, falling back to WebGL 2.0:', err)
      await app.init({
        canvas,
        backgroundAlpha: 0,
        antialias: false,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
        preference: 'webgl',
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      })
      backend = 'webgl2'
      console.log('%c[QUAR] WebGL 2.0 fallback (after WebGPU failure)', 'color: #fbbf24')
    } else {
      throw err
    }
  }

  return app
}

export function getBackend(): RenderBackend | null {
  return backend
}
