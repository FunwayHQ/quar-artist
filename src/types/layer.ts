export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'softLight'
  | 'add'
  | 'color'
  | 'luminosity'

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
  'multiply',
  'screen',
  'overlay',
  'softLight',
  'add',
  'color',
  'luminosity',
]

export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  softLight: 'Soft Light',
  add: 'Add',
  color: 'Color',
  luminosity: 'Luminosity',
}

export const MAX_LAYERS = 20
