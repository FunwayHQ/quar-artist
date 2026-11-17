export interface ViewState {
  x: number
  y: number
  zoom: number
  rotation: number
}

/**
 * How the canvas showed a document, saved with its project (plan M1.4): the
 * point of the document at the middle of the viewport, the zoom and the
 * rotation in radians. Kept apart from the viewport's size, which may differ
 * when the project opens again.
 */
export interface SavedView {
  x: number
  y: number
  zoom: number
  rotation: number
}

export interface CanvasSize {
  width: number
  height: number
}

export type RenderBackend = 'webgpu' | 'webgl2'

export type ToolType =
  | 'brush'
  | 'eraser'
  | 'smudge'
  | 'selection'
  | 'transform'
  | 'fill'
  | 'eyedropper'
  | 'move'
  | 'text'

export interface PointerState {
  x: number
  y: number
  pressure: number
  tiltX: number
  tiltY: number
  pointerId: number
  pointerType: 'mouse' | 'pen' | 'touch'
}
