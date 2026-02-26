export interface RGBAColor {
  r: number // 0-1
  g: number // 0-1
  b: number // 0-1
  a: number // 0-1
}

export interface HSBColor {
  h: number // 0-360
  s: number // 0-1
  b: number // 0-1
}

export type HarmonyMode =
  | 'none'
  | 'complementary'
  | 'analogous'
  | 'triadic'
  | 'split-complementary'
  | 'tetradic'

export interface ColorSwatch {
  color: HSBColor
  name?: string
}

export interface ColorPalette {
  id: string
  name: string
  swatches: ColorSwatch[]
}

export const ALL_HARMONY_MODES: HarmonyMode[] = [
  'none',
  'complementary',
  'analogous',
  'triadic',
  'split-complementary',
  'tetradic',
]

export const HARMONY_MODE_LABELS: Record<HarmonyMode, string> = {
  none: 'None',
  complementary: 'Complementary',
  analogous: 'Analogous',
  triadic: 'Triadic',
  'split-complementary': 'Split-Comp',
  tetradic: 'Tetradic',
}

/** Get harmony companion hues for a given base hue and mode. */
export function getHarmonyHues(baseHue: number, mode: HarmonyMode): number[] {
  const h = ((baseHue % 360) + 360) % 360
  switch (mode) {
    case 'none':
      return []
    case 'complementary':
      return [(h + 180) % 360]
    case 'analogous':
      return [(h + 30) % 360, (h + 330) % 360]
    case 'triadic':
      return [(h + 120) % 360, (h + 240) % 360]
    case 'split-complementary':
      return [(h + 150) % 360, (h + 210) % 360]
    case 'tetradic':
      return [(h + 90) % 360, (h + 180) % 360, (h + 270) % 360]
  }
}

export function hsbToRgba(hsb: HSBColor, alpha = 1): RGBAColor {
  const { h, s, b } = hsb
  const c = b * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = b - c

  let r = 0,
    g = 0,
    bl = 0

  if (h < 60) {
    r = c; g = x; bl = 0
  } else if (h < 120) {
    r = x; g = c; bl = 0
  } else if (h < 180) {
    r = 0; g = c; bl = x
  } else if (h < 240) {
    r = 0; g = x; bl = c
  } else if (h < 300) {
    r = x; g = 0; bl = c
  } else {
    r = c; g = 0; bl = x
  }

  return { r: r + m, g: g + m, b: bl + m, a: alpha }
}

export function rgbaToHsb(rgba: RGBAColor): HSBColor {
  const { r, g, b } = rgba
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min

  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }

  const s = max === 0 ? 0 : d / max
  return { h, s, b: max }
}

export function hsbToHex(hsb: HSBColor): string {
  const rgba = hsbToRgba(hsb)
  const r = Math.round(rgba.r * 255)
  const g = Math.round(rgba.g * 255)
  const b = Math.round(rgba.b * 255)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

export function hexToHsb(hex: string): HSBColor | null {
  const clean = hex.replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  return rgbaToHsb({ r, g, b, a: 1 })
}

export function hsbToRgb255(hsb: HSBColor): { r: number; g: number; b: number } {
  const rgba = hsbToRgba(hsb)
  return {
    r: Math.round(rgba.r * 255),
    g: Math.round(rgba.g * 255),
    b: Math.round(rgba.b * 255),
  }
}
