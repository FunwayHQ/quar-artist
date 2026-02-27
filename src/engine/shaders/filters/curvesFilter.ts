import type { CurvePoint, CurveChannel } from '@app-types/filter.ts'

/**
 * Compute a 256-entry LUT from curve control points using monotone cubic interpolation.
 * Returns a Float32Array of 256 values in [0, 1].
 */
export function computeSingleChannelLUT(points: CurvePoint[]): Float32Array {
  const lut = new Float32Array(256)

  if (points.length < 2) {
    // Identity
    for (let i = 0; i < 256; i++) lut[i] = i / 255
    return lut
  }

  // Sort by x
  const sorted = [...points].sort((a, b) => a.x - b.x)

  // Monotone cubic interpolation (Fritsch-Carlson)
  const n = sorted.length
  const xs = sorted.map((p) => p.x)
  const ys = sorted.map((p) => p.y / 255) // Normalize to 0-1

  // Compute slopes
  const dx: number[] = []
  const dy: number[] = []
  const m: number[] = new Array(n)

  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1] - xs[i])
    dy.push(ys[i + 1] - ys[i])
  }

  // Compute tangent slopes
  if (n === 2) {
    const slope = dx[0] !== 0 ? dy[0] / dx[0] : 0
    m[0] = slope
    m[1] = slope
  } else {
    // Interior points
    for (let i = 1; i < n - 1; i++) {
      const s0 = dx[i - 1] !== 0 ? dy[i - 1] / dx[i - 1] : 0
      const s1 = dx[i] !== 0 ? dy[i] / dx[i] : 0
      m[i] = (s0 + s1) / 2
    }
    // Endpoints
    m[0] = dx[0] !== 0 ? dy[0] / dx[0] : 0
    m[n - 1] = dx[n - 2] !== 0 ? dy[n - 2] / dx[n - 2] : 0

    // Monotonicity constraints
    for (let i = 0; i < n - 1; i++) {
      const s = dx[i] !== 0 ? dy[i] / dx[i] : 0
      if (Math.abs(s) < 1e-10) {
        m[i] = 0
        m[i + 1] = 0
      } else {
        const a = m[i] / s
        const b = m[i + 1] / s
        const h = Math.sqrt(a * a + b * b)
        if (h > 3) {
          const t = 3 / h
          m[i] = t * a * s
          m[i + 1] = t * b * s
        }
      }
    }
  }

  // Interpolate
  for (let x = 0; x < 256; x++) {
    if (x <= xs[0]) {
      lut[x] = ys[0]
    } else if (x >= xs[n - 1]) {
      lut[x] = ys[n - 1]
    } else {
      // Find segment
      let seg = 0
      for (let i = 0; i < n - 1; i++) {
        if (x >= xs[i] && x < xs[i + 1]) {
          seg = i
          break
        }
      }
      const h = dx[seg]
      if (h === 0) {
        lut[x] = ys[seg]
      } else {
        const t = (x - xs[seg]) / h
        const t2 = t * t
        const t3 = t2 * t
        // Hermite basis
        const h00 = 2 * t3 - 3 * t2 + 1
        const h10 = t3 - 2 * t2 + t
        const h01 = -2 * t3 + 3 * t2
        const h11 = t3 - t2
        lut[x] = h00 * ys[seg] + h10 * h * m[seg] + h01 * ys[seg + 1] + h11 * h * m[seg + 1]
      }
    }
    // Clamp
    lut[x] = Math.max(0, Math.min(1, lut[x]))
  }

  return lut
}

/**
 * CPU-based curves application using precomputed LUTs.
 * Applies per-channel curves (R, G, B) then master RGB curve.
 *
 * Custom GLSL shaders don't auto-transpile to WGSL on PixiJS v8 WebGPU,
 * so we perform curves computation on CPU instead.
 */
export function cpuApplyCurves(
  pixels: Uint8Array,
  channels: Record<CurveChannel, CurvePoint[]>,
): Uint8Array {
  const rgbLUT = computeSingleChannelLUT(channels.rgb)
  const redLUT = computeSingleChannelLUT(channels.red)
  const greenLUT = computeSingleChannelLUT(channels.green)
  const blueLUT = computeSingleChannelLUT(channels.blue)

  const result = new Uint8Array(pixels.length)

  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]
    if (a === 0) {
      result[i] = 0
      result[i + 1] = 0
      result[i + 2] = 0
      result[i + 3] = 0
      continue
    }

    // Unpremultiply (PixiJS textures store premultiplied alpha)
    const invA = 255 / a
    let r = Math.min(255, Math.round(pixels[i] * invA))
    let g = Math.min(255, Math.round(pixels[i + 1] * invA))
    let b = Math.min(255, Math.round(pixels[i + 2] * invA))

    // Apply per-channel curves
    r = Math.round(redLUT[r] * 255)
    g = Math.round(greenLUT[g] * 255)
    b = Math.round(blueLUT[b] * 255)

    // Apply master RGB curve
    r = Math.round(rgbLUT[r] * 255)
    g = Math.round(rgbLUT[g] * 255)
    b = Math.round(rgbLUT[b] * 255)

    // Premultiply back
    const af = a / 255
    result[i] = Math.round(r * af)
    result[i + 1] = Math.round(g * af)
    result[i + 2] = Math.round(b * af)
    result[i + 3] = a
  }

  return result
}
