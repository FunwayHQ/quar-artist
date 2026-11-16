import { RendererType, type Container, type Renderer, type Texture } from 'pixi.js'

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
