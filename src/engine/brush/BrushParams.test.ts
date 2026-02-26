import { describe, it, expect } from 'vitest'
import { DEFAULT_PRESETS, getPresetById, getPresetsByCategory } from './BrushParams.ts'

describe('BrushParams', () => {
  it('has 12 default presets', () => {
    expect(DEFAULT_PRESETS).toHaveLength(12)
  })

  it('includes round-pen preset', () => {
    const pen = getPresetById('round-pen')
    expect(pen).toBeDefined()
    expect(pen!.name).toBe('Round Pen')
    expect(pen!.hardness).toBe(1)
    expect(pen!.isEraser).toBe(false)
    expect(pen!.category).toBe('draw')
  })

  it('includes pencil preset', () => {
    const pencil = getPresetById('pencil')
    expect(pencil).toBeDefined()
    expect(pencil!.name).toBe('Pencil')
    expect(pencil!.category).toBe('sketch')
    expect(pencil!.pressureOpacityEnabled).toBe(true)
  })

  it('includes ink preset', () => {
    const ink = getPresetById('ink')
    expect(ink).toBeDefined()
    expect(ink!.name).toBe('Ink')
    expect(ink!.opacity).toBe(1)
    expect(ink!.smoothing).toBe(0.6)
  })

  it('includes watercolor preset', () => {
    const wc = getPresetById('watercolor')
    expect(wc).toBeDefined()
    expect(wc!.name).toBe('Watercolor')
    expect(wc!.category).toBe('paint')
    expect(wc!.opacity).toBe(0.15)
  })

  it('includes oil preset', () => {
    const oil = getPresetById('oil')
    expect(oil).toBeDefined()
    expect(oil!.category).toBe('paint')
  })

  it('includes marker preset', () => {
    const marker = getPresetById('marker')
    expect(marker).toBeDefined()
    expect(marker!.pressureSizeEnabled).toBe(false)
  })

  it('includes airbrush preset', () => {
    const airbrush = getPresetById('soft-airbrush')
    expect(airbrush).toBeDefined()
    expect(airbrush!.name).toBe('Airbrush')
    expect(airbrush!.hardness).toBe(0)
    expect(airbrush!.opacity).toBe(0.3)
    expect(airbrush!.pressureOpacityEnabled).toBe(true)
  })

  it('includes eraser preset', () => {
    const eraser = getPresetById('hard-eraser')
    expect(eraser).toBeDefined()
    expect(eraser!.name).toBe('Eraser')
    expect(eraser!.isEraser).toBe(true)
    expect(eraser!.hardness).toBe(1)
    expect(eraser!.category).toBe('utility')
  })

  it('includes smudge preset', () => {
    const smudge = getPresetById('smudge')
    expect(smudge).toBeDefined()
    expect(smudge!.usesSmudge).toBe(true)
    expect(smudge!.category).toBe('blend')
  })

  it('returns undefined for unknown preset id', () => {
    expect(getPresetById('nonexistent')).toBeUndefined()
  })

  it('each preset has valid spacing', () => {
    for (const preset of DEFAULT_PRESETS) {
      expect(preset.spacing).toBeGreaterThan(0)
      expect(preset.spacing).toBeLessThanOrEqual(2)
    }
  })

  it('each preset has unique id', () => {
    const ids = DEFAULT_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('each preset has a category', () => {
    for (const preset of DEFAULT_PRESETS) {
      expect(['draw', 'paint', 'sketch', 'blend', 'utility']).toContain(preset.category)
    }
  })

  it('getPresetsByCategory returns correct subsets', () => {
    const drawPresets = getPresetsByCategory('draw')
    expect(drawPresets.length).toBeGreaterThan(0)
    expect(drawPresets.every((p) => p.category === 'draw')).toBe(true)
  })

  it('only the eraser preset has isEraser=true', () => {
    const erasers = DEFAULT_PRESETS.filter((p) => p.isEraser)
    expect(erasers).toHaveLength(1)
    expect(erasers[0].id).toBe('hard-eraser')
  })

  it('only smudge preset has usesSmudge=true', () => {
    const smudges = DEFAULT_PRESETS.filter((p) => p.usesSmudge)
    expect(smudges).toHaveLength(1)
    expect(smudges[0].id).toBe('smudge')
  })
})
