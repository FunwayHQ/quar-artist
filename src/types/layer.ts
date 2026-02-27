export type BlendMode =
  | 'normal'
  // Darken
  | 'darken' | 'multiply' | 'colorBurn'
  // Lighten
  | 'lighten' | 'screen' | 'colorDodge' | 'add'
  // Contrast
  | 'overlay' | 'softLight' | 'hardLight' | 'vividLight' | 'linearLight' | 'pinLight' | 'hardMix'
  // Comparative
  | 'difference' | 'exclusion' | 'subtract' | 'divide'
  // Component
  | 'hue' | 'saturation' | 'color' | 'luminosity'
  // Special
  | 'darkerColor' | 'lighterColor' | 'dissolve'

export interface LayerInfo {
  id: string
  name: string
  visible: boolean
  opacity: number
  blendMode: BlendMode
  alphaLock: boolean
  clippingMask: boolean
  locked: boolean
  /** Base64 data URL of a small thumbnail preview. Updated after strokes. */
  thumbnail?: string
}

export const ALL_BLEND_MODES: BlendMode[] = [
  'normal',
  'darken', 'multiply', 'colorBurn',
  'lighten', 'screen', 'colorDodge', 'add',
  'overlay', 'softLight', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix',
  'difference', 'exclusion', 'subtract', 'divide',
  'hue', 'saturation', 'color', 'luminosity',
  'darkerColor', 'lighterColor', 'dissolve',
]

export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  darken: 'Darken',
  multiply: 'Multiply',
  colorBurn: 'Color Burn',
  lighten: 'Lighten',
  screen: 'Screen',
  colorDodge: 'Color Dodge',
  add: 'Add',
  overlay: 'Overlay',
  softLight: 'Soft Light',
  hardLight: 'Hard Light',
  vividLight: 'Vivid Light',
  linearLight: 'Linear Light',
  pinLight: 'Pin Light',
  hardMix: 'Hard Mix',
  difference: 'Difference',
  exclusion: 'Exclusion',
  subtract: 'Subtract',
  divide: 'Divide',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
  darkerColor: 'Darker Color',
  lighterColor: 'Lighter Color',
  dissolve: 'Dissolve',
}

export const BLEND_MODE_GROUPS: { label: string; modes: BlendMode[] }[] = [
  { label: 'Normal', modes: ['normal', 'dissolve'] },
  { label: 'Darken', modes: ['darken', 'multiply', 'colorBurn', 'darkerColor'] },
  { label: 'Lighten', modes: ['lighten', 'screen', 'colorDodge', 'add', 'lighterColor'] },
  { label: 'Contrast', modes: ['overlay', 'softLight', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix'] },
  { label: 'Comparative', modes: ['difference', 'exclusion', 'subtract', 'divide'] },
  { label: 'Component', modes: ['hue', 'saturation', 'color', 'luminosity'] },
]

export const MAX_LAYERS = 20
