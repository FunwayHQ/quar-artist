import { describe, it, expect } from 'vitest'
import { getContentBounds } from './contentBounds.ts'

describe('getContentBounds', () => {
  it('returns null for fully transparent pixels', () => {
    const pixels = new Uint8Array(10 * 10 * 4) // all zeros
    expect(getContentBounds(pixels, 10, 10)).toBeNull()
  })

  it('returns full bounds for fully opaque pixels', () => {
    const w = 4
    const h = 3
    const pixels = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      pixels[i * 4 + 3] = 255
    }
    expect(getContentBounds(pixels, w, h)).toEqual({ x: 0, y: 0, width: 4, height: 3 })
  })

  it('finds tightest bounds for a single pixel', () => {
    const w = 10
    const h = 10
    const pixels = new Uint8Array(w * h * 4)
    // Set pixel at (5, 3) to opaque
    const idx = (3 * w + 5) * 4
    pixels[idx + 3] = 128
    expect(getContentBounds(pixels, w, h)).toEqual({ x: 5, y: 3, width: 1, height: 1 })
  })

  it('finds bounds for a region of non-transparent pixels', () => {
    const w = 10
    const h = 10
    const pixels = new Uint8Array(w * h * 4)
    // Fill a 3x2 region at (2, 4)
    for (let y = 4; y <= 5; y++) {
      for (let x = 2; x <= 4; x++) {
        pixels[(y * w + x) * 4 + 3] = 200
      }
    }
    expect(getContentBounds(pixels, w, h)).toEqual({ x: 2, y: 4, width: 3, height: 2 })
  })

  it('handles alpha = 1 as non-transparent', () => {
    const w = 5
    const h = 5
    const pixels = new Uint8Array(w * h * 4)
    pixels[(2 * w + 3) * 4 + 3] = 1 // barely visible
    expect(getContentBounds(pixels, w, h)).toEqual({ x: 3, y: 2, width: 1, height: 1 })
  })
})
