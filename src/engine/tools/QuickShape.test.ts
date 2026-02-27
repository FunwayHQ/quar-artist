import { describe, it, expect } from 'vitest'
import { QuickShape } from './QuickShape.ts'

describe('QuickShape', () => {
  const qs = new QuickShape()

  // ── Line detection ──

  it('detects a straight line from collinear points', () => {
    const points = []
    for (let i = 0; i <= 20; i++) {
      points.push({ x: i * 10, y: i * 5 })
    }
    const result = qs.detect(points)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('line')
    expect(result!.confidence).toBeGreaterThan(0.6)
    expect(result!.points).toHaveLength(2)
  })

  it('detects a nearly-straight line with slight noise', () => {
    const points = []
    for (let i = 0; i <= 30; i++) {
      points.push({
        x: i * 10,
        y: 100 + (i % 2 === 0 ? 1 : -1), // +-1px noise
      })
    }
    const result = qs.detect(points)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('line')
  })

  // ── Ellipse detection ──

  it('detects an ellipse from circular points', () => {
    const points = []
    const cx = 200, cy = 200, rx = 80, ry = 60
    for (let i = 0; i <= 50; i++) {
      const angle = (i / 50) * Math.PI * 2
      points.push({
        x: cx + rx * Math.cos(angle),
        y: cy + ry * Math.sin(angle),
      })
    }
    const result = qs.detect(points)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('ellipse')
    expect(result!.confidence).toBeGreaterThan(0.6)
    // Center should be close to (200, 200)
    expect(result!.points[0].x).toBeCloseTo(cx, 0)
    expect(result!.points[0].y).toBeCloseTo(cy, 0)
  })

  it('detects a circle as an ellipse', () => {
    const points = []
    const cx = 300, cy = 300, r = 100
    for (let i = 0; i <= 40; i++) {
      const angle = (i / 40) * Math.PI * 2
      points.push({
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
      })
    }
    const result = qs.detect(points)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('ellipse')
    // Radii should be roughly equal
    expect(Math.abs(result!.points[1].x - result!.points[1].y)).toBeLessThan(5)
  })

  // ── Rectangle detection ──

  it('detects a rectangle from 4-corner path', () => {
    // Draw a rectangle path: top-left → top-right → bottom-right → bottom-left → close
    const rect = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 200 },
      { x: 100, y: 200 },
      { x: 100, y: 100 }, // close back
    ]
    // Interpolate between corners to simulate drawing
    const points: { x: number; y: number }[] = []
    for (let i = 0; i < rect.length - 1; i++) {
      const a = rect[i], b = rect[i + 1]
      for (let t = 0; t < 10; t++) {
        points.push({
          x: a.x + (b.x - a.x) * (t / 10),
          y: a.y + (b.y - a.y) * (t / 10),
        })
      }
    }
    points.push(rect[rect.length - 1])

    const result = qs.detect(points)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('rectangle')
    expect(result!.confidence).toBeGreaterThan(0.6)
    expect(result!.points).toHaveLength(4)
  })

  // ── Triangle detection ──

  it('detects a triangle from 3-corner path', () => {
    const tri = [
      { x: 200, y: 100 },
      { x: 350, y: 300 },
      { x: 50, y: 300 },
      { x: 200, y: 100 }, // close
    ]
    const points: { x: number; y: number }[] = []
    for (let i = 0; i < tri.length - 1; i++) {
      const a = tri[i], b = tri[i + 1]
      for (let t = 0; t < 15; t++) {
        points.push({
          x: a.x + (b.x - a.x) * (t / 15),
          y: a.y + (b.y - a.y) * (t / 15),
        })
      }
    }
    points.push(tri[tri.length - 1])

    const result = qs.detect(points)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('triangle')
    expect(result!.confidence).toBeGreaterThan(0.6)
    expect(result!.points).toHaveLength(3)
  })

  // ── No detection ──

  it('returns null for random scribble', () => {
    // Random zigzag pattern that doesn't match any shape
    const points = []
    for (let i = 0; i < 40; i++) {
      points.push({
        x: i * 8 + Math.sin(i * 1.7) * 40,
        y: 200 + Math.cos(i * 2.3) * 80 + Math.sin(i * 0.5) * 30,
      })
    }
    const result = qs.detect(points)
    expect(result).toBeNull()
  })

  it('returns null for too few points', () => {
    const result = qs.detect([{ x: 0, y: 0 }, { x: 10, y: 10 }])
    expect(result).toBeNull()
  })

  // ── Stamp generation ──

  it('generateShapeStamps produces stamps for a line', () => {
    const shape = {
      type: 'line' as const,
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      confidence: 1,
    }
    const stamps = qs.generateShapeStamps(shape, 10, 0.2)
    expect(stamps.length).toBeGreaterThan(0)
    // All stamps should be on the x-axis
    for (const s of stamps) {
      expect(s.y).toBe(0)
      expect(s.x).toBeGreaterThanOrEqual(0)
      expect(s.x).toBeLessThanOrEqual(100)
    }
  })

  it('generateShapeStamps produces stamps for an ellipse', () => {
    const shape = {
      type: 'ellipse' as const,
      points: [{ x: 200, y: 200 }, { x: 80, y: 60 }], // center + radii
      confidence: 1,
    }
    const stamps = qs.generateShapeStamps(shape, 5, 0.2)
    expect(stamps.length).toBeGreaterThan(10) // should have many stamps around perimeter
    // All stamps should be approximately on the ellipse perimeter
    for (const s of stamps) {
      const nx = (s.x - 200) / 80
      const ny = (s.y - 200) / 60
      const ellipVal = Math.sqrt(nx * nx + ny * ny)
      expect(ellipVal).toBeCloseTo(1, 0) // should be on perimeter
    }
  })

  it('generateShapeStamps produces stamps for a rectangle', () => {
    const shape = {
      type: 'rectangle' as const,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
        { x: 0, y: 50 },
      ],
      confidence: 1,
    }
    const stamps = qs.generateShapeStamps(shape, 5, 0.2)
    expect(stamps.length).toBeGreaterThan(0)
  })

  it('generateShapeStamps produces stamps for a triangle', () => {
    const shape = {
      type: 'triangle' as const,
      points: [
        { x: 100, y: 0 },
        { x: 200, y: 200 },
        { x: 0, y: 200 },
      ],
      confidence: 1,
    }
    const stamps = qs.generateShapeStamps(shape, 5, 0.2)
    expect(stamps.length).toBeGreaterThan(0)
  })
})
