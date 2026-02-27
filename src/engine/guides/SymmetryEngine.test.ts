import { describe, it, expect, beforeEach } from 'vitest'
import { SymmetryEngine } from './SymmetryEngine.ts'
import type { StampPosition } from '../../types/brush.ts'

function stamp(x: number, y: number): StampPosition {
  return { x, y, size: 10, opacity: 1, rotation: 0 }
}

describe('SymmetryEngine', () => {
  let engine: SymmetryEngine

  beforeEach(() => {
    engine = new SymmetryEngine()
    engine.centerX = 512
    engine.centerY = 384
    engine.axes = 6
    engine.rotation = 0
  })

  it('returns original stamps when disabled', () => {
    engine.enabled = false
    engine.type = 'vertical'
    const input = [stamp(100, 200)]
    const result = engine.getMirroredStamps(input)
    expect(result).toBe(input) // same reference
  })

  it('returns empty array for empty input', () => {
    engine.enabled = true
    engine.type = 'vertical'
    const result = engine.getMirroredStamps([])
    expect(result).toEqual([])
  })

  // ── Vertical ──

  it('vertical mirror: stamp (100,200) center=512 → mirror at (924,200)', () => {
    engine.enabled = true
    engine.type = 'vertical'
    const result = engine.getMirroredStamps([stamp(100, 200)])
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ x: 100, y: 200 })
    expect(result[1]).toMatchObject({ x: 924, y: 200 }) // 2*512 - 100 = 924
  })

  it('vertical mirror preserves stamp properties', () => {
    engine.enabled = true
    engine.type = 'vertical'
    const input = [{ x: 100, y: 200, size: 15, opacity: 0.7, rotation: 0.5 }]
    const result = engine.getMirroredStamps(input)
    expect(result[1].size).toBe(15)
    expect(result[1].opacity).toBe(0.7)
    expect(result[1].rotation).toBe(0.5)
  })

  it('vertical mirror: stamp at center stays in place', () => {
    engine.enabled = true
    engine.type = 'vertical'
    const result = engine.getMirroredStamps([stamp(512, 200)])
    expect(result[1].x).toBe(512) // 2*512 - 512 = 512
  })

  // ── Horizontal ──

  it('horizontal mirror: stamp (100,200) center=384 → mirror at (100,568)', () => {
    engine.enabled = true
    engine.type = 'horizontal'
    const result = engine.getMirroredStamps([stamp(100, 200)])
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ x: 100, y: 200 })
    expect(result[1]).toMatchObject({ x: 100, y: 568 }) // 2*384 - 200 = 568
  })

  // ── Quadrant ──

  it('quadrant: 1 stamp → 4 stamps', () => {
    engine.enabled = true
    engine.type = 'quadrant'
    const result = engine.getMirroredStamps([stamp(100, 200)])
    expect(result).toHaveLength(4)
    // Original
    expect(result[0]).toMatchObject({ x: 100, y: 200 })
    // Mirror vertical
    expect(result[1]).toMatchObject({ x: 924, y: 200 })
    // Mirror horizontal
    expect(result[2]).toMatchObject({ x: 100, y: 568 })
    // Mirror both
    expect(result[3]).toMatchObject({ x: 924, y: 568 })
  })

  it('quadrant: multiple stamps → 4x count', () => {
    engine.enabled = true
    engine.type = 'quadrant'
    const result = engine.getMirroredStamps([stamp(100, 200), stamp(150, 250)])
    expect(result).toHaveLength(8) // 2 * 4
  })

  // ── Radial ──

  it('radial 6-fold: 1 stamp → 6 stamps', () => {
    engine.enabled = true
    engine.type = 'radial'
    engine.axes = 6
    const result = engine.getMirroredStamps([stamp(100, 384)])
    expect(result).toHaveLength(6)
  })

  it('radial 2-fold: 1 stamp → 2 stamps (equivalent to 180° rotation)', () => {
    engine.enabled = true
    engine.type = 'radial'
    engine.axes = 2
    const result = engine.getMirroredStamps([stamp(100, 384)])
    expect(result).toHaveLength(2)
    // 180° rotation around center (512, 384): (100,384) → (924, 384)
    expect(result[1].x).toBeCloseTo(924, 5)
    expect(result[1].y).toBeCloseTo(384, 5)
  })

  it('radial 4-fold: positions are at 90° intervals', () => {
    engine.enabled = true
    engine.type = 'radial'
    engine.axes = 4
    // Point directly right of center
    const result = engine.getMirroredStamps([stamp(612, 384)])
    expect(result).toHaveLength(4)

    // Original: (612, 384) — 100px right of center
    expect(result[0].x).toBeCloseTo(612, 5)
    expect(result[0].y).toBeCloseTo(384, 5)

    // 90°: (512, 484) — 100px below center
    expect(result[1].x).toBeCloseTo(512, 5)
    expect(result[1].y).toBeCloseTo(484, 5)

    // 180°: (412, 384) — 100px left of center
    expect(result[2].x).toBeCloseTo(412, 5)
    expect(result[2].y).toBeCloseTo(384, 5)

    // 270°: (512, 284) — 100px above center
    expect(result[3].x).toBeCloseTo(512, 5)
    expect(result[3].y).toBeCloseTo(284, 5)
  })

  it('radial 1-fold: returns original only', () => {
    engine.enabled = true
    engine.type = 'radial'
    engine.axes = 1
    const result = engine.getMirroredStamps([stamp(100, 200)])
    expect(result).toHaveLength(1) // just the original
  })

  it('radial preserves stamp properties', () => {
    engine.enabled = true
    engine.type = 'radial'
    engine.axes = 3
    const input = [{ x: 600, y: 384, size: 20, opacity: 0.5, rotation: 1 }]
    const result = engine.getMirroredStamps(input)
    expect(result).toHaveLength(3)
    for (const s of result) {
      expect(s.size).toBe(20)
      expect(s.opacity).toBe(0.5)
      expect(s.rotation).toBe(1)
    }
  })

  // ── Multiple stamps ──

  it('handles multiple input stamps correctly', () => {
    engine.enabled = true
    engine.type = 'vertical'
    const result = engine.getMirroredStamps([stamp(100, 200), stamp(200, 300)])
    expect(result).toHaveLength(4)
    expect(result[2].x).toBe(924) // mirror of 100
    expect(result[3].x).toBe(824) // mirror of 200: 2*512 - 200 = 824
  })
})
