import { ColorMatrixFilter, type Filter } from 'pixi.js'

/**
 * Create an HSB adjustment filter using PixiJS's built-in ColorMatrixFilter.
 * Works natively on both WebGL and WebGPU.
 *
 * @param hueShift  -180 to +180 degrees
 * @param saturation  -100 to +100
 * @param brightness  -100 to +100
 */
export function createHSBAdjustmentFilter(
  hueShift: number,
  saturation: number,
  brightness: number,
): Filter {
  const cm = new ColorMatrixFilter()
  applyHSBToColorMatrix(cm, hueShift, saturation, brightness)
  return cm
}

export function updateHSBUniforms(
  filter: Filter,
  hueShift: number,
  saturation: number,
  brightness: number,
): void {
  if (filter instanceof ColorMatrixFilter) {
    filter.reset()
    applyHSBToColorMatrix(filter, hueShift, saturation, brightness)
  }
}

function applyHSBToColorMatrix(
  cm: ColorMatrixFilter,
  hueShift: number,
  saturation: number,
  brightness: number,
): void {
  // Hue: ColorMatrixFilter.hue() expects degrees
  if (hueShift !== 0) {
    cm.hue(hueShift, false)
  }

  // Saturation: ColorMatrixFilter.saturate() expects -1 to 1
  // Our param is -100 to +100, so divide by 100
  if (saturation !== 0) {
    cm.saturate(saturation / 100, true)
  }

  // Brightness: ColorMatrixFilter.brightness() expects a multiplier (1 = no change)
  // Our param is -100 to +100.
  // Map: -100 → 0.0 (black), 0 → 1.0 (no change), +100 → 2.0 (double bright)
  if (brightness !== 0) {
    const multiplier = 1 + brightness / 100
    cm.brightness(multiplier, true)
  }
}
