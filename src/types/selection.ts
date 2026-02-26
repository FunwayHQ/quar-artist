/** Selection tool sub-types */
export type SelectionToolType = 'rectangle' | 'ellipse' | 'freehand' | 'magicWand'

/** How a new selection operation combines with the existing selection */
export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect'

/** A 2D point */
export interface Point {
  x: number
  y: number
}

/** Axis-aligned bounding box */
export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

/** Options for the magic wand tool */
export interface MagicWandOptions {
  tolerance: number // 0-255
  contiguous: boolean
}

/** Options for selection feathering */
export interface FeatherOptions {
  radius: number // pixels (0 = no feathering)
}

/** Transform handle positions (8 handles + rotation) */
export type HandlePosition =
  | 'topLeft'
  | 'topCenter'
  | 'topRight'
  | 'middleLeft'
  | 'middleRight'
  | 'bottomLeft'
  | 'bottomCenter'
  | 'bottomRight'
  | 'rotation'

/** Transform state for the active transform operation */
export interface TransformState {
  /** Translation offset from original position */
  translateX: number
  translateY: number
  /** Scale factors */
  scaleX: number
  scaleY: number
  /** Rotation in radians */
  rotation: number
  /** Pivot point (center of transform) in canvas coords */
  pivotX: number
  pivotY: number
  /** Original bounding box of the selection before transform */
  originalBounds: BoundingBox
}

/** Callback for selection changes */
export type SelectionChangeCallback = (hasSelection: boolean, bounds: BoundingBox | null) => void
