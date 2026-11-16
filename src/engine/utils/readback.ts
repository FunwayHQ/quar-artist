import {
  BufferImageSource,
  RendererType,
  Sprite,
  Texture,
  type Container,
  type Renderer,
  type RenderTexture,
} from 'pixi.js'
import { premultiply, unpremultiply } from '../../utils/alpha.ts'

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
  const { pixels, width, height } = renderer.extract.pixels({ target })
  if (renderer.type === RendererType.WEBGL) unpremultiply(pixels)
  return { pixels, width, height }
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
