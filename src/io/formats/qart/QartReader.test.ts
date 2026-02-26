import { describe, it, expect } from 'vitest'
import { writeQart, type QartWriterInput } from './QartWriter.ts'
import { readQart } from './QartReader.ts'
import JSZip from 'jszip'

function createInput(): QartWriterInput {
  return {
    name: 'Test',
    width: 200,
    height: 150,
    dpi: 150,
    activeLayerId: 'layer-1',
    layers: [
      {
        info: { id: 'layer-1', name: 'Background', visible: true, opacity: 1, blendMode: 'normal', alphaLock: false, clippingMask: false, locked: false },
        order: 0,
        pixels: new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]),
      },
      {
        info: { id: 'layer-2', name: 'Sketch', visible: true, opacity: 0.6, blendMode: 'multiply', alphaLock: false, clippingMask: false, locked: false },
        order: 1,
        pixels: new Uint8Array([100, 200, 150, 50]),
      },
    ],
  }
}

describe('QartReader', () => {
  it('round-trips a .qart file', async () => {
    const blob = await writeQart(createInput())
    const project = await readQart(blob)

    expect(project.manifest.canvas.width).toBe(200)
    expect(project.manifest.canvas.height).toBe(150)
    expect(project.manifest.canvas.dpi).toBe(150)
    expect(project.manifest.activeLayerId).toBe('layer-1')
  })

  it('restores all layers', async () => {
    const blob = await writeQart(createInput())
    const project = await readQart(blob)

    expect(project.layers).toHaveLength(2)
    expect(project.layers[0].manifest.id).toBe('layer-1')
    expect(project.layers[1].manifest.id).toBe('layer-2')
  })

  it('restores layer pixel data', async () => {
    const blob = await writeQart(createInput())
    const project = await readQart(blob)

    expect(project.layers[0].pixels).toEqual(new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]))
    expect(project.layers[1].pixels).toEqual(new Uint8Array([100, 200, 150, 50]))
  })

  it('restores layer properties', async () => {
    const blob = await writeQart(createInput())
    const project = await readQart(blob)

    const layer2 = project.layers[1].manifest
    expect(layer2.name).toBe('Sketch')
    expect(layer2.opacity).toBe(0.6)
    expect(layer2.blendMode).toBe('multiply')
  })

  it('throws for a file missing manifest.json', async () => {
    const zip = new JSZip()
    zip.file('random.txt', 'hello')
    const blob = await zip.generateAsync({ type: 'blob' })

    await expect(readQart(blob)).rejects.toThrow('missing manifest.json')
  })

  it('throws for invalid manifest JSON', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', 'not json{{')
    const blob = await zip.generateAsync({ type: 'blob' })

    await expect(readQart(blob)).rejects.toThrow('not valid JSON')
  })

  it('throws for invalid manifest structure', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({ invalid: true }))
    const blob = await zip.generateAsync({ type: 'blob' })

    await expect(readQart(blob)).rejects.toThrow('Invalid .qart manifest')
  })

  it('throws for missing layer data file', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({
      version: '1.0',
      app: 'quar-artist',
      canvas: { width: 100, height: 100, dpi: 72, colorSpace: 'srgb' },
      layers: [{
        id: 'layer-1',
        name: 'BG',
        blendMode: 'normal',
        opacity: 1,
        visible: true,
        locked: false,
        alphaLock: false,
        clippingMask: false,
        order: 0,
        dataFile: 'layers/missing.bin',
      }],
      activeLayerId: 'layer-1',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    }))
    const blob = await zip.generateAsync({ type: 'blob' })

    await expect(readQart(blob)).rejects.toThrow('Missing layer data file')
  })
})
