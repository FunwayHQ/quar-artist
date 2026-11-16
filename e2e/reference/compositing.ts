/**
 * CPU reference for layer compositing, written from the specifications rather
 * than from the app's own code, so tests can't confirm a bug against itself.
 *
 * - Separable and non-separable blend modes and the general blending formula:
 *   W3C Compositing and Blending Level 1 (https://www.w3.org/TR/compositing-1/).
 * - Modes the W3C spec doesn't define (Add, Subtract, Divide, Vivid Light,
 *   Linear Light, Pin Light, Hard Mix, Darker/Lighter Color) use the usual
 *   Photoshop definitions.
 * - Dissolve is random by definition and has no per-pixel reference.
 *
 * Colours are RGBA8 with straight alpha.
 */
import type { BlendMode } from '../../src/types/layer.ts'
import type { RGBA } from '../harness/protocol.ts'

type RGB = [number, number, number]

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

// ── Separable blend functions B(Cb, Cs), per channel in [0, 1] ──

const multiply = (cb: number, cs: number) => cb * cs
const screen = (cb: number, cs: number) => cb + cs - cb * cs
const hardLight = (cb: number, cs: number) => (cs <= 0.5 ? multiply(cb, 2 * cs) : screen(cb, 2 * cs - 1))
const colorDodge = (cb: number, cs: number) => (cb === 0 ? 0 : cs >= 1 ? 1 : Math.min(1, cb / (1 - cs)))
const colorBurn = (cb: number, cs: number) => (cb >= 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs))

function softLight(cb: number, cs: number): number {
  if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb)
  const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb)
  return cb + (2 * cs - 1) * (d - cb)
}

const SEPARABLE: Partial<Record<BlendMode, (cb: number, cs: number) => number>> = {
  normal: (_cb, cs) => cs,
  multiply,
  screen,
  overlay: (cb, cs) => hardLight(cs, cb),
  darken: Math.min,
  lighten: Math.max,
  colorDodge,
  colorBurn,
  hardLight,
  softLight,
  difference: (cb, cs) => Math.abs(cb - cs),
  exclusion: (cb, cs) => cb + cs - 2 * cb * cs,
  // Photoshop definitions
  add: (cb, cs) => Math.min(1, cb + cs),
  subtract: (cb, cs) => Math.max(0, cb - cs),
  divide: (cb, cs) => (cs <= 0 ? (cb <= 0 ? 0 : 1) : Math.min(1, cb / cs)),
  linearLight: (cb, cs) => clamp01(cb + 2 * cs - 1),
  vividLight: (cb, cs) => (cs <= 0.5 ? colorBurn(cb, 2 * cs) : colorDodge(cb, 2 * cs - 1)),
  pinLight: (cb, cs) => (cs <= 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * cs - 1)),
  hardMix: (cb, cs) => (cb + cs >= 1 ? 1 : 0),
}

// ── Non-separable helpers (W3C section 9.1.5) ──

const lum = ([r, g, b]: RGB) => 0.3 * r + 0.59 * g + 0.11 * b

function clipColor(c: RGB): RGB {
  const l = lum(c)
  const n = Math.min(...c)
  const x = Math.max(...c)
  let out = c
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n)) as RGB
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l)) as RGB
  return out
}

function setLum(c: RGB, l: number): RGB {
  const d = l - lum(c)
  return clipColor(c.map((v) => v + d) as RGB)
}

const sat = (c: RGB) => Math.max(...c) - Math.min(...c)

function setSat(c: RGB, s: number): RGB {
  const max = Math.max(...c)
  const min = Math.min(...c)
  if (max === min) return [0, 0, 0]
  return c.map((v) => (v === max ? s : v === min ? 0 : ((v - min) * s) / (max - min))) as RGB
}

const NON_SEPARABLE: Partial<Record<BlendMode, (cb: RGB, cs: RGB) => RGB>> = {
  hue: (cb, cs) => setLum(setSat(cs, sat(cb)), lum(cb)),
  saturation: (cb, cs) => setLum(setSat(cb, sat(cs)), lum(cb)),
  color: (cb, cs) => setLum(cs, lum(cb)),
  luminosity: (cb, cs) => setLum(cb, lum(cs)),
  // Photoshop: pick whichever whole colour is darker / lighter
  darkerColor: (cb, cs) => (cs[0] + cs[1] + cs[2] < cb[0] + cb[1] + cb[2] ? cs : cb),
  lighterColor: (cb, cs) => (cs[0] + cs[1] + cs[2] > cb[0] + cb[1] + cb[2] ? cs : cb),
}

/** B(Cb, Cs) for a blend mode, on straight colours in [0, 1]. */
export function blendColor(mode: BlendMode, cb: RGB, cs: RGB): RGB {
  const separable = SEPARABLE[mode]
  if (separable) return [separable(cb[0], cs[0]), separable(cb[1], cs[1]), separable(cb[2], cs[2])]
  const nonSeparable = NON_SEPARABLE[mode]
  if (nonSeparable) return nonSeparable(cb, cs)
  throw new Error(`No per-pixel reference for blend mode "${mode}"`)
}

/**
 * Composite `source` (with `mode` and layer `opacity`) over `backdrop` using
 * the W3C general formula: Cs' = (1 − αb)·Cs + αb·B(Cb, Cs), then source-over.
 */
export function compositePixel(backdrop: RGBA, source: RGBA, mode: BlendMode, opacity = 1): RGBA {
  const ab = backdrop[3] / 255
  const as = (source[3] / 255) * opacity
  const cb: RGB = [backdrop[0] / 255, backdrop[1] / 255, backdrop[2] / 255]
  const cs: RGB = [source[0] / 255, source[1] / 255, source[2] / 255]
  const blended = blendColor(mode, cb, cs)

  const ao = as + ab * (1 - as)
  if (ao <= 0) return [0, 0, 0, 0]
  const out = [0, 1, 2].map((i) => {
    const mixed = (1 - ab) * cs[i] + ab * blended[i]
    const premultiplied = as * mixed + (1 - as) * ab * cb[i]
    return Math.round(clamp01(premultiplied / ao) * 255)
  })
  return [out[0], out[1], out[2], Math.round(ao * 255)]
}

export interface ReferenceLayer {
  color: RGBA
  mode?: BlendMode
  opacity?: number
  visible?: boolean
  /** Clipped to the alpha of the nearest unclipped layer below. */
  clippingMask?: boolean
}

/** Composite a stack of single-colour pixels, bottom to top. */
export function compositeStack(layers: ReferenceLayer[]): RGBA {
  let result: RGBA = [0, 0, 0, 0]
  let baseAlpha = 1
  for (const layer of layers) {
    if (layer.visible === false) {
      if (!layer.clippingMask) baseAlpha = 0
      continue
    }
    if (!layer.clippingMask) baseAlpha = layer.color[3] / 255
    const opacity = (layer.opacity ?? 1) * (layer.clippingMask ? baseAlpha : 1)
    result = compositePixel(result, layer.color, layer.mode ?? 'normal', opacity)
  }
  return result
}

/**
 * Painting onto an alpha-locked layer: colour moves toward the paint by the
 * paint's coverage, alpha stays as it was (W3C source-atop).
 */
export function paintAlphaLocked(existing: RGBA, paint: RGBA, coverage: number): RGBA {
  if (existing[3] === 0) return [0, 0, 0, 0]
  const k = clamp01(coverage) * (paint[3] / 255)
  const mix = (i: number) => Math.round(existing[i] + (paint[i] - existing[i]) * k)
  return [mix(0), mix(1), mix(2), existing[3]]
}
