/**
 * Pressure curve evaluation using cubic Bezier.
 * The curve goes from (0,0) to (1,1) with 2 control points.
 * Curve format: [cp1x, cp1y, cp2x, cp2y]
 * Default [0.25, 0.25, 0.75, 0.75] = linear (identity mapping).
 */

export type PressureCurvePoints = [number, number, number, number]

export const LINEAR_CURVE: PressureCurvePoints = [0.25, 0.25, 0.75, 0.75]

/**
 * Evaluate a cubic Bezier y for a given x using De Casteljau + binary search.
 * P0 = (0,0), P1 = (cp1x, cp1y), P2 = (cp2x, cp2y), P3 = (1,1)
 */
export function evaluatePressureCurve(
  inputPressure: number,
  curve: PressureCurvePoints,
): number {
  const x = Math.max(0, Math.min(1, inputPressure))

  // Fast path for endpoints
  if (x <= 0) return 0
  if (x >= 1) return 1

  const [cp1x, cp1y, cp2x, cp2y] = curve

  // Binary search for t where bezierX(t) ≈ x
  let lo = 0
  let hi = 1
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    const bx = cubicBezier(mid, 0, cp1x, cp2x, 1)
    if (bx < x) {
      lo = mid
    } else {
      hi = mid
    }
  }

  const t = (lo + hi) / 2
  return cubicBezier(t, 0, cp1y, cp2y, 1)
}

/** Evaluate cubic Bezier at t with control points p0, p1, p2, p3. */
function cubicBezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3
}
