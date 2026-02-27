import type { StampPosition } from '../../types/brush.ts'

export interface DetectedShape {
  type: 'line' | 'rectangle' | 'ellipse' | 'triangle'
  points: { x: number; y: number }[]
  confidence: number
}

/**
 * Post-stroke shape detection and snapping.
 * Analyzes raw stroke points to detect geometric shapes (line, rectangle, ellipse, triangle).
 * When detected with sufficient confidence, generates clean stamp positions along the shape outline.
 */
export class QuickShape {
  private readonly confidenceThreshold = 0.6

  /**
   * Attempt to detect a geometric shape from raw stroke points.
   * Returns null if no shape matches with sufficient confidence.
   */
  detect(points: { x: number; y: number }[]): DetectedShape | null {
    if (points.length < 3) return null

    // Try detection in priority order
    const line = this.detectLine(points)
    if (line && line.confidence >= this.confidenceThreshold) return line

    const triangle = this.detectTriangle(points)
    if (triangle && triangle.confidence >= this.confidenceThreshold) return triangle

    const rect = this.detectRectangle(points)
    if (rect && rect.confidence >= this.confidenceThreshold) return rect

    const ellipse = this.detectEllipse(points)
    if (ellipse && ellipse.confidence >= this.confidenceThreshold) return ellipse

    return null
  }

  /** Generate stamp positions along a detected shape outline. */
  generateShapeStamps(shape: DetectedShape, brushSize: number, spacing: number): StampPosition[] {
    const spacingPx = Math.max(1, brushSize * spacing)
    const stamps: StampPosition[] = []

    if (shape.type === 'line') {
      return this.generateLineStamps(shape.points[0], shape.points[1], brushSize, spacingPx)
    }

    if (shape.type === 'ellipse') {
      return this.generateEllipseStamps(shape.points, brushSize, spacingPx)
    }

    // Triangle and rectangle: walk the polygon edges
    const pts = shape.points
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      stamps.push(...this.generateLineStamps(a, b, brushSize, spacingPx))
    }
    return stamps
  }

  // ── Detection algorithms ─────────────────────────────────────────

  private detectLine(points: { x: number; y: number }[]): DetectedShape | null {
    const first = points[0]
    const last = points[points.length - 1]
    const lineLen = dist(first, last)
    if (lineLen < 10) return null

    // Max perpendicular distance from first→last line
    let maxDist = 0
    for (const p of points) {
      const d = perpendicularDist(p, first, last)
      if (d > maxDist) maxDist = d
    }

    // Threshold: 5% of line length
    const threshold = lineLen * 0.05
    if (maxDist > threshold) return null

    const confidence = 1 - maxDist / threshold
    return {
      type: 'line',
      points: [first, last],
      confidence: Math.min(1, confidence),
    }
  }

  private detectTriangle(points: { x: number; y: number }[]): DetectedShape | null {
    // Check that the path is "closed" (last point near first)
    const closeDist = dist(points[0], points[points.length - 1])
    const perimeter = pathLength(points)
    if (closeDist > perimeter * 0.15) return null

    // Use perimeter-based epsilon for closed shapes
    const epsilon = perimeter * 0.03
    const simplified = douglasPeucker(points, epsilon)
    // Should simplify to ~3 vertices (plus closing overlap = 3-5 points)
    if (simplified.length < 3 || simplified.length > 6) return null

    const vertices = simplified.slice(0, 3)

    // Measure how well the original points fit the triangle edges
    const rms = rmsDistToPolygon(points, vertices)
    const avgEdge = (dist(vertices[0], vertices[1]) + dist(vertices[1], vertices[2]) + dist(vertices[2], vertices[0])) / 3
    const fitRatio = rms / avgEdge

    if (fitRatio > 0.08) return null

    return {
      type: 'triangle',
      points: vertices,
      confidence: Math.min(1, 1 - fitRatio / 0.08),
    }
  }

  private detectRectangle(points: { x: number; y: number }[]): DetectedShape | null {
    // Check closure
    const closeDist = dist(points[0], points[points.length - 1])
    const perimeter = pathLength(points)
    if (closeDist > perimeter * 0.15) return null

    const epsilon = perimeter * 0.025
    const simplified = douglasPeucker(points, epsilon)
    if (simplified.length < 4 || simplified.length > 7) return null

    const vertices = simplified.slice(0, 4)

    // Check angles are ~90°
    let angleScore = 0
    for (let i = 0; i < 4; i++) {
      const a = vertices[i]
      const b = vertices[(i + 1) % 4]
      const c = vertices[(i + 2) % 4]
      const angle = angleBetween(a, b, c)
      const deviation = Math.abs(angle - Math.PI / 2)
      angleScore += deviation
    }
    const avgDeviation = angleScore / 4
    if (avgDeviation > 0.35) return null // ~20° tolerance

    // RMS fit
    const rms = rmsDistToPolygon(points, vertices)
    const avgEdge = pathLength(vertices.concat([vertices[0]])) / 4
    const fitRatio = rms / avgEdge
    if (fitRatio > 0.08) return null

    return {
      type: 'rectangle',
      points: vertices,
      confidence: Math.min(1, 1 - avgDeviation / 0.35),
    }
  }

  private detectEllipse(points: { x: number; y: number }[]): DetectedShape | null {
    // Check closure
    const closeDist = dist(points[0], points[points.length - 1])
    const perimeter = pathLength(points)
    if (closeDist > perimeter * 0.2) return null

    // Fit bounding box
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const p of points) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }

    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const rx = (maxX - minX) / 2
    const ry = (maxY - minY) / 2

    if (rx < 5 || ry < 5) return null

    // RMS distance from ideal ellipse
    let sumSq = 0
    for (const p of points) {
      const nx = (p.x - cx) / rx
      const ny = (p.y - cy) / ry
      const ellipDist = Math.abs(Math.sqrt(nx * nx + ny * ny) - 1)
      sumSq += ellipDist * ellipDist
    }
    const rms = Math.sqrt(sumSq / points.length)

    if (rms > 0.25) return null

    return {
      type: 'ellipse',
      points: [
        { x: cx, y: cy },  // center
        { x: rx, y: ry },  // radii (stored as point for convenience)
      ],
      confidence: Math.min(1, 1 - rms / 0.25),
    }
  }

  // ── Stamp generation ─────────────────────────────────────────────

  private generateLineStamps(
    a: { x: number; y: number },
    b: { x: number; y: number },
    brushSize: number,
    spacingPx: number,
  ): StampPosition[] {
    const stamps: StampPosition[] = []
    const len = dist(a, b)
    if (len < 1) return stamps

    const steps = Math.max(1, Math.floor(len / spacingPx))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      stamps.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        size: brushSize,
        opacity: 1,
        rotation: 0,
      })
    }
    return stamps
  }

  private generateEllipseStamps(
    pts: { x: number; y: number }[],
    brushSize: number,
    spacingPx: number,
  ): StampPosition[] {
    const stamps: StampPosition[] = []
    const cx = pts[0].x
    const cy = pts[0].y
    const rx = pts[1].x
    const ry = pts[1].y

    // Approximate perimeter (Ramanujan)
    const perimeter = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
    const steps = Math.max(12, Math.floor(perimeter / spacingPx))

    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2
      stamps.push({
        x: cx + rx * Math.cos(angle),
        y: cy + ry * Math.sin(angle),
        size: brushSize,
        opacity: 1,
        rotation: 0,
      })
    }
    return stamps
  }
}

// ── Utility functions ──────────────────────────────────────────────

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

/** Perpendicular distance from point p to line segment a→b. */
function perpendicularDist(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 0.001) return dist(p, a)
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len
}

/** Douglas-Peucker line simplification. */
function douglasPeucker(
  points: { x: number; y: number }[],
  epsilon: number,
): { x: number; y: number }[] {
  if (points.length <= 2) return points

  let maxDist = 0
  let maxIdx = 0
  const first = points[0]
  const last = points[points.length - 1]

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist(points[i], first, last)
    if (d > maxDist) {
      maxDist = d
      maxIdx = i
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon)
    const right = douglasPeucker(points.slice(maxIdx), epsilon)
    return left.slice(0, -1).concat(right)
  }

  return [first, last]
}

/** Total path length of a point sequence. */
function pathLength(points: { x: number; y: number }[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += dist(points[i - 1], points[i])
  }
  return total
}

/** Angle at vertex b between segments a→b and b→c. */
function angleBetween(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  const v1x = a.x - b.x
  const v1y = a.y - b.y
  const v2x = c.x - b.x
  const v2y = c.y - b.y
  const dot = v1x * v2x + v1y * v2y
  const cross = v1x * v2y - v1y * v2x
  return Math.abs(Math.atan2(cross, dot))
}

/** RMS distance from points to nearest polygon edge. */
function rmsDistToPolygon(
  points: { x: number; y: number }[],
  polygon: { x: number; y: number }[],
): number {
  let sumSq = 0
  for (const p of points) {
    let minD = Infinity
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]
      const b = polygon[(i + 1) % polygon.length]
      const d = pointToSegmentDist(p, a, b)
      if (d < minD) minD = d
    }
    sumSq += minD * minD
  }
  return Math.sqrt(sumSq / points.length)
}

/** Distance from point p to line segment a→b. */
function pointToSegmentDist(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 0.001) return dist(p, a)

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))

  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return dist(p, { x: projX, y: projY })
}
