import { describe, it, expect, beforeEach } from 'vitest'
import { PathInterpolator } from './PathInterpolator.ts'
import type { StrokePoint, BrushPreset } from '../../types/brush.ts'

const testPreset: BrushPreset = {
  id: 'test',
  name: 'Test',
  size: 20,
  minSize: 5,
  maxSize: 50,
  opacity: 1,
  spacing: 0.25,
  hardness: 1,
  smoothing: 0,
  pressureSizeEnabled: true,
  pressureOpacityEnabled: false,
  isEraser: false,
}

function point(x: number, y: number, pressure = 0.5): StrokePoint {
  return { x, y, pressure, tiltX: 0, tiltY: 0, timestamp: 0 }
}

describe('PathInterpolator', () => {
  let interp: PathInterpolator

  beforeEach(() => {
    interp = new PathInterpolator()
  })

  it('returns one stamp for the first point', () => {
    const stamps = interp.addPoint(point(100, 100), testPreset)
    expect(stamps).toHaveLength(1)
    expect(stamps[0].x).toBe(100)
    expect(stamps[0].y).toBe(100)
  })

  it('generates stamps between distant points', () => {
    interp.addPoint(point(0, 0), testPreset)
    const stamps = interp.addPoint(point(100, 0), testPreset)
    // With spacing 0.25 of size 20 = 5px spacing over 100px distance = ~20 stamps
    expect(stamps.length).toBeGreaterThan(5)
  })

  it('generates fewer stamps for close points', () => {
    interp.addPoint(point(0, 0), testPreset)
    const stamps = interp.addPoint(point(2, 0), testPreset)
    // Very short distance — may produce 0 stamps (under spacing threshold)
    expect(stamps.length).toBeLessThanOrEqual(2)
  })

  it('stamp size reflects pressure when pressureSizeEnabled', () => {
    interp.addPoint(point(0, 0, 1.0), testPreset)
    const stamps = interp.addPoint(point(50, 0, 1.0), testPreset)
    if (stamps.length > 0) {
      // Full pressure: size = 20 * (0.2 + 0.8*1.0) = 20
      expect(stamps[0].size).toBeCloseTo(20, 0)
    }
  })

  it('stamp size is smaller at low pressure', () => {
    interp.addPoint(point(0, 0, 0.1), testPreset)
    const stamps = interp.addPoint(point(50, 0, 0.1), testPreset)
    if (stamps.length > 0) {
      // Low pressure: size = 20 * (0.2 + 0.8*0.1) = 20 * 0.28 = 5.6
      expect(stamps[0].size).toBeLessThan(10)
    }
  })

  it('reset clears accumulated state', () => {
    interp.addPoint(point(0, 0), testPreset)
    interp.addPoint(point(100, 0), testPreset)
    interp.reset()
    const stamps = interp.addPoint(point(200, 200), testPreset)
    expect(stamps).toHaveLength(1) // First point again
  })

  it('stamp opacity respects preset opacity', () => {
    const lowOpacityPreset = { ...testPreset, opacity: 0.3, pressureOpacityEnabled: false }
    const stamps = interp.addPoint(point(100, 100), lowOpacityPreset)
    expect(stamps[0].opacity).toBeCloseTo(0.3)
  })
})
