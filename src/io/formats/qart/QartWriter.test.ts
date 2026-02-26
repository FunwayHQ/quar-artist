import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { writeQart, type QartWriterInput } from './QartWriter.ts'
import type { QartManifest } from '../../../types/project.ts'

function createInput(overrides: Partial<QartWriterInput> = {}): QartWriterInput {
  return {
    name: 'Test Project',
    width: 100,
    height: 100,
    dpi: 72,
    activeLayerId: 'layer-1',
    layers: [{
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
      order: 0,
      pixels: new Uint8Array([10, 20, 30, 40]),
    }],
    ...overrides,
  }
}

describe('QartWriter', () => {
  it('produces a valid Blob', async () => {
    const blob = await writeQart(createInput())
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(0)
  })

  it('produces a ZIP with manifest.json', async () => {
    const blob = await writeQart(createInput())
    const zip = await JSZip.loadAsync(blob)
    expect(zip.file('manifest.json')).not.toBeNull()
  })

  it('manifest has correct canvas size', async () => {
    const blob = await writeQart(createInput({ width: 1920, height: 1080, dpi: 300 }))
    const zip = await JSZip.loadAsync(blob)
    const manifest: QartManifest = JSON.parse(await zip.file('manifest.json')!.async('text'))
    expect(manifest.canvas.width).toBe(1920)
    expect(manifest.canvas.height).toBe(1080)
    expect(manifest.canvas.dpi).toBe(300)
  })

  it('manifest has correct app and version', async () => {
    const blob = await writeQart(createInput())
    const zip = await JSZip.loadAsync(blob)
    const manifest: QartManifest = JSON.parse(await zip.file('manifest.json')!.async('text'))
    expect(manifest.app).toBe('quar-artist')
    expect(manifest.version).toBe('1.0')
  })

  it('includes layer data files', async () => {
    const blob = await writeQart(createInput())
    const zip = await JSZip.loadAsync(blob)
    expect(zip.file('layers/layer-1.bin')).not.toBeNull()
  })

  it('layer data matches input pixels', async () => {
    const blob = await writeQart(createInput())
    const zip = await JSZip.loadAsync(blob)
    const data = new Uint8Array(await zip.file('layers/layer-1.bin')!.async('arraybuffer'))
    expect(data).toEqual(new Uint8Array([10, 20, 30, 40]))
  })

  it('manifest layers reference correct data files', async () => {
    const blob = await writeQart(createInput())
    const zip = await JSZip.loadAsync(blob)
    const manifest: QartManifest = JSON.parse(await zip.file('manifest.json')!.async('text'))
    expect(manifest.layers).toHaveLength(1)
    expect(manifest.layers[0].dataFile).toBe('layers/layer-1.bin')
  })

  it('preserves layer properties', async () => {
    const blob = await writeQart(createInput({
      layers: [{
        info: {
          id: 'layer-2',
          name: 'Sketch',
          visible: false,
          opacity: 0.7,
          blendMode: 'multiply',
          alphaLock: true,
          clippingMask: false,
          locked: true,
        },
        order: 1,
        pixels: new Uint8Array(4),
      }],
    }))
    const zip = await JSZip.loadAsync(blob)
    const manifest: QartManifest = JSON.parse(await zip.file('manifest.json')!.async('text'))
    const layer = manifest.layers[0]
    expect(layer.name).toBe('Sketch')
    expect(layer.visible).toBe(false)
    expect(layer.opacity).toBe(0.7)
    expect(layer.blendMode).toBe('multiply')
    expect(layer.alphaLock).toBe(true)
    expect(layer.locked).toBe(true)
  })

  it('handles multiple layers', async () => {
    const blob = await writeQart(createInput({
      layers: [
        {
          info: { id: 'l1', name: 'BG', visible: true, opacity: 1, blendMode: 'normal', alphaLock: false, clippingMask: false, locked: false },
          order: 0,
          pixels: new Uint8Array([1, 2, 3, 4]),
        },
        {
          info: { id: 'l2', name: 'Lines', visible: true, opacity: 1, blendMode: 'normal', alphaLock: false, clippingMask: false, locked: false },
          order: 1,
          pixels: new Uint8Array([5, 6, 7, 8]),
        },
      ],
    }))
    const zip = await JSZip.loadAsync(blob)
    const manifest: QartManifest = JSON.parse(await zip.file('manifest.json')!.async('text'))
    expect(manifest.layers).toHaveLength(2)
    expect(zip.file('layers/l1.bin')).not.toBeNull()
    expect(zip.file('layers/l2.bin')).not.toBeNull()
  })

  it('sets custom dates when provided', async () => {
    const blob = await writeQart(createInput({
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-06-01T00:00:00Z',
    }))
    const zip = await JSZip.loadAsync(blob)
    const manifest: QartManifest = JSON.parse(await zip.file('manifest.json')!.async('text'))
    expect(manifest.createdAt).toBe('2025-01-01T00:00:00Z')
    expect(manifest.updatedAt).toBe('2025-06-01T00:00:00Z')
  })
})
