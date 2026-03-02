import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isGoogleFontsConsented,
  isGoogleFontsDeclined,
  setGoogleFontsConsent,
  GOOGLE_FONTS_POPULAR,
} from './googleFonts.ts'

describe('googleFonts', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('GOOGLE_FONTS_POPULAR contains popular fonts', () => {
    expect(GOOGLE_FONTS_POPULAR.length).toBeGreaterThan(40)
    expect(GOOGLE_FONTS_POPULAR).toContain('Roboto')
    expect(GOOGLE_FONTS_POPULAR).toContain('Open Sans')
    expect(GOOGLE_FONTS_POPULAR).toContain('Montserrat')
  })

  it('isGoogleFontsConsented returns false by default', () => {
    expect(isGoogleFontsConsented()).toBe(false)
  })

  it('isGoogleFontsDeclined returns false by default', () => {
    expect(isGoogleFontsDeclined()).toBe(false)
  })

  it('setGoogleFontsConsent(true) → isGoogleFontsConsented returns true', () => {
    setGoogleFontsConsent(true)
    expect(isGoogleFontsConsented()).toBe(true)
    expect(isGoogleFontsDeclined()).toBe(false)
  })

  it('setGoogleFontsConsent(false) → isGoogleFontsDeclined returns true', () => {
    setGoogleFontsConsent(false)
    expect(isGoogleFontsDeclined()).toBe(true)
    expect(isGoogleFontsConsented()).toBe(false)
  })

  it('fonts list is sorted alphabetically', () => {
    const sorted = [...GOOGLE_FONTS_POPULAR].sort((a, b) => a.localeCompare(b))
    expect([...GOOGLE_FONTS_POPULAR]).toEqual(sorted)
  })
})
