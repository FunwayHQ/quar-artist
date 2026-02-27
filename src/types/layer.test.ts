import { describe, it, expect } from 'vitest'
import {
  ALL_BLEND_MODES,
  BLEND_MODE_LABELS,
  BLEND_MODE_GROUPS,
  MAX_LAYERS,
} from './layer.ts'

describe('layer types', () => {
  it('has 26 blend modes', () => {
    expect(ALL_BLEND_MODES).toHaveLength(26)
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
    // New modes
    expect(ALL_BLEND_MODES).toContain('darken')
    expect(ALL_BLEND_MODES).toContain('lighten')
    expect(ALL_BLEND_MODES).toContain('colorDodge')
    expect(ALL_BLEND_MODES).toContain('colorBurn')
    expect(ALL_BLEND_MODES).toContain('hardLight')
    expect(ALL_BLEND_MODES).toContain('difference')
    expect(ALL_BLEND_MODES).toContain('exclusion')
    expect(ALL_BLEND_MODES).toContain('hue')
    expect(ALL_BLEND_MODES).toContain('saturation')
    expect(ALL_BLEND_MODES).toContain('vividLight')
    expect(ALL_BLEND_MODES).toContain('linearLight')
    expect(ALL_BLEND_MODES).toContain('pinLight')
    expect(ALL_BLEND_MODES).toContain('hardMix')
    expect(ALL_BLEND_MODES).toContain('subtract')
    expect(ALL_BLEND_MODES).toContain('divide')
    expect(ALL_BLEND_MODES).toContain('darkerColor')
    expect(ALL_BLEND_MODES).toContain('lighterColor')
    expect(ALL_BLEND_MODES).toContain('dissolve')
  })

  it('BLEND_MODE_GROUPS covers all modes', () => {
    const groupedModes = BLEND_MODE_GROUPS.flatMap((g) => g.modes)
    for (const mode of ALL_BLEND_MODES) {
      expect(groupedModes).toContain(mode)
    }
  })

  it('MAX_LAYERS is 20', () => {
    expect(MAX_LAYERS).toBe(20)
  })

  it('labels are human readable', () => {
    expect(BLEND_MODE_LABELS.softLight).toBe('Soft Light')
    expect(BLEND_MODE_LABELS.normal).toBe('Normal')
    expect(BLEND_MODE_LABELS.vividLight).toBe('Vivid Light')
    expect(BLEND_MODE_LABELS.colorBurn).toBe('Color Burn')
  })
})
