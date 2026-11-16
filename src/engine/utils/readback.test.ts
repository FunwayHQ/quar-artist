import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('pixi.js', () => {
  class BufferImageSource {
    options: Record<string, unknown>
    constructor(options: Record<string, unknown>) { this.options = options }
  }
  class Rectangle {
    x: number
    y: number
    width: number
    height: number
    constructor(x: number, y: number, width: number, height: number) {
      this.x = x
      this.y = y
      this.width = width
      this.height = height
    }
  }
  class Texture {
    source: BufferImageSource
    frame: Rectangle | undefined
    destroy = vi.fn()
    constructor({ source, frame }: { source: BufferImageSource; frame?: Rectangle }) {
      this.source = source
      this.frame = frame
    }
  }
  class Sprite {
    texture: Texture
    destroy = vi.fn()
    constructor(texture: Texture) { this.texture = texture }
  }
  return { RendererType: { WEBGL: 1, WEBGPU: 2, CANVAS: 4 }, BufferImageSource, Rectangle, Texture, Sprite }
})

import { Texture, type Renderer, type RenderTexture } from 'pixi.js'
import { premultiply, readPixels, readRegions, unpremultiply, writePixels } from './readback.ts'

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

describe('readRegions (plan M1.3)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reads each rectangle on WebGL through a view of the layer, then lets the view go', () => {
    const getPixels = vi.fn((_view: Texture) => ({ pixels: new Uint8ClampedArray([128, 0, 0, 128]), width: 1, height: 1 }))
    const renderer = { type: 1, texture: { getPixels } }
    const layer = new Texture({ source: { id: 'layer' } as never })

    const read = readRegions(renderer as never, layer, [
      { x: 256, y: 0, width: 1, height: 1 },
      { x: 0, y: 512, width: 1, height: 1 },
    ])

    // Straight alpha, as from readPixels.
    expect(read.map((pixels) => [...pixels])).toEqual([[255, 0, 0, 128], [255, 0, 0, 128]])
    const views = getPixels.mock.calls.map(([view]) => view)
    expect(views.map((v) => v.source)).toEqual([layer.source, layer.source])
    expect(views.map((v) => ({ ...v.frame }))).toEqual([
      { x: 256, y: 0, width: 1, height: 1 },
      { x: 0, y: 512, width: 1, height: 1 },
    ])
    // Without the layer's texture source, which stays.
    expect(views.map((v) => vi.mocked(v.destroy).mock.calls)).toEqual([[[false]], [[false]]])
  })

  it('copies just the rectangle on WebGPU, through canvases made for reading', () => {
    vi.stubGlobal('GPUTextureUsage', { COPY_SRC: 1, COPY_DST: 2 })
    const configure = vi.fn()
    const unconfigure = vi.fn()
    const current = { id: 'canvas texture' }
    const webgpu = { configure, unconfigure, getCurrentTexture: () => current }
    const canvas2d = { width: 0, height: 0 }
    const getImageData = vi.fn((_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(9) }))
    const context2d = { canvas: canvas2d, clearRect: vi.fn(), drawImage: vi.fn(), getImageData }
    const contextOptions: unknown[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, kind: string, options?: unknown) {
      if (kind === '2d') {
        contextOptions.push(options)
        return context2d as never
      }
      return webgpu as never
    })
    const copyTextureToTexture = vi.fn()
    const submit = vi.fn()
    const device = {
      createCommandEncoder: () => ({ copyTextureToTexture, finish: () => 'commands' }),
      queue: { submit },
    }
    const gpuSource = { format: 'bgra8unorm' }
    const renderer = { type: 2, gpu: { device }, texture: { getGpuSource: () => gpuSource } }

    const [pixels] = readRegions(renderer as never, new Texture({ source: {} as never }), [{ x: 512, y: 256, width: 3, height: 2 }])

    expect(pixels).toHaveLength(3 * 2 * 4)
    expect(contextOptions).toEqual([{ willReadFrequently: true }])
    expect(configure).toHaveBeenCalledWith(expect.objectContaining({ device, format: 'bgra8unorm', alphaMode: 'premultiplied' }))
    expect(copyTextureToTexture).toHaveBeenCalledWith(
      { texture: gpuSource, origin: { x: 512, y: 256 } },
      { texture: current },
      { width: 3, height: 2 },
    )
    expect(submit).toHaveBeenCalledWith(['commands'])
    expect(getImageData).toHaveBeenCalledWith(0, 0, 3, 2)
    expect(unconfigure).toHaveBeenCalled()
  })

  it('renders the rectangle out with PixiJS on WebGPU when no canvas takes the texture format', () => {
    const extract = vi.fn(() => ({ pixels: new Uint8ClampedArray(4), width: 1, height: 1 }))
    const renderer = { type: 2, extract: { pixels: extract }, texture: { getGpuSource: () => ({ format: 'r8unorm' }) } }
    readRegions(renderer as never, new Texture({ source: {} as never }), [{ x: 1, y: 2, width: 1, height: 1 }])
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({ frame: { x: 1, y: 2, width: 1, height: 1 }, resolution: 1 }))
  })
})
