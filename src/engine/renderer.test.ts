import { describe, it, expect, vi, beforeEach } from 'vitest'

const pixi = vi.hoisted(() => {
  const RendererType = { WEBGL: 1, WEBGPU: 2, CANVAS: 4 } as const
  /** What the next Application.init() produces, per requested preference. */
  const outcome: { webgpu: unknown; webgl: unknown } = { webgpu: null, webgl: null }
  class FakeApplication {
    static instances: FakeApplication[] = []
    renderer: unknown = null
    init = vi.fn(async ({ preference }: { preference: 'webgpu' | 'webgl' }) => {
      const result = outcome[preference]
      if (result instanceof Error) throw result
      this.renderer = result
    })
    destroy = vi.fn()
    constructor() {
      FakeApplication.instances.push(this)
    }
  }
  return { RendererType, outcome, FakeApplication }
})

vi.mock('pixi.js', () => ({ Application: pixi.FakeApplication, RendererType: pixi.RendererType }))

import { createRenderer, getBackend } from './renderer.ts'

const webgpu = { type: pixi.RendererType.WEBGPU }
const webgl = (version: 1 | 2) => ({ type: pixi.RendererType.WEBGL, context: { webGLVersion: version } })
const canvas2d = { type: pixi.RendererType.CANVAS }

function setWebGPU(available: boolean) {
  if (available) Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true })
  else delete (navigator as { gpu?: unknown }).gpu
}

describe('createRenderer', () => {
  beforeEach(() => {
    pixi.FakeApplication.instances = []
    pixi.outcome.webgpu = null
    pixi.outcome.webgl = null
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    setWebGPU(false)
  })

  it('initialises PixiJS on the given canvas with a transparent background', async () => {
    pixi.outcome.webgl = webgl(2)
    const canvas = document.createElement('canvas')
    const app = await createRenderer(canvas)
    expect(app).toBe(pixi.FakeApplication.instances[0])
    expect(app.init).toHaveBeenCalledWith(
      expect.objectContaining({ canvas, backgroundAlpha: 0, preference: 'webgl', useBackBuffer: true }),
    )
  })

  it('uses WebGPU when the browser offers it', async () => {
    setWebGPU(true)
    pixi.outcome.webgpu = webgpu
    await createRenderer(document.createElement('canvas'))
    expect(getBackend()).toBe('webgpu')
  })

  it('uses WebGL 2 when there is no WebGPU', async () => {
    pixi.outcome.webgl = webgl(2)
    await createRenderer(document.createElement('canvas'))
    expect(getBackend()).toBe('webgl2')
  })

  it('falls back to WebGL 2 when WebGPU fails to start', async () => {
    setWebGPU(true)
    pixi.outcome.webgpu = new Error('no adapter')
    pixi.outcome.webgl = webgl(2)
    await createRenderer(document.createElement('canvas'))
    expect(getBackend()).toBe('webgl2')
  })

  it('honours a forced preference', async () => {
    setWebGPU(true)
    pixi.outcome.webgpu = webgpu
    pixi.outcome.webgl = webgl(2)
    await createRenderer(document.createElement('canvas'), { preference: 'webgl' })
    expect(getBackend()).toBe('webgl2')
  })

  it("rejects PixiJS's Canvas 2D fallback and releases it", async () => {
    pixi.outcome.webgl = canvas2d
    await expect(createRenderer(document.createElement('canvas'))).rejects.toThrow('needs WebGPU or WebGL 2')
    expect(pixi.FakeApplication.instances[0].destroy).toHaveBeenCalled()
    expect(getBackend()).toBeNull()
  })

  it('rejects WebGL 1', async () => {
    pixi.outcome.webgl = webgl(1)
    await expect(createRenderer(document.createElement('canvas'))).rejects.toThrow('only offers WebGL 1')
  })
})
