import {
  BufferImageSource,
  Container,
  Rectangle,
  RendererType,
  Sprite,
  Texture,
  type Renderer,
  type RenderTexture,
  type WebGPURenderer,
} from 'pixi.js'
import { premultiply, unpremultiply } from '../../utils/alpha.ts'
import { get2dContext } from '../../utils/canvas2d.ts'
import { TILE_SIZE } from '../../utils/tiles.ts'

// The conversions live in utils/alpha.ts, which workers can use without PixiJS.
export { premultiply, unpremultiply }

export interface PixelReadback {
  /** RGBA8 with straight (not premultiplied) alpha, top row first. */
  pixels: Uint8ClampedArray
  width: number
  height: number
}

/**
 * Read a texture or container back to the CPU as straight-alpha RGBA8.
 *
 * PixiJS returns premultiplied alpha on WebGL and straight alpha on WebGPU.
 * Everything that consumes these pixels (ImageData and PNG export, undo
 * snapshots, CPU blending, fill and wand tolerances) expects straight alpha,
 * so WebGL readbacks are converted here (F07). In 8 bits, colours with very
 * low alpha lose some precision on the way.
 */
export function readPixels(renderer: Renderer, target: Texture | Container): PixelReadback {
  if (renderer.type === RendererType.WEBGPU && target instanceof Texture) {
    // The whole texture, as PixiJS reads it there.
    const { pixelWidth: width, pixelHeight: height } = target.source
    return { pixels: readWebGpuRegion(renderer as WebGPURenderer, target, { x: 0, y: 0, width, height }), width, height }
  }
  const { pixels, width, height } = renderer.extract.pixels({ target })
  if (renderer.type === RendererType.WEBGL) unpremultiply(pixels)
  return { pixels, width, height }
}

/** A rectangle of a texture, in pixels. */
export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Read rectangles of a texture back as straight-alpha RGBA8, top row first,
 * one buffer per rectangle. Like `readPixels`, but only the parts asked for:
 * saves read back just the tiles that changed (plan M1.3).
 */
export function readRegions(renderer: Renderer, texture: Texture, rects: readonly PixelRect[]): Uint8ClampedArray[] {
  if (renderer.type === RendererType.WEBGPU) {
    return rects.map((rect) => readWebGpuRegion(renderer as WebGPURenderer, texture, rect))
  }
  return rects.map(({ x, y, width, height }) => {
    // WebGL reads a texture's frame, straight from the layer's framebuffer.
    const view = new Texture({ source: texture.source, frame: new Rectangle(x, y, width, height) })
    try {
      const { pixels } = renderer.texture.getPixels(view)
      if (renderer.type === RendererType.WEBGL) unpremultiply(pixels)
      return pixels
    } finally {
      view.destroy(false)
    }
  })
}

/** Canvas formats WebGPU can configure: a copy into the canvas needs the texture's own format. */
const CANVAS_FORMATS = new Set<GPUTextureFormat>(['bgra8unorm', 'rgba8unorm', 'rgba16float'])

/** The canvases WebGPU readbacks go through, kept for the next one. */
let readbackCanvases: { gpu: HTMLCanvasElement; context2d: CanvasRenderingContext2D } | null = null

/**
 * Read a rectangle of a texture on WebGPU, through canvases as PixiJS does
 * (F106): copy it into a WebGPU canvas of its size, draw that onto a 2D
 * canvas and read it. Unlike PixiJS, only the rectangle is copied, and the 2D
 * canvas is made for reading (`willReadFrequently`), so the read doesn't make
 * the browser copy the canvas back from the GPU each time.
 */
function readWebGpuRegion(renderer: WebGPURenderer, texture: Texture, rect: PixelRect): Uint8ClampedArray {
  const { x, y, width, height } = rect
  const source = renderer.texture.getGpuSource(texture.source)
  if (!CANVAS_FORMATS.has(source.format)) {
    // No canvas takes the texture's format: let PixiJS render the rectangle out first.
    const sprite = new Sprite(texture)
    try {
      return renderer.extract.pixels({ target: sprite, frame: new Rectangle(x, y, width, height), resolution: 1 }).pixels
    } finally {
      sprite.destroy()
    }
  }

  readbackCanvases ??= (() => {
    const read = document.createElement('canvas')
    return { gpu: document.createElement('canvas'), context2d: get2dContext(read, { willReadFrequently: true }) }
  })()
  const { gpu, context2d } = readbackCanvases
  gpu.width = width
  gpu.height = height
  const context = gpu.getContext('webgpu')
  if (!context) throw new Error('the browser could not make a canvas to read the picture back through')
  const { device } = renderer.gpu
  context.configure({
    device,
    format: source.format,
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    alphaMode: 'premultiplied',
  })
  try {
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToTexture({ texture: source, origin: { x, y } }, { texture: context.getCurrentTexture() }, { width, height })
    device.queue.submit([encoder.finish()])

    const canvas2d = context2d.canvas
    if (canvas2d.width < width || canvas2d.height < height) {
      canvas2d.width = Math.max(canvas2d.width, width)
      canvas2d.height = Math.max(canvas2d.height, height)
    }
    context2d.clearRect(0, 0, width, height)
    context2d.drawImage(gpu, 0, 0)
    return context2d.getImageData(0, 0, width, height).data
  } finally {
    context.unconfigure()
  }
}

/**
 * Replace a texture's contents with straight-alpha RGBA8 pixels: the inverse
 * of `readPixels`, for undo, filters and opening a project.
 *
 * The pixels are premultiplied here and uploaded as they are. With both
 * conversions rounding to nearest, pixels read back and written again come
 * out the same, so saving and reopening a project, or undoing, doesn't change
 * a layer. Going through a 2D canvas instead let each browser premultiply its
 * own way: Firefox rounds up, so faint colours got lighter on every round trip.
 */
export function writePixels(
  renderer: Renderer,
  target: RenderTexture,
  pixels: ArrayLike<number>,
  width: number,
  height: number,
): void {
  const source = new BufferImageSource({
    resource: premultiply(pixels, width * height * 4),
    width,
    height,
    format: 'rgba8unorm',
    alphaMode: 'premultiplied-alpha',
  })
  const texture = new Texture({ source })
  const sprite = new Sprite(texture)
  renderer.render({ container: sprite, target, clear: true })
  sprite.destroy()
  texture.destroy(true)
}

/** A tile as the tile store keeps it: premultiplied RGBA8, 256 × 256, padded past the document's edges. */
export interface PremultipliedTile {
  /** The tile's column and row. */
  x: number
  y: number
  data: Uint8Array
}

/**
 * Write saved tiles into a texture that is transparent where they go, as
 * opening a document does (plan M1.4). The bytes are uploaded as they are,
 * already premultiplied, so nothing is converted or rounded on the way:
 * drawn over transparent pixels, a tile's pixels land unchanged. Padding past
 * the texture's edges is cut off.
 */
export function writeTiles(renderer: Renderer, target: RenderTexture, tiles: readonly PremultipliedTile[]): void {
  if (tiles.length === 0) return
  const container = new Container()
  const textures: Texture[] = []
  for (const { x, y, data } of tiles) {
    const source = new BufferImageSource({
      resource: data,
      width: TILE_SIZE,
      height: TILE_SIZE,
      format: 'rgba8unorm',
      alphaMode: 'premultiplied-alpha',
      scaleMode: 'nearest',
    })
    const texture = new Texture({ source })
    textures.push(texture)
    const sprite = new Sprite(texture)
    sprite.position.set(x * TILE_SIZE, y * TILE_SIZE)
    container.addChild(sprite)
  }
  renderer.render({ container, target, clear: false })
  container.destroy({ children: true })
  for (const texture of textures) texture.destroy(true)
}
