import { describe, it, expect, beforeEach } from 'vitest'
import { StrokeSmoother } from './StrokeSmoother.ts'
import type { StrokePoint } from '../../types/brush.ts'

function point(x: number, y: number, pressure = 0.5): StrokePoint {
  return { x, y, pressure, tiltX: 0, tiltY: 0, timestamp: 0 }
}

describe('StrokeSmoother', () => {
  let smoother: StrokeSmoother

  beforeEach(() => {
    smoother = new StrokeSmoother(0.5)
  })

  it('returns first point unchanged', () => {
    const p = point(100, 200)
    const result = smoother.smooth(p)
    expect(result.x).toBe(100)
    expect(result.y).toBe(200)
  })

  it('smooths subsequent points towards the new position', () => {
    smoother.smooth(point(0, 0))
    const result = smoother.smooth(point(100, 100))
    // With alpha=0.5: smoothed = 0.5*100 + 0.5*0 = 50
    expect(result.x).toBeCloseTo(50)
    expect(result.y).toBeCloseTo(50)
  })

  it('high alpha (near 1) gives minimal smoothing', () => {
    smoother.setAlpha(0.99)
    smoother.smooth(point(0, 0))
    const result = smoother.smooth(point(100, 100))
    expect(result.x).toBeCloseTo(99, 0)
    expect(result.y).toBeCloseTo(99, 0)
  })

  it('low alpha gives heavy smoothing', () => {
    smoother.setAlpha(0.1)
    smoother.smooth(point(0, 0))
    const result = smoother.smooth(point(100, 100))
    expect(result.x).toBeCloseTo(10)
    expect(result.y).toBeCloseTo(10)
  })

  it('smooths pressure values', () => {
    smoother.smooth(point(0, 0, 0))
    const result = smoother.smooth(point(0, 0, 1))
    expect(result.pressure).toBeCloseTo(0.5)
  })

  it('reset clears previous state', () => {
    smoother.smooth(point(100, 100))
    smoother.reset()
    const result = smoother.smooth(point(200, 200))
    // After reset, first point again — should be returned unchanged
    expect(result.x).toBe(200)
    expect(result.y).toBe(200)
  })

  it('smoothAll processes an array of points', () => {
    const points = [point(0, 0), point(100, 100), point(200, 200)]
    const results = smoother.smoothAll(points)
    expect(results).toHaveLength(3)
    // First point: unchanged
    expect(results[0].x).toBe(0)
    // Second point: smoothed
    expect(results[1].x).toBeCloseTo(50)
    // Third point: further smoothed towards 200
    expect(results[2].x).toBeGreaterThan(50)
    expect(results[2].x).toBeLessThan(200)
  })

  it('clamps alpha to [0.01, 1]', () => {
    smoother.setAlpha(-5)
    smoother.smooth(point(0, 0))
    const result = smoother.smooth(point(100, 0))
    // Alpha clamped to 0.01 => heavy smoothing
    expect(result.x).toBeCloseTo(1, 0)

    smoother.reset()
    smoother.setAlpha(10)
    smoother.smooth(point(0, 0))
    const result2 = smoother.smooth(point(100, 0))
    // Alpha clamped to 1 => no smoothing
    expect(result2.x).toBeCloseTo(100)
  })
})
