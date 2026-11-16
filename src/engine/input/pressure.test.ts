import { describe, it, expect } from 'vitest'
import { strokePressure } from './pressure.ts'

describe('strokePressure', () => {
  it("keeps a pen's pressure, including 0 as it lifts off", () => {
    expect(strokePressure({ pointerType: 'pen', pressure: 0.73 })).toBe(0.73)
    expect(strokePressure({ pointerType: 'pen', pressure: 0 })).toBe(0)
  })

  it('paints input without pressure sensing at 0.5', () => {
    expect(strokePressure({ pointerType: 'mouse', pressure: 0 })).toBe(0.5)
    expect(strokePressure({ pointerType: 'mouse', pressure: 0.5 })).toBe(0.5)
    expect(strokePressure({ pointerType: 'touch', pressure: 0 })).toBe(0.5)
  })

  it('keeps real touch pressure', () => {
    expect(strokePressure({ pointerType: 'touch', pressure: 0.3 })).toBe(0.3)
  })
})
