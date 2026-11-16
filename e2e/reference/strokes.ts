/**
 * Helpers for stroke tests: a seeded random generator, stroke paths, and the
 * distance from a pixel to a path, used to tell a stroke's core (fully
 * covered) from the area it must not touch.
 */
import type { PointInput } from '../harness/protocol.ts'

/** Deterministic random numbers in [0, 1) (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A random walk of `count` points that stays `margin` pixels inside a
 * `width`×`height` document, with steps of 3–8 pixels.
 */
export function randomStroke(
  random: () => number,
  options: { width: number; height: number; count: number; margin: number },
): PointInput[] {
  const { width, height, count, margin } = options
  const clampX = (v: number) => Math.min(width - margin, Math.max(margin, v))
  const clampY = (v: number) => Math.min(height - margin, Math.max(margin, v))
  let x = margin + random() * (width - 2 * margin)
  let y = margin + random() * (height - 2 * margin)
  let angle = random() * Math.PI * 2
  const points: PointInput[] = []
  for (let i = 0; i < count; i++) {
    points.push({ x: Math.round(x), y: Math.round(y) })
    angle += (random() - 0.5) * 1.2
    const step = 3 + random() * 5
    x = clampX(x + Math.cos(angle) * step)
    y = clampY(y + Math.sin(angle) * step)
  }
  return points
}

/** Straight line from `from` to `to`, sampled every `step` pixels. */
export function line(from: PointInput, to: PointInput, step = 2): PointInput[] {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  const n = Math.max(1, Math.ceil(length / step))
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / n,
    y: from.y + ((to.y - from.y) * i) / n,
  }))
}

/** Distance from the centre of pixel (px, py) to the polyline through `points`. */
export function distanceToPath(px: number, py: number, points: PointInput[]): number {
  const x = px + 0.5
  const y = py + 0.5
  if (points.length === 1) return Math.hypot(x - points[0].x, y - points[0].y)
  let best = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSq = dx * dx + dy * dy
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq))
    best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)))
  }
  return best
}
