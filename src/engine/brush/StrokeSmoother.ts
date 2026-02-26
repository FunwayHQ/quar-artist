import type { StrokePoint } from '../../types/brush.ts'

/**
 * Exponential smoothing (StreamLine) for stroke input.
 * S_t = alpha * P_t + (1 - alpha) * S_{t-1}
 *
 * alpha = 1 → no smoothing (raw input)
 * alpha = 0 → maximum smoothing (almost no response)
 * Typical values: 0.3–0.7
 */
export class StrokeSmoother {
  private alpha: number
  private lastSmoothed: StrokePoint | null = null

  constructor(alpha = 0.5) {
    this.alpha = Math.max(0.01, Math.min(1, alpha))
  }

  setAlpha(alpha: number) {
    this.alpha = Math.max(0.01, Math.min(1, alpha))
  }

  reset() {
    this.lastSmoothed = null
  }

  /** Smooth a single incoming point. Returns the smoothed result. */
  smooth(point: StrokePoint): StrokePoint {
    if (!this.lastSmoothed) {
      this.lastSmoothed = { ...point }
      return { ...point }
    }

    const a = this.alpha
    const b = 1 - a
    const smoothed: StrokePoint = {
      x: a * point.x + b * this.lastSmoothed.x,
      y: a * point.y + b * this.lastSmoothed.y,
      pressure: a * point.pressure + b * this.lastSmoothed.pressure,
      tiltX: a * point.tiltX + b * this.lastSmoothed.tiltX,
      tiltY: a * point.tiltY + b * this.lastSmoothed.tiltY,
      timestamp: point.timestamp,
    }

    this.lastSmoothed = { ...smoothed }
    return smoothed
  }

  /** Smooth an array of points (e.g., from getCoalescedEvents). */
  smoothAll(points: StrokePoint[]): StrokePoint[] {
    return points.map((p) => this.smooth(p))
  }
}
