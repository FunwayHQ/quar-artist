/**
 * Safely get a 2D rendering context from a canvas element.
 * Throws a clear error if the context is unavailable.
 */
export function get2dContext(
  canvas: HTMLCanvasElement,
  options?: CanvasRenderingContext2DSettings,
): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', options)
  if (!ctx) {
    throw new Error('Failed to get 2D canvas context — browser may be out of resources')
  }
  return ctx
}
