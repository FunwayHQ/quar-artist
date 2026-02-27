import { describe, it, expect } from 'vitest'
import { evaluatePressureCurve, LINEAR_CURVE } from './PressureCurve.ts'

describe('PressureCurve', () => {
  it('linear curve returns identity mapping', () => {
    expect(evaluatePressureCurve(0, LINEAR_CURVE)).toBeCloseTo(0, 3)
    expect(evaluatePressureCurve(0.25, LINEAR_CURVE)).toBeCloseTo(0.25, 2)
    expect(evaluatePressureCurve(0.5, LINEAR_CURVE)).toBeCloseTo(0.5, 2)
    expect(evaluatePressureCurve(0.75, LINEAR_CURVE)).toBeCloseTo(0.75, 2)
    expect(evaluatePressureCurve(1, LINEAR_CURVE)).toBeCloseTo(1, 3)
  })

  it('clamps input to [0, 1]', () => {
    expect(evaluatePressureCurve(-0.5, LINEAR_CURVE)).toBe(0)
    expect(evaluatePressureCurve(1.5, LINEAR_CURVE)).toBe(1)
  })

  it('heavy curve (early output) returns high values for low input', () => {
    // Control points push the curve up early
    const heavyCurve: [number, number, number, number] = [0.1, 0.9, 0.1, 0.9]
    const result = evaluatePressureCurve(0.25, heavyCurve)
    expect(result).toBeGreaterThan(0.5)
  })

  it('light curve (late output) returns low values for low input', () => {
    // Control points push the curve down
    const lightCurve: [number, number, number, number] = [0.9, 0.1, 0.9, 0.1]
    const result = evaluatePressureCurve(0.25, lightCurve)
    expect(result).toBeLessThan(0.15)
  })

  it('all-zero control points stay within [0, 1]', () => {
    const result = evaluatePressureCurve(0.5, [0, 0, 0, 0])
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(1)
  })

  it('all-one control points stay within [0, 1]', () => {
    const result = evaluatePressureCurve(0.5, [1, 1, 1, 1])
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(1)
  })

  it('midpoint evaluation with default curve', () => {
    const result = evaluatePressureCurve(0.5, LINEAR_CURVE)
    expect(result).toBeCloseTo(0.5, 1)
  })
})
