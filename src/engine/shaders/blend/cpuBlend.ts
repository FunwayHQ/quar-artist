import type { BlendMode } from '../../../types/layer.ts'

/**
 * CPU fallback blend operations for all custom blend modes.
 * Used when GPU shaders fail or for export accuracy.
 * All functions operate on straight (non-premultiplied) RGBA [0-1] values.
 */

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

// ── RGB ↔ HSL helpers ──

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const maxC = Math.max(r, g, b)
  const minC = Math.min(r, g, b)
  const l = (maxC + minC) / 2
  let s = 0
  let h = 0
  if (maxC !== minC) {
    const d = maxC - minC
    s = l > 0.5 ? d / (2 - maxC - minC) : d / (maxC + minC)
    if (maxC === r) {
      h = (g - b) / d + (g < b ? 6 : 0)
    } else if (maxC === g) {
      h = (b - r) / d + 2
    } else {
      h = (r - g) / d + 4
    }
    h /= 6
  }
  return [h, s, l]
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    hue2rgb(p, q, h + 1 / 3),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1 / 3),
  ]
}

// ── Per-channel blend functions ──

function colorDodgeCh(s: number, d: number): number {
  if (d === 0) return 0
  if (s >= 1) return 1
  return Math.min(1, d / (1 - s))
}

function colorBurnCh(s: number, d: number): number {
  if (d >= 1) return 1
  if (s === 0) return 0
  return 1 - Math.min(1, (1 - d) / s)
}

function vividLightCh(s: number, d: number): number {
  if (s <= 0.5) {
    const s2 = 2 * s
    if (s2 === 0) return 0
    return 1 - Math.min(1, (1 - d) / s2)
  } else {
    const s2 = 2 * (s - 0.5)
    if (s2 >= 1) return 1
    return Math.min(1, d / (1 - s2))
  }
}

// ── Blend mode implementations ──

type BlendFn = (sr: number, sg: number, sb: number, dr: number, dg: number, db: number) => [number, number, number]

const blendFunctions: Partial<Record<BlendMode, BlendFn>> = {
  multiply: (sr, sg, sb, dr, dg, db) => [sr * dr, sg * dg, sb * db],
  screen: (sr, sg, sb, dr, dg, db) => [
    1 - (1 - sr) * (1 - dr),
    1 - (1 - sg) * (1 - dg),
    1 - (1 - sb) * (1 - db),
  ],
  overlay: (sr, sg, sb, dr, dg, db) => {
    const ch = (s: number, d: number) => d < 0.5 ? 2 * s * d : 1 - 2 * (1 - s) * (1 - d)
    return [ch(sr, dr), ch(sg, dg), ch(sb, db)]
  },
  softLight: (sr, sg, sb, dr, dg, db) => {
    const ch = (s: number, d: number) => {
      if (s <= 0.5) return d - (1 - 2 * s) * d * (1 - d)
      const g = d <= 0.25 ? ((16 * d - 12) * d + 4) * d : Math.sqrt(d)
      return d + (2 * s - 1) * (g - d)
    }
    return [ch(sr, dr), ch(sg, dg), ch(sb, db)]
  },
  add: (sr, sg, sb, dr, dg, db) => [
    Math.min(1, sr + dr), Math.min(1, sg + dg), Math.min(1, sb + db),
  ],
  darken: (sr, sg, sb, dr, dg, db) => [
    Math.min(sr, dr), Math.min(sg, dg), Math.min(sb, db),
  ],
  lighten: (sr, sg, sb, dr, dg, db) => [
    Math.max(sr, dr), Math.max(sg, dg), Math.max(sb, db),
  ],
  colorDodge: (sr, sg, sb, dr, dg, db) => [
    colorDodgeCh(sr, dr), colorDodgeCh(sg, dg), colorDodgeCh(sb, db),
  ],
  colorBurn: (sr, sg, sb, dr, dg, db) => [
    colorBurnCh(sr, dr), colorBurnCh(sg, dg), colorBurnCh(sb, db),
  ],
  hardLight: (sr, sg, sb, dr, dg, db) => {
    const ch = (s: number, d: number) => s < 0.5 ? 2 * s * d : 1 - 2 * (1 - s) * (1 - d)
    return [ch(sr, dr), ch(sg, dg), ch(sb, db)]
  },
  difference: (sr, sg, sb, dr, dg, db) => [
    Math.abs(sr - dr), Math.abs(sg - dg), Math.abs(sb - db),
  ],
  exclusion: (sr, sg, sb, dr, dg, db) => [
    sr + dr - 2 * sr * dr,
    sg + dg - 2 * sg * dg,
    sb + db - 2 * sb * db,
  ],
  hue: (sr, sg, sb, dr, dg, db) => {
    const [sh] = rgbToHsl(sr, sg, sb)
    const [, ds, dl] = rgbToHsl(dr, dg, db)
    return hslToRgb(sh, ds, dl)
  },
  saturation: (sr, sg, sb, dr, dg, db) => {
    const [, ss] = rgbToHsl(sr, sg, sb)
    const [dh, , dl] = rgbToHsl(dr, dg, db)
    return hslToRgb(dh, ss, dl)
  },
  color: (sr, sg, sb, dr, dg, db) => {
    const [sh, ss] = rgbToHsl(sr, sg, sb)
    const [, , dl] = rgbToHsl(dr, dg, db)
    return hslToRgb(sh, ss, dl)
  },
  luminosity: (sr, sg, sb, dr, dg, db) => {
    const [, , sl] = rgbToHsl(sr, sg, sb)
    const [dh, ds] = rgbToHsl(dr, dg, db)
    return hslToRgb(dh, ds, sl)
  },
  // Custom shader modes
  vividLight: (sr, sg, sb, dr, dg, db) => [
    vividLightCh(sr, dr), vividLightCh(sg, dg), vividLightCh(sb, db),
  ],
  linearLight: (sr, sg, sb, dr, dg, db) => [
    clamp01(dr + 2 * sr - 1),
    clamp01(dg + 2 * sg - 1),
    clamp01(db + 2 * sb - 1),
  ],
  pinLight: (sr, sg, sb, dr, dg, db) => {
    const ch = (s: number, d: number) => s < 0.5 ? Math.min(d, 2 * s) : Math.max(d, 2 * s - 1)
    return [ch(sr, dr), ch(sg, dg), ch(sb, db)]
  },
  hardMix: (sr, sg, sb, dr, dg, db) => [
    vividLightCh(sr, dr) >= 0.5 ? 1 : 0,
    vividLightCh(sg, dg) >= 0.5 ? 1 : 0,
    vividLightCh(sb, db) >= 0.5 ? 1 : 0,
  ],
  subtract: (sr, sg, sb, dr, dg, db) => [
    Math.max(0, dr - sr), Math.max(0, dg - sg), Math.max(0, db - sb),
  ],
  divide: (sr, sg, sb, dr, dg, db) => {
    const ch = (s: number, d: number) => s === 0 ? 1 : Math.min(1, d / s)
    return [ch(sr, dr), ch(sg, dg), ch(sb, db)]
  },
  darkerColor: (sr, sg, sb, dr, dg, db) => {
    return luminance(sr, sg, sb) < luminance(dr, dg, db)
      ? [sr, sg, sb]
      : [dr, dg, db]
  },
  lighterColor: (sr, sg, sb, dr, dg, db) => {
    return luminance(sr, sg, sb) > luminance(dr, dg, db)
      ? [sr, sg, sb]
      : [dr, dg, db]
  },
  dissolve: (sr, sg, sb) => [sr, sg, sb],
}

/**
 * Blend source pixels over destination pixels using the specified blend mode.
 * Both inputs are Uint8ClampedArray in RGBA order (4 bytes per pixel).
 * Returns a new Uint8ClampedArray with the blended result.
 */
export function cpuBlendLayers(
  srcPixels: Uint8ClampedArray,
  dstPixels: Uint8ClampedArray,
  mode: BlendMode,
  opacity: number,
): Uint8ClampedArray {
  const len = srcPixels.length
  const result = new Uint8ClampedArray(len)

  const blendFn = blendFunctions[mode]
  if (!blendFn) {
    // Normal mode: standard alpha composite
    for (let i = 0; i < len; i += 4) {
      const sa = (srcPixels[i + 3] / 255) * opacity
      const da = dstPixels[i + 3] / 255
      const sr = srcPixels[i] / 255
      const sg = srcPixels[i + 1] / 255
      const sb = srcPixels[i + 2] / 255
      const dr = dstPixels[i] / 255
      const dg = dstPixels[i + 1] / 255
      const db = dstPixels[i + 2] / 255

      const outA = da + sa * (1 - da)
      const outR = outA > 0 ? (sr * sa + dr * da * (1 - sa)) / outA : 0
      const outG = outA > 0 ? (sg * sa + dg * da * (1 - sa)) / outA : 0
      const outB = outA > 0 ? (sb * sa + db * da * (1 - sa)) / outA : 0

      result[i] = Math.round(outR * 255)
      result[i + 1] = Math.round(outG * 255)
      result[i + 2] = Math.round(outB * 255)
      result[i + 3] = Math.round(outA * 255)
    }
    return result
  }

  for (let i = 0; i < len; i += 4) {
    const sa = (srcPixels[i + 3] / 255) * opacity
    const da = dstPixels[i + 3] / 255
    const sr = srcPixels[i] / 255
    const sg = srcPixels[i + 1] / 255
    const sb = srcPixels[i + 2] / 255
    const dr = dstPixels[i] / 255
    const dg = dstPixels[i + 1] / 255
    const db = dstPixels[i + 2] / 255

    const [br, bg, bb] = blendFn(sr, sg, sb, dr, dg, db)

    // Mix blended result with destination based on source alpha
    const outR = dr + (br - dr) * sa
    const outG = dg + (bg - dg) * sa
    const outB = db + (bb - db) * sa
    const outA = da + sa * (1 - da)

    result[i] = Math.round(clamp01(outR) * 255)
    result[i + 1] = Math.round(clamp01(outG) * 255)
    result[i + 2] = Math.round(clamp01(outB) * 255)
    result[i + 3] = Math.round(clamp01(outA) * 255)
  }

  return result
}

/**
 * Blend a single pixel pair (for testing). Returns [r, g, b] in [0-1] range.
 */
export function cpuBlendPixel(
  sr: number, sg: number, sb: number,
  dr: number, dg: number, db: number,
  mode: BlendMode,
): [number, number, number] {
  const blendFn = blendFunctions[mode]
  if (!blendFn) return [sr, sg, sb] // normal
  return blendFn(sr, sg, sb, dr, dg, db)
}
