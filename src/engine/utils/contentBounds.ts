import type { BoundingBox } from '../../types/selection.ts'

/**
 * Scan an RGBA pixel array and find the tightest axis-aligned bounding box
 * of non-transparent pixels.
 *
 * Returns null if the layer is entirely transparent (empty).
 */
export function getContentBounds(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): BoundingBox | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 4
    for (let x = 0; x < width; x++) {
      const alpha = pixels[rowOffset + x * 4 + 3]
      if (alpha > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < 0) return null

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  }
}
