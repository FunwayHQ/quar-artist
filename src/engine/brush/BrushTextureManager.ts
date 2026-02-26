import type { ShapeTextureId, GrainTextureId } from '../../types/brush.ts'

const SHAPE_SIZE = 128
const GRAIN_SIZE = 256

/**
 * Procedurally generates and caches brush textures.
 * Shape textures define stamp silhouettes (128x128 alpha maps).
 * Grain textures modulate stamp opacity for surface effects (256x256 alpha maps).
 *
 * Pure CPU — no PixiJS dependency. Textures are Uint8Array alpha maps.
 */
export class BrushTextureManager {
  private shapeCache = new Map<ShapeTextureId, Uint8Array>()
  private grainCache = new Map<GrainTextureId, Uint8Array>()

  /** Get a shape texture alpha map (128x128), generating if needed. */
  getShape(id: ShapeTextureId): Uint8Array {
    let tex = this.shapeCache.get(id)
    if (!tex) {
      tex = generateShape(id)
      this.shapeCache.set(id, tex)
    }
    return tex
  }

  /** Get a grain texture alpha map (256x256), generating if needed. */
  getGrain(id: GrainTextureId): Uint8Array {
    let tex = this.grainCache.get(id)
    if (!tex) {
      tex = generateGrain(id)
      this.grainCache.set(id, tex)
    }
    return tex
  }

  getShapeSize(): number {
    return SHAPE_SIZE
  }

  getGrainSize(): number {
    return GRAIN_SIZE
  }

  clear() {
    this.shapeCache.clear()
    this.grainCache.clear()
  }
}

// ── Shape texture generators ──────────────────────────────────────────

function generateShape(id: ShapeTextureId): Uint8Array {
  const s = SHAPE_SIZE
  const data = new Uint8Array(s * s)
  const cx = s / 2
  const cy = s / 2
  const r = s / 2 - 1

  switch (id) {
    case 'hard-round': {
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
          // Hard edge with 1.5px anti-alias
          data[y * s + x] = d <= r - 1.5 ? 255 : d <= r ? Math.round(255 * (r - d) / 1.5) : 0
        }
      }
      break
    }

    case 'soft-round': {
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
          data[y * s + x] = d <= 1 ? Math.round(255 * Math.exp(-d * d * 3)) : 0
        }
      }
      break
    }

    case 'pencil-grain': {
      const rng = seededRandom(42)
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
          if (d > 1) { data[y * s + x] = 0; continue }
          const edge = 1 - Math.pow(d, 0.8)
          const noise = 0.6 + 0.4 * rng()
          data[y * s + x] = Math.round(255 * edge * noise)
        }
      }
      break
    }

    case 'ink-splatter': {
      const rng = seededRandom(7)
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
          if (d > 1) { data[y * s + x] = 0; continue }
          // Irregular edge: high in center, random falloff near edge
          const edgeThreshold = 0.7 + 0.3 * rng()
          const value = d < edgeThreshold ? 255 : Math.round(255 * Math.max(0, (1 - d) / (1 - edgeThreshold)))
          data[y * s + x] = value
        }
      }
      break
    }

    case 'watercolor-bleed': {
      const rng = seededRandom(99)
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
          if (d > 1.1) { data[y * s + x] = 0; continue }
          // Soft center with watery edges
          const base = Math.exp(-d * d * 2)
          const bleed = d > 0.6 ? (0.3 + 0.7 * rng()) * (1 - d) : 1
          data[y * s + x] = Math.round(255 * Math.min(1, base * bleed))
        }
      }
      break
    }

    case 'oil-bristle': {
      const rng = seededRandom(13)
      // Create bristle-like parallel lines
      const bristleCount = 8
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
          if (d > 1) { data[y * s + x] = 0; continue }
          // Bristle pattern: sine wave across x
          const bristle = Math.abs(Math.sin((x / s) * Math.PI * bristleCount))
          const edge = 1 - d * d
          const noise = 0.8 + 0.2 * rng()
          data[y * s + x] = Math.round(255 * Math.pow(bristle, 0.5) * edge * noise)
        }
      }
      break
    }

    case 'marker-flat': {
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          // Rounded rectangle shape
          const dx = Math.abs(x - cx) / (r * 0.9)
          const dy = Math.abs(y - cy) / (r * 0.6)
          const d = Math.max(dx, dy)
          data[y * s + x] = d <= 0.85 ? 255 : d <= 1 ? Math.round(255 * (1 - d) / 0.15) : 0
        }
      }
      break
    }

    case 'pastel-rough': {
      const rng = seededRandom(55)
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
          if (d > 1) { data[y * s + x] = 0; continue }
          const edge = Math.exp(-d * d * 1.5)
          // Heavy grain noise for rough texture
          const noise = 0.3 + 0.7 * rng()
          data[y * s + x] = Math.round(255 * edge * noise)
        }
      }
      break
    }

    case 'charcoal-grain': {
      const rng = seededRandom(33)
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
          if (d > 1) { data[y * s + x] = 0; continue }
          const edge = 1 - d
          // Very noisy with gaps
          const noise = rng()
          const threshold = 0.2 + 0.6 * d
          data[y * s + x] = noise > threshold ? Math.round(255 * edge) : 0
        }
      }
      break
    }

    case 'smudge-soft': {
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
          // Very soft Gaussian
          data[y * s + x] = d <= 1.2 ? Math.round(255 * Math.exp(-d * d * 4)) : 0
        }
      }
      break
    }

    case 'flat-square': {
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const dx = Math.abs(x - cx) / r
          const dy = Math.abs(y - cy) / r
          const d = Math.max(dx, dy)
          data[y * s + x] = d <= 0.9 ? 255 : d <= 1 ? Math.round(255 * (1 - d) / 0.1) : 0
        }
      }
      break
    }

    case 'airbrush-gradient': {
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
          // Very gradual falloff
          data[y * s + x] = d <= 1 ? Math.round(255 * (1 - d * d)) : 0
        }
      }
      break
    }
  }

  return data
}

// ── Grain texture generators ──────────────────────────────────────────

function generateGrain(id: GrainTextureId): Uint8Array {
  const s = GRAIN_SIZE
  const data = new Uint8Array(s * s)

  switch (id) {
    case 'paper-fine': {
      const rng = seededRandom(101)
      for (let i = 0; i < s * s; i++) {
        // Fine grain: mostly white with small dark specks
        data[i] = Math.round(200 + 55 * rng())
      }
      break
    }

    case 'paper-rough': {
      const rng = seededRandom(202)
      // Two-octave noise for rougher texture
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const n1 = rng()
          const n2 = rng()
          data[y * s + x] = Math.round(128 + 64 * n1 + 63 * n2)
        }
      }
      break
    }

    case 'canvas-weave': {
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          // Cross-hatch pattern with slight variation
          const hLine = Math.abs(Math.sin((y / s) * Math.PI * 32))
          const vLine = Math.abs(Math.sin((x / s) * Math.PI * 32))
          const weave = Math.max(hLine, vLine)
          data[y * s + x] = Math.round(160 + 95 * weave)
        }
      }
      break
    }

    case 'noise-perlin': {
      // Simplified value noise (smooth interpolation between random grid)
      const gridSize = 16
      const rng = seededRandom(303)
      const grid: number[] = []
      for (let i = 0; i < (gridSize + 1) * (gridSize + 1); i++) {
        grid.push(rng())
      }

      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const gx = (x / s) * gridSize
          const gy = (y / s) * gridSize
          const ix = Math.floor(gx)
          const iy = Math.floor(gy)
          const fx = gx - ix
          const fy = gy - iy

          // Bilinear interpolation of grid values
          const g00 = grid[iy * (gridSize + 1) + ix]
          const g10 = grid[iy * (gridSize + 1) + ix + 1]
          const g01 = grid[(iy + 1) * (gridSize + 1) + ix]
          const g11 = grid[(iy + 1) * (gridSize + 1) + ix + 1]

          // Smoothstep interpolation
          const sx = fx * fx * (3 - 2 * fx)
          const sy = fy * fy * (3 - 2 * fy)

          const top = g00 + (g10 - g00) * sx
          const bot = g01 + (g11 - g01) * sx
          const value = top + (bot - top) * sy

          data[y * s + x] = Math.round(128 + 127 * (value * 2 - 1))
        }
      }
      break
    }
  }

  return data
}

// ── Deterministic pseudo-random number generator ──────────────────────

function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}
