import type { EncodedPixels, Rect, RGBA } from '../harness/protocol.ts'

/** An RGBA8 image (straight alpha, top row first) read back from the harness. */
export class Pixels {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array

  constructor(width: number, height: number, data: Uint8Array) {
    if (data.length !== width * height * 4) {
      throw new Error(`Pixels: expected ${width * height * 4} bytes, got ${data.length}`)
    }
    this.width = width
    this.height = height
    this.data = data
  }

  static decode(encoded: EncodedPixels): Pixels {
    return new Pixels(encoded.width, encoded.height, new Uint8Array(Buffer.from(encoded.base64, 'base64')))
  }

  /** Colour at integer pixel coordinates. */
  at(x: number, y: number): RGBA {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      throw new Error(`Pixels.at(${x}, ${y}) is outside ${this.width}×${this.height}`)
    }
    const i = (y * this.width + x) * 4
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]]
  }

  /** Visit every pixel in `rect` (default: the whole image). */
  *pixels(rect?: Rect): Generator<{ x: number; y: number; color: RGBA }> {
    const x0 = Math.max(0, rect?.x ?? 0)
    const y0 = Math.max(0, rect?.y ?? 0)
    const x1 = Math.min(this.width, rect ? rect.x + rect.width : this.width)
    const y1 = Math.min(this.height, rect ? rect.y + rect.height : this.height)
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) yield { x, y, color: this.at(x, y) }
    }
  }

  /** Largest alpha value in `rect`. */
  maxAlpha(rect?: Rect): number {
    let max = 0
    for (const { color } of this.pixels(rect)) max = Math.max(max, color[3])
    return max
  }

  /** Pixels whose colour differs from `other` by more than `tolerance` on any channel. */
  diff(other: Pixels, tolerance = 0): { x: number; y: number; actual: RGBA; expected: RGBA }[] {
    if (other.width !== this.width || other.height !== this.height) {
      throw new Error(`Pixels.diff: ${this.width}×${this.height} vs ${other.width}×${other.height}`)
    }
    const out: { x: number; y: number; actual: RGBA; expected: RGBA }[] = []
    for (const { x, y, color } of this.pixels()) {
      const expected = other.at(x, y)
      if (channelDistance(color, expected) > tolerance) out.push({ x, y, actual: color, expected })
    }
    return out
  }
}

/** Largest per-channel difference between two colours. */
export function channelDistance(a: RGBA, b: RGBA): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]), Math.abs(a[3] - b[3]))
}

export function formatColor(c: RGBA): string {
  return `rgba(${c.join(', ')})`
}
