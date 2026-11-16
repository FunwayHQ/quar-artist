import { describe, it, expect, vi } from 'vitest'

vi.mock('pixi.js', () => {
  class BufferImageSource {
    options: Record<string, unknown>
    constructor(options: Record<string, unknown>) { this.options = options }
  }
  class Texture {
    source: BufferImageSource
    destroy = vi.fn()
    constructor({ source }: { source: BufferImageSource }) { this.source = source }
  }
  class Sprite {
    texture: Texture
    destroy = vi.fn()
    constructor(texture: Texture) { this.texture = texture }
  }
  return { RendererType: { WEBGL: 1, WEBGPU: 2, CANVAS: 4 }, BufferImageSource, Texture, Sprite }
})

import type { Renderer, RenderTexture } from 'pixi.js'
import { premultiply, readPixels, unpremultiply, writePixels } from './readback.ts'

describe('unpremultiply', () => {
  it('restores straight colour from premultiplied pixels', () => {
    // 50% red, 25% blue and fully opaque green, stored premultiplied
    const data = new Uint8ClampedArray([128, 0, 0, 128, 0, 0, 64, 64, 0, 200, 0, 255])
    unpremultiply(data)
    expect([...data]).toEqual([255, 0, 0, 128, 0, 0, 255, 64, 0, 200, 0, 255])
  })

  it('clears the colour of fully transparent pixels', () => {
    const data = new Uint8ClampedArray([12, 34, 56, 0])
    unpremultiply(data)
    expect([...data]).toEqual([0, 0, 0, 0])
  })

  it('round-trips a semi-transparent colour to within 1 per channel', () => {
    const straight = [40, 60, 220]
    const alpha = 128
    const data = new Uint8ClampedArray([...straight.map((c) => Math.round((c * alpha) / 255)), alpha])
    unpremultiply(data)
    for (let i = 0; i < 3; i++) expect(Math.abs(data[i] - straight[i])).toBeLessThanOrEqual(1)
  })
})

describe('readPixels', () => {
  const fakeRenderer = (type: number, pixels: number[]) => ({
    type,
    extract: { pixels: vi.fn(() => ({ pixels: new Uint8ClampedArray(pixels), width: 1, height: 1 })) },
  })

  it('returns straight alpha from WebGL, whose readback is premultiplied', () => {
    const renderer = fakeRenderer(1, [128, 0, 0, 128])
    const result = readPixels(renderer as never, {} as never)
    expect([...result.pixels]).toEqual([255, 0, 0, 128])
    expect(result).toMatchObject({ width: 1, height: 1 })
  })

  it('leaves WebGPU readback alone, which is already straight', () => {
    const renderer = fakeRenderer(2, [255, 0, 0, 128])
    expect([...readPixels(renderer as never, {} as never).pixels]).toEqual([255, 0, 0, 128])
  })
})

describe('premultiply', () => {
  it('scales colour by alpha, rounding to nearest', () => {
    const data = new Uint8Array([255, 0, 0, 128, 31, 31, 31, 50, 10, 20, 30, 255, 99, 99, 99, 0])
    expect([...premultiply(data)]).toEqual([128, 0, 0, 128, 6, 6, 6, 50, 10, 20, 30, 255, 0, 0, 0, 0])
  })

  it('makes a read and write round trip stable for every colour and alpha', () => {
    // A layer read back (unpremultiplied) and written again (premultiplied)
    // must not change: saving and reopening a project repeats this each time.
    for (let a = 1; a < 255; a++) {
      for (let p = 0; p <= a; p++) {
        const stored = new Uint8ClampedArray([p, p, p, a])
        unpremultiply(stored)
        const written = premultiply(stored)
        if (written[0] !== p) throw new Error(`premultiplied ${p} at alpha ${a} came back as ${written[0]}`)
      }
    }
  })
})

describe('writePixels', () => {
  it('uploads premultiplied RGBA8 and replaces the target', () => {
    const render = vi.fn()
    const renderer = { render } as unknown as Renderer
    const target = {} as RenderTexture

    writePixels(renderer, target, new Uint8ClampedArray([200, 100, 50, 128, 1, 2, 3, 4]), 2, 1)

    expect(render).toHaveBeenCalledTimes(1)
    const [{ container, target: renderedTo, clear }] = render.mock.calls[0]
    expect(renderedTo).toBe(target)
    expect(clear).toBe(true)
    const { options } = container.texture.source
    expect(options).toMatchObject({ width: 2, height: 1, format: 'rgba8unorm', alphaMode: 'premultiplied-alpha' })
    expect([...(options.resource as Uint8Array)]).toEqual([100, 50, 25, 128, 0, 0, 0, 4])
    expect(container.destroy).toHaveBeenCalled()
    expect(container.texture.destroy).toHaveBeenCalledWith(true)
  })
})

