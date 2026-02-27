import { BlurFilter, type Filter } from 'pixi.js'

/**
 * Create a Gaussian blur filter using PixiJS's built-in BlurFilter.
 * Uses the native implementation that works on both WebGL and WebGPU.
 *
 * Returns [blurFilter] — a single filter that handles both H and V passes internally.
 */
export function createGaussianBlurFilters(
  radius: number,
  _width: number,
  _height: number,
): Filter[] {
  // PixiJS BlurFilter strength roughly maps to our radius concept.
  // Quality controls number of passes — higher = smoother but slower.
  const quality = Math.min(Math.max(Math.ceil(radius / 4), 2), 10)
  const blur = new BlurFilter({
    strength: radius,
    quality,
  })
  return [blur]
}

/** Update an existing blur filter's radius. */
export function updateGaussianBlurUniforms(
  filters: Filter[],
  radius: number,
  _width: number,
  _height: number,
): void {
  for (const filter of filters) {
    if (filter instanceof BlurFilter) {
      filter.strength = radius
      filter.quality = Math.min(Math.max(Math.ceil(radius / 4), 2), 10)
    }
  }
}
