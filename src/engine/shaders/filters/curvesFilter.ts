import { Filter, GlProgram, Texture } from 'pixi.js'
import type { CurvePoint, CurveChannel } from '@app-types/filter.ts'

const VERTEX = `
  in vec2 aPosition;
  in vec2 aUV;
  out vec2 vTextureCoord;

  uniform vec4 uInputSize;
  uniform vec4 uOutputFrame;
  uniform vec4 uOutputTexture;

  vec4 filterVertexPosition(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
  }

  vec2 filterTextureCoord(void) {
    return aUV * (uOutputFrame.zw * uInputSize.zw);
  }

  void main(void) {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
  }
`

/**
 * LUT-based curves filter.
 * uLutTexture is 256x4: row 0=RGB master, row 1=Red, row 2=Green, row 3=Blue.
 * Each pixel's R channel holds the remapped value.
 */
const FRAGMENT = `
  in vec2 vTextureCoord;
  out vec4 finalColor;

  uniform sampler2D uTexture;
  uniform sampler2D uLutTexture;

  void main(void) {
    vec4 color = texture(uTexture, vTextureCoord);
    if (color.a < 0.001) {
      finalColor = color;
      return;
    }

    // Unpremultiply
    vec3 rgb = color.rgb / color.a;

    // Apply per-channel curves (rows 1,2,3 of LUT)
    float r = texture(uLutTexture, vec2(rgb.r, 0.375)).r; // row 1 center = 1.5/4
    float g = texture(uLutTexture, vec2(rgb.g, 0.625)).r; // row 2 center = 2.5/4
    float b = texture(uLutTexture, vec2(rgb.b, 0.875)).r; // row 3 center = 3.5/4

    // Apply master RGB curve (row 0)
    r = texture(uLutTexture, vec2(r, 0.125)).r; // row 0 center = 0.5/4
    g = texture(uLutTexture, vec2(g, 0.125)).r;
    b = texture(uLutTexture, vec2(b, 0.125)).r;

    // Premultiply
    finalColor = vec4(vec3(r, g, b) * color.a, color.a);
  }
`

// Note: Custom WGSL shaders removed — PixiJS v8's WebGPU pipeline vertex buffer
// layout is incompatible with custom vertex shaders. Filters use GlProgram only.

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
 * Compute the full curves LUT texture data (256x4 RGBA).
 * Row order: RGB master, Red, Green, Blue.
 */
export function computeCurvesLUT(channels: Record<CurveChannel, CurvePoint[]>): Uint8Array {
  const rgbLUT = computeSingleChannelLUT(channels.rgb)
  const redLUT = computeSingleChannelLUT(channels.red)
  const greenLUT = computeSingleChannelLUT(channels.green)
  const blueLUT = computeSingleChannelLUT(channels.blue)

  // Pack into 256x4 RGBA texture
  const data = new Uint8Array(256 * 4 * 4) // 256 wide, 4 rows, 4 channels (RGBA)

  const luts = [rgbLUT, redLUT, greenLUT, blueLUT]
  for (let row = 0; row < 4; row++) {
    const lut = luts[row]
    for (let x = 0; x < 256; x++) {
      const idx = (row * 256 + x) * 4
      const val = Math.round(lut[x] * 255)
      data[idx] = val // R
      data[idx + 1] = val // G
      data[idx + 2] = val // B
      data[idx + 3] = 255 // A
    }
  }

  return data
}

/** Create a curves filter with a pre-computed LUT texture. */
export function createCurvesFilter(lutTexture: Texture): Filter {
  const glProgram = GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT })

  return new Filter({
    glProgram,
    resources: {
      curvesUniforms: {
        uLutTexture: { value: lutTexture, type: 'f32' },
      },
    },
  })
}

/** Create a LUT texture from curve channel data. */
export function createLUTTexture(channels: Record<CurveChannel, CurvePoint[]>): Texture {
  const data = computeCurvesLUT(channels)
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 4
  const ctx = canvas.getContext('2d')!
  const imageData = new ImageData(new Uint8ClampedArray(data.buffer), 256, 4)
  ctx.putImageData(imageData, 0, 0)
  return Texture.from(canvas)
}
