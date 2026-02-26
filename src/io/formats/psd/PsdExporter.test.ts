import { describe, it, expect } from 'vitest'
import { exportPsd, type PsdExportInput } from './PsdExporter.ts'

function createTestInput(): PsdExportInput {
  return {
    width: 4,
    height: 4,
    layers: [
      {
        info: {
          id: 'layer-1',
          name: 'Background',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          alphaLock: false,
          clippingMask: false,
          locked: false,
        },
        pixels: new Uint8ClampedArray(4 * 4 * 4).fill(255),
        width: 4,
        height: 4,
      },
      {
        info: {
          id: 'layer-2',
          name: 'Sketch',
          visible: false,
          opacity: 0.5,
          blendMode: 'multiply',
          alphaLock: false,
          clippingMask: false,
          locked: false,
        },
        pixels: new Uint8ClampedArray(4 * 4 * 4).fill(128),
        width: 4,
        height: 4,
      },
    ],
  }
}

describe('PsdExporter', () => {
  it('produces a Blob', () => {
    const blob = exportPsd(createTestInput())
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(0)
  })

  it('produces a valid PSD binary (starts with 8BPS signature)', async () => {
    const blob = exportPsd(createTestInput())
    const buffer = await blob.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    // PSD files start with "8BPS" (0x38 0x42 0x50 0x53)
    expect(bytes[0]).toBe(0x38) // '8'
    expect(bytes[1]).toBe(0x42) // 'B'
    expect(bytes[2]).toBe(0x50) // 'P'
    expect(bytes[3]).toBe(0x53) // 'S'
  })

  it('handles single layer', () => {
    const input: PsdExportInput = {
      width: 2,
      height: 2,
      layers: [{
        info: { id: 'l1', name: 'Only', visible: true, opacity: 1, blendMode: 'normal', alphaLock: false, clippingMask: false, locked: false },
        pixels: new Uint8ClampedArray(2 * 2 * 4).fill(100),
        width: 2,
        height: 2,
      }],
    }
    const blob = exportPsd(input)
    expect(blob.size).toBeGreaterThan(0)
  })

  it('handles empty layer pixels', () => {
    const input: PsdExportInput = {
      width: 1,
      height: 1,
      layers: [{
        info: { id: 'l1', name: 'Empty', visible: true, opacity: 1, blendMode: 'normal', alphaLock: false, clippingMask: false, locked: false },
        pixels: new Uint8ClampedArray(4), // 1x1 pixel
        width: 1,
        height: 1,
      }],
    }
    const blob = exportPsd(input)
    expect(blob.size).toBeGreaterThan(0)
  })

  it('exports multiple layers', () => {
    const blob = exportPsd(createTestInput())
    // Multi-layer PSD should be larger than single-layer
    const singleLayer = exportPsd({
      width: 4,
      height: 4,
      layers: [createTestInput().layers[0]],
    })
    expect(blob.size).toBeGreaterThan(singleLayer.size)
  })
})
