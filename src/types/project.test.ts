import { describe, it, expect } from 'vitest'
import { CANVAS_PRESETS } from './project.ts'
import type { ProjectMeta, CanvasConfig, ExportOptions, QartManifest } from './project.ts'

describe('project types', () => {
  it('CANVAS_PRESETS has 6 entries', () => {
    expect(CANVAS_PRESETS).toHaveLength(6)
  })

  it('each preset has positive dimensions and dpi', () => {
    for (const p of CANVAS_PRESETS) {
      expect(p.width).toBeGreaterThan(0)
      expect(p.height).toBeGreaterThan(0)
      expect(p.dpi).toBeGreaterThan(0)
      expect(typeof p.label).toBe('string')
    }
  })

  it('includes common sizes', () => {
    const labels = CANVAS_PRESETS.map((p) => p.label)
    expect(labels.some((l) => l.includes('1080'))).toBe(true)
    expect(labels.some((l) => l.includes('A4'))).toBe(true)
  })

  it('ProjectMeta type is structurally valid', () => {
    const meta: ProjectMeta = {
      name: 'Test',
      width: 1920,
      height: 1080,
      dpi: 72,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    expect(meta.name).toBe('Test')
    expect(meta.id).toBeUndefined()
  })

  it('CanvasConfig has required fields', () => {
    const config: CanvasConfig = {
      name: 'New Project',
      width: 2048,
      height: 2048,
      dpi: 150,
    }
    expect(config.width).toBe(2048)
  })

  it('ExportOptions has format and jpegQuality', () => {
    const opts: ExportOptions = { format: 'jpeg', jpegQuality: 0.85 }
    expect(opts.format).toBe('jpeg')
    expect(opts.jpegQuality).toBe(0.85)
  })
})
