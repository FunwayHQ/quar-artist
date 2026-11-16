import {
  BufferImageSource,
  RendererType,
  Sprite,
  Texture,
  type Container,
  type Renderer,
  type RenderTexture,
} from 'pixi.js'

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
  const { pixels, width, height } = renderer.extract.pixels({ target })
  if (renderer.type === RendererType.WEBGL) unpremultiply(pixels)
  return { pixels, width, height }
}

/** Convert premultiplied RGBA8 to straight alpha in place. Fully transparent pixels become 0, 0, 0, 0. */
export function unpremultiply(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a === 255) continue
    if (a === 0) {
      data[i] = 0
      data[i + 1] = 0
      data[i + 2] = 0
      continue
    }
    // Uint8ClampedArray rounds and clamps on assignment.
    const scale = 255 / a
    data[i] = data[i] * scale
    data[i + 1] = data[i + 1] * scale
    data[i + 2] = data[i + 2] * scale
  }
}

/** Premultiply straight-alpha RGBA8, rounding to nearest (the inverse of `unpremultiply`). */
export function premultiply(src: ArrayLike<number>, length = src.length): Uint8Array {
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i += 4) {
    const a = src[i + 3]
    out[i + 3] = a
    if (a === 0) continue
    if (a === 255) {
      out[i] = src[i]
      out[i + 1] = src[i + 1]
      out[i + 2] = src[i + 2]
      continue
    }
    out[i] = Math.round((src[i] * a) / 255)
    out[i + 1] = Math.round((src[i + 1] * a) / 255)
    out[i + 2] = Math.round((src[i + 2] * a) / 255)
  }
  return out
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
