export interface ViewState {
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
