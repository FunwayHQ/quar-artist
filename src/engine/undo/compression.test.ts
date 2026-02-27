import { describe, it, expect } from 'vitest'
import { compressSnapshot, decompressSnapshot, isCompressionAvailable } from './compression.ts'

describe('compression', () => {
  it('round-trips data correctly', async () => {
    // Simulate typical painted pixel data (lots of zeros with some painted regions)
    const original = new Uint8Array(1024)
    for (let i = 0; i < 256; i++) {
      original[i * 4] = i     // R
      original[i * 4 + 1] = 0 // G
      original[i * 4 + 2] = 0 // B
      original[i * 4 + 3] = 255 // A
    }

    const compressed = await compressSnapshot(original)
    const decompressed = await decompressSnapshot(compressed)

    expect(decompressed).toEqual(original)
  })

  it('compresses typical image data to smaller size', async () => {
    if (!isCompressionAvailable) return // Skip in environments without CompressionStream

    // Sparse data with lots of zeros (typical layer with small painted region)
    const original = new Uint8Array(16384) // 64x64 pixels
    // Paint a small 10x10 region
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const idx = (y * 64 + x) * 4
        original[idx] = 200
        original[idx + 1] = 100
        original[idx + 2] = 50
        original[idx + 3] = 255
      }
    }

    const compressed = await compressSnapshot(original)
    expect(compressed.byteLength).toBeLessThan(original.byteLength)
  })

  it('handles empty data', async () => {
    const original = new Uint8Array(0)
    const compressed = await compressSnapshot(original)
    const decompressed = await decompressSnapshot(compressed)
    expect(decompressed).toEqual(original)
  })

  it('handles all-zero data', async () => {
    const original = new Uint8Array(4096)
    const compressed = await compressSnapshot(original)
    const decompressed = await decompressSnapshot(compressed)
    expect(decompressed).toEqual(original)

    if (isCompressionAvailable) {
      // All-zero data should compress extremely well
      expect(compressed.byteLength).toBeLessThan(original.byteLength / 10)
    }
  })
})
