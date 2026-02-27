import type { BlendMode } from '../../../types/layer.ts'

/**
 * Maps QUAR Artist blend modes to PSD blend mode keys
 * used by the ag-psd library.
 */
const QUAR_TO_PSD: Record<BlendMode, string> = {
  normal: 'normal',
  // Darken
  darken: 'darken',
  multiply: 'multiply',
  colorBurn: 'color burn',
  // Lighten
  lighten: 'lighten',
  screen: 'screen',
  colorDodge: 'color dodge',
  add: 'linear dodge',
  // Contrast
  overlay: 'overlay',
  softLight: 'soft light',
  hardLight: 'hard light',
  vividLight: 'vivid light',
  linearLight: 'linear light',
  pinLight: 'pin light',
  hardMix: 'hard mix',
  // Comparative
  difference: 'difference',
  exclusion: 'exclusion',
  subtract: 'subtract',
  divide: 'divide',
  // Component
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  // Special
  darkerColor: 'darker color',
  lighterColor: 'lighter color',
  dissolve: 'dissolve',
}

const PSD_TO_QUAR: Record<string, BlendMode> = {}
for (const [quar, psd] of Object.entries(QUAR_TO_PSD)) {
  PSD_TO_QUAR[psd] = quar as BlendMode
}

export function quarToPsdBlendMode(mode: BlendMode): string {
  return QUAR_TO_PSD[mode] ?? 'normal'
}

export function psdToQuarBlendMode(psdMode: string): BlendMode {
  return PSD_TO_QUAR[psdMode] ?? 'normal'
}
