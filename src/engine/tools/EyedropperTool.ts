import type { RGBAColor } from '../../types/color.ts'

/**
 * Eyedropper (color picker) tool.
 * Samples pixel color from composited output.
 */
export class EyedropperTool {
  /**
   * Sample a pixel color at the given coordinates.
   * @param x - X coordinate in canvas space
   * @param y - Y coordinate in canvas space
   * @param pixels - Composited RGBA pixel data
   * @param width - Canvas width
   * @param height - Canvas height
   * @returns RGBAColor in 0-1 range, or null if out of bounds
   */
  sample(
    x: number,
    y: number,
    pixels: Uint8Array,
    width: number,
    height: number,
  ): RGBAColor | null {
    const px = Math.floor(x)
    const py = Math.floor(y)
    if (px < 0 || py < 0 || px >= width || py >= height) return null

    const idx = (py * width + px) * 4
    if (idx + 3 >= pixels.length) return null

    return {
      r: pixels[idx] / 255,
      g: pixels[idx + 1] / 255,
      b: pixels[idx + 2] / 255,
      a: pixels[idx + 3] / 255,
    }
  }
}
