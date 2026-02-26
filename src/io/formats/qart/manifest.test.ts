import { describe, it, expect } from 'vitest'
import { createManifest, validateManifest } from './manifest.ts'
import type { QartLayerManifest } from '../../../types/project.ts'

const sampleLayer: QartLayerManifest = {
  id: 'layer-1',
  name: 'Background',
  blendMode: 'normal',
  opacity: 1,
  visible: true,
  locked: false,
  alphaLock: false,
  clippingMask: false,
  order: 0,
  dataFile: 'layers/layer-1.bin',
}

describe('manifest', () => {
  describe('createManifest', () => {
    it('creates a valid manifest', () => {
      const m = createManifest(
        { width: 1920, height: 1080, dpi: 72 },
        [sampleLayer],
        'layer-1',
      )
      expect(m.version).toBe('1.0')
      expect(m.app).toBe('quar-artist')
      expect(m.canvas.width).toBe(1920)
      expect(m.canvas.height).toBe(1080)
      expect(m.canvas.dpi).toBe(72)
      expect(m.canvas.colorSpace).toBe('srgb')
      expect(m.layers).toHaveLength(1)
      expect(m.activeLayerId).toBe('layer-1')
    })

    it('sets timestamps', () => {
      const m = createManifest(
        { width: 100, height: 100, dpi: 72 },
        [],
        'x',
      )
      expect(m.createdAt).toBeTruthy()
      expect(m.updatedAt).toBeTruthy()
    })

    it('accepts custom dates', () => {
      const m = createManifest(
        { width: 100, height: 100, dpi: 72 },
        [],
        'x',
        { createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-06-01T00:00:00Z' },
      )
      expect(m.createdAt).toBe('2025-01-01T00:00:00Z')
      expect(m.updatedAt).toBe('2025-06-01T00:00:00Z')
    })
  })

  describe('validateManifest', () => {
    it('validates a correct manifest', () => {
      const m = createManifest(
        { width: 1920, height: 1080, dpi: 72 },
        [sampleLayer],
        'layer-1',
      )
      const result = validateManifest(m)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('rejects null', () => {
      const result = validateManifest(null)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Manifest is not an object')
    })

    it('rejects missing version', () => {
      const result = validateManifest({ app: 'x', canvas: { width: 1, height: 1, dpi: 72 }, layers: [], activeLayerId: 'a' })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('version'))).toBe(true)
    })

    it('rejects missing canvas', () => {
      const result = validateManifest({ version: '1.0', app: 'x', layers: [], activeLayerId: 'a' })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('canvas'))).toBe(true)
    })

    it('rejects invalid canvas dimensions', () => {
      const result = validateManifest({
        version: '1.0',
        app: 'x',
        canvas: { width: -1, height: 100, dpi: 72 },
        layers: [],
        activeLayerId: 'a',
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('width'))).toBe(true)
    })

    it('rejects missing layers array', () => {
      const result = validateManifest({
        version: '1.0',
        app: 'x',
        canvas: { width: 100, height: 100, dpi: 72 },
        activeLayerId: 'a',
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('layers'))).toBe(true)
    })

    it('rejects invalid layer entry', () => {
      const result = validateManifest({
        version: '1.0',
        app: 'x',
        canvas: { width: 100, height: 100, dpi: 72 },
        layers: [{ id: 'x' }],
        activeLayerId: 'x',
      })
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('rejects layer with invalid blendMode', () => {
      const result = validateManifest({
        version: '1.0',
        app: 'x',
        canvas: { width: 100, height: 100, dpi: 72 },
        layers: [{
          ...sampleLayer,
          blendMode: 'invalidMode',
        }],
        activeLayerId: 'layer-1',
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('blendMode'))).toBe(true)
    })

    it('rejects layer with out-of-range opacity', () => {
      const result = validateManifest({
        version: '1.0',
        app: 'x',
        canvas: { width: 100, height: 100, dpi: 72 },
        layers: [{
          ...sampleLayer,
          opacity: 1.5,
        }],
        activeLayerId: 'layer-1',
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('opacity'))).toBe(true)
    })

    it('rejects missing activeLayerId', () => {
      const result = validateManifest({
        version: '1.0',
        app: 'x',
        canvas: { width: 100, height: 100, dpi: 72 },
        layers: [],
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('activeLayerId'))).toBe(true)
    })

    it('validates multiple layers', () => {
      const m = createManifest(
        { width: 100, height: 100, dpi: 72 },
        [
          { ...sampleLayer, id: 'layer-1', order: 0 },
          { ...sampleLayer, id: 'layer-2', name: 'Layer 2', order: 1 },
        ],
        'layer-1',
      )
      const result = validateManifest(m)
      expect(result.valid).toBe(true)
    })
  })
})
