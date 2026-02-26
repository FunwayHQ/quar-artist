import type {
  SelectionMode,
  BoundingBox,
  FeatherOptions,
  SelectionChangeCallback,
  Point,
} from '../../types/selection.ts'

/**
 * Manages a per-pixel selection mask.
 * The mask is a Uint8Array where each byte represents selection intensity:
 * 0 = unselected, 255 = fully selected, 1-254 = partially selected (feathered).
 *
 * Pure CPU implementation — no PixiJS dependency.
 * The CanvasManager reads the mask for rendering marching ants and applying transforms.
 */
export class SelectionManager {
  private mask: Uint8Array
  private width: number
  private height: number
  private onChange: SelectionChangeCallback | null = null

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.mask = new Uint8Array(width * height)
  }

  setChangeCallback(cb: SelectionChangeCallback) {
    this.onChange = cb
  }

  /** Resize the selection mask (clears selection). */
  resize(width: number, height: number) {
    this.width = width
    this.height = height
    this.mask = new Uint8Array(width * height)
    this.notifyChange()
  }

  getWidth(): number {
    return this.width
  }

  getHeight(): number {
    return this.height
  }

  /** Get the raw mask data. */
  getMask(): Uint8Array {
    return this.mask
  }

  /** Get the selection value at a specific pixel. */
  getPixel(x: number, y: number): number {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return 0
    return this.mask[iy * this.width + ix]
  }

  /** Set the selection value at a specific pixel. */
  setPixel(x: number, y: number, value: number) {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return
    this.mask[iy * this.width + ix] = Math.max(0, Math.min(255, Math.round(value)))
  }

  /** Check if there's any selection. */
  hasSelection(): boolean {
    for (let i = 0; i < this.mask.length; i++) {
      if (this.mask[i] > 0) return true
    }
    return false
  }

  /** Select all pixels. */
  selectAll() {
    this.mask.fill(255)
    this.notifyChange()
  }

  /** Clear selection (deselect all). */
  clearSelection() {
    this.mask.fill(0)
    this.notifyChange()
  }

  /** Invert the selection. */
  invertSelection() {
    for (let i = 0; i < this.mask.length; i++) {
      this.mask[i] = 255 - this.mask[i]
    }
    this.notifyChange()
  }

  /**
   * Fill a rectangular region in the mask.
   * Respects the selection mode (replace/add/subtract/intersect).
   */
  fillRect(x: number, y: number, w: number, h: number, mode: SelectionMode) {
    const newMask = new Uint8Array(this.width * this.height)
    const x0 = Math.max(0, Math.floor(x))
    const y0 = Math.max(0, Math.floor(y))
    const x1 = Math.min(this.width, Math.floor(x + w))
    const y1 = Math.min(this.height, Math.floor(y + h))

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        newMask[py * this.width + px] = 255
      }
    }
    this.applyMode(newMask, mode)
    this.notifyChange()
  }

  /**
   * Fill an elliptical region in the mask.
   */
  fillEllipse(cx: number, cy: number, rx: number, ry: number, mode: SelectionMode) {
    const newMask = new Uint8Array(this.width * this.height)
    const x0 = Math.max(0, Math.floor(cx - rx))
    const y0 = Math.max(0, Math.floor(cy - ry))
    const x1 = Math.min(this.width, Math.ceil(cx + rx))
    const y1 = Math.min(this.height, Math.ceil(cy + ry))

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const dx = (px + 0.5 - cx) / rx
        const dy = (py + 0.5 - cy) / ry
        if (dx * dx + dy * dy <= 1) {
          newMask[py * this.width + px] = 255
        }
      }
    }
    this.applyMode(newMask, mode)
    this.notifyChange()
  }

  /**
   * Fill a polygon defined by a path of points.
   * Uses scanline fill algorithm.
   */
  fillPolygon(points: Point[], mode: SelectionMode) {
    if (points.length < 3) return
    const newMask = new Uint8Array(this.width * this.height)

    // Find bounding box
    let minY = this.height
    let maxY = 0
    for (const p of points) {
      minY = Math.min(minY, Math.floor(p.y))
      maxY = Math.max(maxY, Math.ceil(p.y))
    }
    minY = Math.max(0, minY)
    maxY = Math.min(this.height - 1, maxY)

    // Scanline fill
    for (let y = minY; y <= maxY; y++) {
      const intersections: number[] = []
      const scanY = y + 0.5

      for (let i = 0; i < points.length; i++) {
        const p1 = points[i]
        const p2 = points[(i + 1) % points.length]

        if ((p1.y <= scanY && p2.y > scanY) || (p2.y <= scanY && p1.y > scanY)) {
          const t = (scanY - p1.y) / (p2.y - p1.y)
          intersections.push(p1.x + t * (p2.x - p1.x))
        }
      }

      intersections.sort((a, b) => a - b)

      for (let i = 0; i < intersections.length - 1; i += 2) {
        const xStart = Math.max(0, Math.floor(intersections[i]))
        const xEnd = Math.min(this.width, Math.ceil(intersections[i + 1]))
        for (let x = xStart; x < xEnd; x++) {
          newMask[y * this.width + x] = 255
        }
      }
    }

    this.applyMode(newMask, mode)
    this.notifyChange()
  }

  /**
   * Magic wand flood fill from a seed point.
   * Takes RGBA pixel data of the layer to compare colors.
   */
  magicWand(
    seedX: number,
    seedY: number,
    pixels: Uint8Array | Uint8ClampedArray,
    tolerance: number,
    contiguous: boolean,
    mode: SelectionMode,
  ) {
    const sx = Math.floor(seedX)
    const sy = Math.floor(seedY)
    if (sx < 0 || sy < 0 || sx >= this.width || sy >= this.height) return

    const newMask = new Uint8Array(this.width * this.height)
    const seedIdx = (sy * this.width + sx) * 4
    const seedR = pixels[seedIdx]
    const seedG = pixels[seedIdx + 1]
    const seedB = pixels[seedIdx + 2]
    const seedA = pixels[seedIdx + 3]

    const matches = (idx: number): boolean => {
      const r = pixels[idx * 4]
      const g = pixels[idx * 4 + 1]
      const b = pixels[idx * 4 + 2]
      const a = pixels[idx * 4 + 3]
      const diff = Math.abs(r - seedR) + Math.abs(g - seedG) + Math.abs(b - seedB) + Math.abs(a - seedA)
      return diff <= tolerance * 4
    }

    if (contiguous) {
      // Flood fill from seed
      const visited = new Uint8Array(this.width * this.height)
      const stack: number[] = [sy * this.width + sx]

      while (stack.length > 0) {
        const idx = stack.pop()!
        if (visited[idx]) continue
        visited[idx] = 1

        if (!matches(idx)) continue
        newMask[idx] = 255

        const x = idx % this.width
        const y = Math.floor(idx / this.width)
        if (x > 0) stack.push(idx - 1)
        if (x < this.width - 1) stack.push(idx + 1)
        if (y > 0) stack.push(idx - this.width)
        if (y < this.height - 1) stack.push(idx + this.width)
      }
    } else {
      // Select all matching pixels globally
      for (let i = 0; i < this.width * this.height; i++) {
        if (matches(i)) {
          newMask[i] = 255
        }
      }
    }

    this.applyMode(newMask, mode)
    this.notifyChange()
  }

  /**
   * Apply Gaussian-like feathering to the current selection edges.
   * Uses a box blur approximation (3 passes for approximate Gaussian).
   */
  feather(options: FeatherOptions) {
    if (options.radius <= 0) return

    const r = Math.ceil(options.radius)
    // 3-pass box blur approximation of Gaussian
    for (let pass = 0; pass < 3; pass++) {
      this.boxBlurH(r)
      this.boxBlurV(r)
    }
    this.notifyChange()
  }

  /** Get the bounding box of the current selection, or null if empty. */
  getBounds(): BoundingBox | null {
    let minX = this.width
    let minY = this.height
    let maxX = 0
    let maxY = 0
    let found = false

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.mask[y * this.width + x] > 0) {
          found = true
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
    }

    if (!found) return null
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  }

  /**
   * Extract the boundary contour points for marching ants rendering.
   * Returns an array of line segments [{x1,y1,x2,y2}] at pixel edges
   * where the mask transitions from selected to unselected.
   */
  extractBoundary(): { x1: number; y1: number; x2: number; y2: number }[] {
    const segments: { x1: number; y1: number; x2: number; y2: number }[] = []
    const w = this.width
    const h = this.height
    const threshold = 128

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const selected = this.mask[y * w + x] >= threshold

        // Check right neighbor
        if (x < w - 1) {
          const rightSelected = this.mask[y * w + x + 1] >= threshold
          if (selected !== rightSelected) {
            segments.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1 })
          }
        } else if (selected) {
          // Right edge of canvas
          segments.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1 })
        }

        // Check bottom neighbor
        if (y < h - 1) {
          const bottomSelected = this.mask[(y + 1) * w + x] >= threshold
          if (selected !== bottomSelected) {
            segments.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1 })
          }
        } else if (selected) {
          // Bottom edge of canvas
          segments.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1 })
        }

        // Left edge of canvas
        if (x === 0 && selected) {
          segments.push({ x1: 0, y1: y, x2: 0, y2: y + 1 })
        }

        // Top edge of canvas
        if (y === 0 && selected) {
          segments.push({ x1: x, y1: 0, x2: x + 1, y2: 0 })
        }
      }
    }

    return segments
  }

  /** Create a snapshot of the current mask for undo. */
  snapshot(): Uint8Array {
    return new Uint8Array(this.mask)
  }

  /** Restore mask from a snapshot. */
  restoreSnapshot(data: Uint8Array) {
    if (data.length === this.mask.length) {
      this.mask.set(data)
      this.notifyChange()
    }
  }

  /**
   * Apply a new selection mask using the given mode.
   */
  private applyMode(newMask: Uint8Array, mode: SelectionMode) {
    switch (mode) {
      case 'replace':
        this.mask.set(newMask)
        break
      case 'add':
        for (let i = 0; i < this.mask.length; i++) {
          this.mask[i] = Math.min(255, this.mask[i] + newMask[i])
        }
        break
      case 'subtract':
        for (let i = 0; i < this.mask.length; i++) {
          this.mask[i] = Math.max(0, this.mask[i] - newMask[i])
        }
        break
      case 'intersect':
        for (let i = 0; i < this.mask.length; i++) {
          this.mask[i] = Math.min(this.mask[i], newMask[i])
        }
        break
    }
  }

  /** Horizontal box blur pass. */
  private boxBlurH(radius: number) {
    const w = this.width
    const h = this.height
    const out = new Uint8Array(w * h)
    const diam = radius * 2 + 1

    for (let y = 0; y < h; y++) {
      let sum = 0
      // Initialize window
      for (let x = -radius; x <= radius; x++) {
        sum += this.mask[y * w + Math.max(0, Math.min(w - 1, x))]
      }
      for (let x = 0; x < w; x++) {
        out[y * w + x] = Math.round(sum / diam)
        // Slide window
        const addX = Math.min(w - 1, x + radius + 1)
        const subX = Math.max(0, x - radius)
        sum += this.mask[y * w + addX] - this.mask[y * w + subX]
      }
    }
    this.mask.set(out)
  }

  /** Vertical box blur pass. */
  private boxBlurV(radius: number) {
    const w = this.width
    const h = this.height
    const out = new Uint8Array(w * h)
    const diam = radius * 2 + 1

    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let y = -radius; y <= radius; y++) {
        sum += this.mask[Math.max(0, Math.min(h - 1, y)) * w + x]
      }
      for (let y = 0; y < h; y++) {
        out[y * w + x] = Math.round(sum / diam)
        const addY = Math.min(h - 1, y + radius + 1)
        const subY = Math.max(0, y - radius)
        sum += this.mask[addY * w + x] - this.mask[subY * w + x]
      }
    }
    this.mask.set(out)
  }

  private notifyChange() {
    this.onChange?.(this.hasSelection(), this.getBounds())
  }
}
