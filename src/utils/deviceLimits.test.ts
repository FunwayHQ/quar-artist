import { describe, it, expect } from 'vitest'
import { canvasSizeProblem, isMobileDevice, maxCanvasSide } from './deviceLimits.ts'

const nav = (userAgent: string, maxTouchPoints = 0) => ({ userAgent, maxTouchPoints })

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36'

describe('isMobileDevice', () => {
  it('recognises phones and Android tablets', () => {
    expect(isMobileDevice(nav(IPHONE, 5))).toBe(true)
    expect(isMobileDevice(nav(ANDROID, 5))).toBe(true)
  })

  it('recognises an iPad that presents itself as a Mac', () => {
    expect(isMobileDevice(nav(MAC, 5))).toBe(true)
  })

  it('treats Macs and Windows PCs as desktops, touch screen or not', () => {
    expect(isMobileDevice(nav(MAC, 0))).toBe(false)
    expect(isMobileDevice(nav(WINDOWS, 10))).toBe(false)
  })
})

describe('maxCanvasSide', () => {
  it('allows 8192 px on desktops and 4096 px on mobile devices', () => {
    expect(maxCanvasSide(nav(WINDOWS))).toBe(8192)
    expect(maxCanvasSide(nav(IPHONE, 5))).toBe(4096)
  })
})

describe('canvasSizeProblem', () => {
  it('accepts sizes within the limit', () => {
    expect(canvasSizeProblem(1, 1, 8192)).toBeNull()
    expect(canvasSizeProblem(8192, 8192, 8192)).toBeNull()
  })

  it('refuses sizes beyond the limit', () => {
    expect(canvasSizeProblem(8193, 100, 8192)).toMatch(/up to 8192 × 8192/)
    expect(canvasSizeProblem(100, 5000, 4096)).toMatch(/up to 4096 × 4096/)
  })

  it('refuses empty, fractional and non-numeric sizes', () => {
    expect(canvasSizeProblem(0, 100, 8192)).not.toBeNull()
    expect(canvasSizeProblem(100.5, 100, 8192)).not.toBeNull()
    expect(canvasSizeProblem(Number.NaN, 100, 8192)).not.toBeNull()
  })
})
