import { describe, it, expect } from 'vitest'
import { EyedropperTool } from './EyedropperTool.ts'

describe('EyedropperTool', () => {
  const tool = new EyedropperTool()

  function makePixels(width: number, height: number): Uint8Array {
    const pixels = new Uint8Array(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      pixels[i * 4] = i * 10       // R
      pixels[i * 4 + 1] = i * 20   // G
      pixels[i * 4 + 2] = i * 30   // B
      pixels[i * 4 + 3] = 255      // A
    }
    return pixels
  }

  it('samples a pixel at the given coordinates', () => {
    const pixels = new Uint8Array([128, 64, 32, 255])
    const color = tool.sample(0, 0, pixels, 1, 1)
    expect(color).not.toBeNull()
    expect(color!.r).toBeCloseTo(128 / 255, 2)
    expect(color!.g).toBeCloseTo(64 / 255, 2)
    expect(color!.b).toBeCloseTo(32 / 255, 2)
    expect(color!.a).toBeCloseTo(1, 2)
  })

  it('samples correct pixel in multi-pixel image', () => {
    const pixels = makePixels(3, 3)
    // Pixel at (1, 1) is index 4 (row 1, col 1)
    const color = tool.sample(1, 1, pixels, 3, 3)
    expect(color).not.toBeNull()
    expect(color!.r).toBeCloseTo(40 / 255, 2) // 4 * 10
    expect(color!.g).toBeCloseTo(80 / 255, 2) // 4 * 20
  })

  it('returns null for out-of-bounds coordinates', () => {
    const pixels = new Uint8Array(16)
    expect(tool.sample(-1, 0, pixels, 2, 2)).toBeNull()
    expect(tool.sample(0, -1, pixels, 2, 2)).toBeNull()
    expect(tool.sample(2, 0, pixels, 2, 2)).toBeNull()
    expect(tool.sample(0, 2, pixels, 2, 2)).toBeNull()
  })

  it('floors fractional coordinates', () => {
    const pixels = new Uint8Array([100, 150, 200, 255, 50, 75, 100, 128])
    const color = tool.sample(0.9, 0, pixels, 2, 1)
    expect(color).not.toBeNull()
    // Should sample pixel 0, not pixel 1
    expect(color!.r).toBeCloseTo(100 / 255, 2)
  })

  it('handles transparent pixels', () => {
    const pixels = new Uint8Array([0, 0, 0, 0])
    const color = tool.sample(0, 0, pixels, 1, 1)
    expect(color).not.toBeNull()
    expect(color!.a).toBe(0)
  })
})
