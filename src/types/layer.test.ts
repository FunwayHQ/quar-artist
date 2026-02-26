import { describe, it, expect } from 'vitest'
import {
  ALL_BLEND_MODES,
  BLEND_MODE_LABELS,
  MAX_LAYERS,
} from './layer.ts'

describe('layer types', () => {
  it('has 8 blend modes', () => {
    expect(ALL_BLEND_MODES).toHaveLength(8)
  })

  it('every blend mode has a label', () => {
    for (const mode of ALL_BLEND_MODES) {
      expect(BLEND_MODE_LABELS[mode]).toBeDefined()
      expect(typeof BLEND_MODE_LABELS[mode]).toBe('string')
    }
  })

  it('blend modes include expected values', () => {
    expect(ALL_BLEND_MODES).toContain('normal')
    expect(ALL_BLEND_MODES).toContain('multiply')
    expect(ALL_BLEND_MODES).toContain('screen')
    expect(ALL_BLEND_MODES).toContain('overlay')
    expect(ALL_BLEND_MODES).toContain('softLight')
    expect(ALL_BLEND_MODES).toContain('add')
    expect(ALL_BLEND_MODES).toContain('color')
    expect(ALL_BLEND_MODES).toContain('luminosity')
  })

  it('MAX_LAYERS is 20', () => {
    expect(MAX_LAYERS).toBe(20)
  })

  it('labels are human readable', () => {
    expect(BLEND_MODE_LABELS.softLight).toBe('Soft Light')
    expect(BLEND_MODE_LABELS.normal).toBe('Normal')
  })
})
