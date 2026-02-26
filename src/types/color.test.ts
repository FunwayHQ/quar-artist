import { describe, it, expect } from 'vitest'
import {
  hsbToRgba,
  rgbaToHsb,
  hsbToHex,
  hexToHsb,
  hsbToRgb255,
  getHarmonyHues,
  ALL_HARMONY_MODES,
  HARMONY_MODE_LABELS,
} from './color.ts'
import type { HSBColor } from './color.ts'

describe('hsbToRgba', () => {
  it('converts pure red', () => {
    const rgba = hsbToRgba({ h: 0, s: 1, b: 1 })
    expect(rgba.r).toBeCloseTo(1)
    expect(rgba.g).toBeCloseTo(0)
    expect(rgba.b).toBeCloseTo(0)
    expect(rgba.a).toBe(1)
  })

  it('converts pure green', () => {
    const rgba = hsbToRgba({ h: 120, s: 1, b: 1 })
    expect(rgba.r).toBeCloseTo(0)
    expect(rgba.g).toBeCloseTo(1)
    expect(rgba.b).toBeCloseTo(0)
  })

  it('converts pure blue', () => {
    const rgba = hsbToRgba({ h: 240, s: 1, b: 1 })
    expect(rgba.r).toBeCloseTo(0)
    expect(rgba.g).toBeCloseTo(0)
    expect(rgba.b).toBeCloseTo(1)
  })

  it('converts white (s=0, b=1)', () => {
    const rgba = hsbToRgba({ h: 0, s: 0, b: 1 })
    expect(rgba.r).toBeCloseTo(1)
    expect(rgba.g).toBeCloseTo(1)
    expect(rgba.b).toBeCloseTo(1)
  })

  it('converts black (b=0)', () => {
    const rgba = hsbToRgba({ h: 0, s: 1, b: 0 })
    expect(rgba.r).toBeCloseTo(0)
    expect(rgba.g).toBeCloseTo(0)
    expect(rgba.b).toBeCloseTo(0)
  })

  it('respects custom alpha', () => {
    const rgba = hsbToRgba({ h: 0, s: 1, b: 1 }, 0.5)
    expect(rgba.a).toBe(0.5)
  })

  it('converts amber (#F59E0B approx h=38, s=0.95, b=0.96)', () => {
    const rgba = hsbToRgba({ h: 38, s: 0.95, b: 0.96 })
    expect(rgba.r).toBeGreaterThan(0.9)
    expect(rgba.g).toBeGreaterThan(0.5)
    expect(rgba.b).toBeLessThan(0.15)
  })
})

describe('rgbaToHsb', () => {
  it('converts red to h=0, s=1, b=1', () => {
    const hsb = rgbaToHsb({ r: 1, g: 0, b: 0, a: 1 })
    expect(hsb.h).toBeCloseTo(0)
    expect(hsb.s).toBeCloseTo(1)
    expect(hsb.b).toBeCloseTo(1)
  })

  it('converts white to s=0, b=1', () => {
    const hsb = rgbaToHsb({ r: 1, g: 1, b: 1, a: 1 })
    expect(hsb.s).toBe(0)
    expect(hsb.b).toBe(1)
  })

  it('converts black to b=0', () => {
    const hsb = rgbaToHsb({ r: 0, g: 0, b: 0, a: 1 })
    expect(hsb.b).toBe(0)
  })

  it('round-trips through hsbToRgba', () => {
    const original: HSBColor = { h: 200, s: 0.7, b: 0.8 }
    const rgba = hsbToRgba(original)
    const result = rgbaToHsb(rgba)
    expect(result.h).toBeCloseTo(original.h, 0)
    expect(result.s).toBeCloseTo(original.s, 1)
    expect(result.b).toBeCloseTo(original.b, 1)
  })

  it('handles green channel as max', () => {
    const hsb = rgbaToHsb({ r: 0, g: 1, b: 0, a: 1 })
    expect(hsb.h).toBeCloseTo(120)
  })

  it('handles blue channel as max', () => {
    const hsb = rgbaToHsb({ r: 0, g: 0, b: 1, a: 1 })
    expect(hsb.h).toBeCloseTo(240)
  })
})

describe('hsbToHex', () => {
  it('converts white to #ffffff', () => {
    expect(hsbToHex({ h: 0, s: 0, b: 1 })).toBe('#ffffff')
  })

  it('converts black to #000000', () => {
    expect(hsbToHex({ h: 0, s: 0, b: 0 })).toBe('#000000')
  })

  it('converts red to #ff0000', () => {
    expect(hsbToHex({ h: 0, s: 1, b: 1 })).toBe('#ff0000')
  })
})

describe('hexToHsb', () => {
  it('parses #ff0000 as red', () => {
    const hsb = hexToHsb('#ff0000')
    expect(hsb).not.toBeNull()
    expect(hsb!.h).toBeCloseTo(0)
    expect(hsb!.s).toBeCloseTo(1)
    expect(hsb!.b).toBeCloseTo(1)
  })

  it('parses without hash prefix', () => {
    const hsb = hexToHsb('00ff00')
    expect(hsb).not.toBeNull()
    expect(hsb!.h).toBeCloseTo(120)
  })

  it('returns null for invalid hex', () => {
    expect(hexToHsb('xyz')).toBeNull()
    expect(hexToHsb('#gg0000')).toBeNull()
    expect(hexToHsb('#12')).toBeNull()
  })

  it('round-trips with hsbToHex', () => {
    const hex = '#f59e0b'
    const hsb = hexToHsb(hex)!
    const result = hsbToHex(hsb)
    expect(result).toBe(hex)
  })
})

describe('hsbToRgb255', () => {
  it('converts red to (255, 0, 0)', () => {
    const rgb = hsbToRgb255({ h: 0, s: 1, b: 1 })
    expect(rgb).toEqual({ r: 255, g: 0, b: 0 })
  })

  it('converts white to (255, 255, 255)', () => {
    const rgb = hsbToRgb255({ h: 0, s: 0, b: 1 })
    expect(rgb).toEqual({ r: 255, g: 255, b: 255 })
  })
})

describe('getHarmonyHues', () => {
  it('returns empty for none', () => {
    expect(getHarmonyHues(0, 'none')).toEqual([])
  })

  it('returns complementary (180° offset)', () => {
    expect(getHarmonyHues(0, 'complementary')).toEqual([180])
    expect(getHarmonyHues(90, 'complementary')).toEqual([270])
  })

  it('returns analogous (±30°)', () => {
    const hues = getHarmonyHues(0, 'analogous')
    expect(hues).toHaveLength(2)
    expect(hues).toContain(30)
    expect(hues).toContain(330)
  })

  it('returns triadic (±120°)', () => {
    const hues = getHarmonyHues(0, 'triadic')
    expect(hues).toHaveLength(2)
    expect(hues).toContain(120)
    expect(hues).toContain(240)
  })

  it('returns split-complementary (+150°, +210°)', () => {
    const hues = getHarmonyHues(0, 'split-complementary')
    expect(hues).toHaveLength(2)
    expect(hues).toContain(150)
    expect(hues).toContain(210)
  })

  it('returns tetradic (+90°, +180°, +270°)', () => {
    const hues = getHarmonyHues(0, 'tetradic')
    expect(hues).toHaveLength(3)
    expect(hues).toContain(90)
    expect(hues).toContain(180)
    expect(hues).toContain(270)
  })

  it('wraps hues around 360', () => {
    const hues = getHarmonyHues(350, 'complementary')
    expect(hues[0]).toBeCloseTo(170)
  })
})

describe('harmony modes', () => {
  it('has 6 modes', () => {
    expect(ALL_HARMONY_MODES).toHaveLength(6)
  })

  it('has labels for all modes', () => {
    for (const mode of ALL_HARMONY_MODES) {
      expect(HARMONY_MODE_LABELS[mode]).toBeDefined()
      expect(HARMONY_MODE_LABELS[mode].length).toBeGreaterThan(0)
    }
  })
})
