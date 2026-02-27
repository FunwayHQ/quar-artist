import type { RGBAColor } from '../../types/color.ts'

/**
 * Flood fill (paint bucket) tool.
 * Stack-based 4-connected flood fill that writes fillColor to matching pixels.
 * Adapts the same algorithm as SelectionManager.magicWand().
 */
export class FloodFillTool {
  /**
   * Fill connected pixels matching the seed color.
   * @param seedX - Seed point X in canvas coordinates
   * @param seedY - Seed point Y in canvas coordinates
   * @param pixels - RGBA pixel data (Uint8Array, length = width * height * 4)
   * @param width - Canvas width
   * @param height - Canvas height
   * @param fillColor - Color to fill with (0-1 range)
   * @param tolerance - Color matching tolerance (0-255)
   * @param selectionMask - Optional selection mask; only fill where mask > 0
   * @returns true if any pixels were modified
   */
  fill(
    seedX: number,
    seedY: number,
    pixels: Uint8Array,
    width: number,
    height: number,
    fillColor: RGBAColor,
    tolerance: number,
    selectionMask?: Uint8Array | null,
  ): boolean {
    const sx = Math.floor(seedX)
    const sy = Math.floor(seedY)
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) return false

    // Check selection mask at seed
    if (selectionMask && selectionMask[sy * width + sx] === 0) return false

    // Seed pixel color
    const seedIdx = (sy * width + sx) * 4
    const seedR = pixels[seedIdx]
    const seedG = pixels[seedIdx + 1]
    const seedB = pixels[seedIdx + 2]
    const seedA = pixels[seedIdx + 3]

    // Fill color as 0-255
    const fillR = Math.round(fillColor.r * 255)
    const fillG = Math.round(fillColor.g * 255)
    const fillB = Math.round(fillColor.b * 255)
    const fillA = Math.round(fillColor.a * 255)

    // If seed color matches fill color exactly, no work to do
    if (seedR === fillR && seedG === fillG && seedB === fillB && seedA === fillA) {
      return false
    }

    const tol4 = tolerance * 4

    const matches = (idx: number): boolean => {
      const pi = idx * 4
      const diff =
        Math.abs(pixels[pi] - seedR) +
        Math.abs(pixels[pi + 1] - seedG) +
        Math.abs(pixels[pi + 2] - seedB) +
        Math.abs(pixels[pi + 3] - seedA)
      return diff <= tol4
    }

    const totalPixels = width * height
    const visited = new Uint8Array(totalPixels)
    const stack: number[] = [sy * width + sx]
    let modified = false

    while (stack.length > 0) {
      const idx = stack.pop()!
      if (visited[idx]) continue
      visited[idx] = 1

      if (!matches(idx)) continue

      // Check selection mask
      if (selectionMask && selectionMask[idx] === 0) continue

      // Write fill color
      const pi = idx * 4
      pixels[pi] = fillR
      pixels[pi + 1] = fillG
      pixels[pi + 2] = fillB
      pixels[pi + 3] = fillA
      modified = true

      // Push 4-connected neighbors
      const x = idx % width
      const y = Math.floor(idx / width)
      if (x > 0) stack.push(idx - 1)
      if (x < width - 1) stack.push(idx + 1)
      if (y > 0) stack.push(idx - width)
      if (y < height - 1) stack.push(idx + width)
    }

    return modified
  }
}
