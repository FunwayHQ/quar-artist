export interface StrokePoint {
  x: number
  y: number
  pressure: number
  tiltX: number
  tiltY: number
  timestamp: number
}

export interface StampPosition {
  x: number
  y: number
  size: number
  opacity: number
  rotation: number
}

export type BrushCategory = 'draw' | 'paint' | 'sketch' | 'blend' | 'utility'

export type ShapeTextureId =
  | 'hard-round'
  | 'soft-round'
  | 'pencil-grain'
  | 'ink-splatter'
  | 'watercolor-bleed'
  | 'oil-bristle'
  | 'marker-flat'
  | 'pastel-rough'
  | 'charcoal-grain'
  | 'smudge-soft'
  | 'flat-square'
  | 'airbrush-gradient'

export type GrainTextureId = 'paper-fine' | 'paper-rough' | 'canvas-weave' | 'noise-perlin'

export interface BrushPreset {
  id: string
  name: string
  category: BrushCategory
  size: number
  minSize: number
  maxSize: number
  opacity: number
  spacing: number
  hardness: number
  smoothing: number
  pressureSizeEnabled: boolean
  pressureOpacityEnabled: boolean
  isEraser: boolean
  /** Scatter amount — randomizes stamp position perpendicular to stroke (0 = none, 1 = full brush size) */
  scatter: number
  /** Stamp rotation jitter in degrees (0 = aligned to stroke, 360 = fully random) */
  rotationJitter: number
  /** Whether this brush uses smudge mode (blend existing pixels along stroke) */
  usesSmudge: boolean
  /** Optional shape texture ID for texture-based stamp rendering */
  shapeTextureId?: ShapeTextureId
  /** Optional grain texture ID for surface texture modulation */
  grainTextureId?: GrainTextureId
  /** Pressure curve control points [cp1x, cp1y, cp2x, cp2y]. Default linear: [0.25, 0.25, 0.75, 0.75] */
  pressureCurve?: [number, number, number, number]
}

export interface BrushState {
  activePresetId: string
  size: number
  opacity: number
}
