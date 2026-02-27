import { describe, it, expect } from 'vitest'
import { cpuUnsharpMask } from './sharpenFilter.ts'

describe('sharpenFilter (CPU unsharp mask)', () => {
  it('returns same-length output', () => {
    const original = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255])
    const blurred = new Uint8Array([200, 50, 50, 255, 50, 200, 50, 255])
    const result = cpuUnsharpMask(original, blurred, 100, 0)
    expect(result).toHaveLength(original.length)
  })

  it('identity when amount is 0', () => {
    const original = new Uint8Array([100, 150, 200, 255])
    const blurred = new Uint8Array([80, 130, 180, 255])
    const result = cpuUnsharpMask(original, blurred, 0, 0)
    // With amount=0, result should equal original
    expect(result[0]).toBe(100)
    expect(result[1]).toBe(150)
    expect(result[2]).toBe(200)
    expect(result[3]).toBe(255)
  })

  it('sharpens by amplifying difference from blurred', () => {
    const original = new Uint8Array([200, 200, 200, 255])
    const blurred = new Uint8Array([150, 150, 150, 255])
    // amount=100 => amt=1.0, threshold=0
    // diff = (200-150)/255 = ~0.196, lum ~0.196 > 0
    // result = original/255 + diff * 1.0 * gate
    const result = cpuUnsharpMask(original, blurred, 100, 0)
    // Should be brighter than original (sharpened toward original, away from blur)
    expect(result[0]).toBeGreaterThan(200)
  })

  it('threshold gates low-contrast differences', () => {
    const original = new Uint8Array([100, 100, 100, 255])
    const blurred = new Uint8Array([99, 99, 99, 255])
    // Very small difference, high threshold should gate it
    const result = cpuUnsharpMask(original, blurred, 500, 128)
    // With high threshold, tiny diff should be gated out
    expect(result[0]).toBe(100) // No change
  })

  it('preserves alpha channel', () => {
    const original = new Uint8Array([200, 100, 50, 128])
    const blurred = new Uint8Array([150, 80, 30, 128])
    const result = cpuUnsharpMask(original, blurred, 100, 0)
    expect(result[3]).toBe(128) // Alpha unchanged
  })
})
