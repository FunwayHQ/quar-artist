import type { StrokePoint, StampPosition, BrushPreset } from '../../types/brush.ts'

/**
 * Catmull-Rom spline interpolation between smoothed points.
 * Generates stamp positions at configured spacing.
 */
export class PathInterpolator {
  private points: StrokePoint[] = []
  private distanceAccum = 0

  reset() {
    this.points = []
    this.distanceAccum = 0
  }

  /**
   * Add a new smoothed point and return any new stamp positions
   * that should be rendered based on the brush spacing.
   */
  addPoint(point: StrokePoint, preset: BrushPreset): StampPosition[] {
    this.points.push(point)
    if (this.points.length < 2) {
      // First point — render one stamp immediately
      return [this.pointToStamp(point, preset)]
    }

    return this.generateStamps(preset)
  }

  private generateStamps(preset: BrushPreset): StampPosition[] {
    const stamps: StampPosition[] = []
    const pts = this.points
    const n = pts.length

    if (n < 2) return stamps

    const p0 = pts[Math.max(n - 3, 0)]
    const p1 = pts[n - 2]
    const p2 = pts[n - 1]
    // Extrapolate p3 from p1→p2 direction to preserve forward tangent
    const p3: StrokePoint = {
      x: 2 * p2.x - p1.x,
      y: 2 * p2.y - p1.y,
      pressure: p2.pressure,
      tiltX: p2.tiltX,
      tiltY: p2.tiltY,
      timestamp: p2.timestamp + (p2.timestamp - p1.timestamp),
    }

    // Distance between the two most recent points
    const segDist = distance(p1, p2)
    if (segDist < 0.5) return stamps

    // Spacing in pixels based on brush size and spacing ratio
    const baseSize = this.computeSize(p1.pressure, preset)
    const spacingPx = Math.max(1, baseSize * preset.spacing)

    // Walk along the segment using Catmull-Rom interpolation
    let d = this.distanceAccum
    const step = spacingPx

    while (d < segDist) {
      const t = d / segDist
      const interp = catmullRom(p0, p1, p2, p3, t)
      stamps.push(this.pointToStamp(interp, preset))
      d += step
    }

    this.distanceAccum = d - segDist
    return stamps
  }

  private pointToStamp(point: StrokePoint, preset: BrushPreset): StampPosition {
    const size = this.computeSize(point.pressure, preset)
    const opacity = this.computeOpacity(point.pressure, preset)
    const rotation = Math.atan2(point.tiltY, point.tiltX || 1)

    return {
      x: point.x,
      y: point.y,
      size,
      opacity,
      rotation,
    }
  }

  private computeSize(pressure: number, preset: BrushPreset): number {
    if (!preset.pressureSizeEnabled) return preset.size
    // Map pressure [0, 1] to [minSize, maxSize]
    const p = Math.max(0, Math.min(1, pressure))
    return preset.size * (0.2 + 0.8 * p)
  }

  private computeOpacity(pressure: number, preset: BrushPreset): number {
    if (!preset.pressureOpacityEnabled) return preset.opacity
    const p = Math.max(0, Math.min(1, pressure))
    return preset.opacity * (0.1 + 0.9 * p)
  }
}

/** Catmull-Rom spline interpolation */
function catmullRom(
  p0: StrokePoint,
  p1: StrokePoint,
  p2: StrokePoint,
  p3: StrokePoint,
  t: number,
): StrokePoint {
  const t2 = t * t
  const t3 = t2 * t

  const interp = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)

  return {
    x: interp(p0.x, p1.x, p2.x, p3.x),
    y: interp(p0.y, p1.y, p2.y, p3.y),
    pressure: lerp(p1.pressure, p2.pressure, t),
    tiltX: lerp(p1.tiltX, p2.tiltX, t),
    tiltY: lerp(p1.tiltY, p2.tiltY, t),
    timestamp: lerp(p1.timestamp, p2.timestamp, t),
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function distance(a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}
