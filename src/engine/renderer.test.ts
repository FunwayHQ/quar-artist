import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRenderer, getBackend } from './renderer.ts'

// Mock pixi.js — PixiJS can't run in jsdom (no WebGL/WebGPU)
const mockInit = vi.fn().mockResolvedValue(undefined)
const mockDestroy = vi.fn()

vi.mock('pixi.js', () => {
  class MockApplication {
    init = mockInit
    renderer = { type: 0x01, resize: vi.fn() }
    stage = {
      position: { set: vi.fn() },
      scale: { set: vi.fn() },
      rotation: 0,
    }
    destroy = mockDestroy
  }
  return { Application: MockApplication }
})

describe('renderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('createRenderer returns a PixiJS Application', async () => {
    const canvas = document.createElement('canvas')
    const app = await createRenderer(canvas)
    expect(app).toBeDefined()
    expect(app.init).toHaveBeenCalled()
  })

  it('calls app.init with the provided canvas', async () => {
    const canvas = document.createElement('canvas')
    const app = await createRenderer(canvas)
    expect(app.init).toHaveBeenCalledWith(
      expect.objectContaining({ canvas }),
    )
  })

  it('sets backgroundAlpha to 0 (transparent)', async () => {
    const canvas = document.createElement('canvas')
    const app = await createRenderer(canvas)
    expect(app.init).toHaveBeenCalledWith(
      expect.objectContaining({ backgroundAlpha: 0 }),
    )
  })

  it('detects backend type and sets it via getBackend', async () => {
    const canvas = document.createElement('canvas')
    await createRenderer(canvas)
    // Mock returns type 0x01 = webgl
    const backend = getBackend()
    expect(backend).toBe('webgl2')
  })

  it('uses webgl preference when navigator.gpu is absent', async () => {
    const canvas = document.createElement('canvas')
    const app = await createRenderer(canvas)
    expect(app.init).toHaveBeenCalledWith(
      expect.objectContaining({ preference: 'webgl' }),
    )
  })
})
