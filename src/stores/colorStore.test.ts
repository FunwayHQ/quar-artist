import { describe, it, expect, beforeEach } from 'vitest'
import { useColorStore } from './colorStore.ts'

describe('colorStore', () => {
  beforeEach(() => {
    useColorStore.setState({
      primary: { h: 0, s: 0, b: 1 },
      secondary: { h: 0, s: 0, b: 0 },
      harmonyMode: 'none',
      recentColors: [],
      activePaletteId: 'default',
    })
  })

  it('defaults to white primary and black secondary', () => {
    const { primary, secondary } = useColorStore.getState()
    expect(primary).toEqual({ h: 0, s: 0, b: 1 })
    expect(secondary).toEqual({ h: 0, s: 0, b: 0 })
  })

  it('sets primary color', () => {
    useColorStore.getState().setPrimary({ h: 200, s: 0.8, b: 0.6 })
    expect(useColorStore.getState().primary).toEqual({ h: 200, s: 0.8, b: 0.6 })
  })

  it('sets secondary color', () => {
    useColorStore.getState().setSecondary({ h: 120, s: 0.5, b: 0.9 })
    expect(useColorStore.getState().secondary).toEqual({ h: 120, s: 0.5, b: 0.9 })
  })

  it('swaps primary and secondary', () => {
    useColorStore.getState().setPrimary({ h: 100, s: 0.5, b: 0.5 })
    useColorStore.getState().setSecondary({ h: 200, s: 0.3, b: 0.8 })
    useColorStore.getState().swapColors()
    expect(useColorStore.getState().primary).toEqual({ h: 200, s: 0.3, b: 0.8 })
    expect(useColorStore.getState().secondary).toEqual({ h: 100, s: 0.5, b: 0.5 })
  })

  describe('recent colors', () => {
    it('adds to recent colors when setting primary', () => {
      useColorStore.getState().setPrimary({ h: 180, s: 1, b: 1 })
      expect(useColorStore.getState().recentColors).toHaveLength(1)
      expect(useColorStore.getState().recentColors[0].h).toBe(180)
    })

    it('limits to 10 recent colors', () => {
      for (let i = 0; i < 15; i++) {
        useColorStore.getState().setPrimary({ h: i * 24, s: 1, b: 1 })
      }
      expect(useColorStore.getState().recentColors).toHaveLength(10)
    })

    it('deduplicates recent colors', () => {
      useColorStore.getState().setPrimary({ h: 100, s: 1, b: 1 })
      useColorStore.getState().setPrimary({ h: 200, s: 1, b: 1 })
      useColorStore.getState().setPrimary({ h: 100, s: 1, b: 1 })
      expect(useColorStore.getState().recentColors).toHaveLength(2)
      // Most recent first
      expect(useColorStore.getState().recentColors[0].h).toBe(100)
    })
  })

  describe('harmony mode', () => {
    it('defaults to none', () => {
      expect(useColorStore.getState().harmonyMode).toBe('none')
    })

    it('sets harmony mode', () => {
      useColorStore.getState().setHarmonyMode('complementary')
      expect(useColorStore.getState().harmonyMode).toBe('complementary')
    })
  })

  describe('palettes', () => {
    it('has default and skin-tones palettes', () => {
      const { palettes } = useColorStore.getState()
      expect(palettes.length).toBeGreaterThanOrEqual(2)
      expect(palettes.find((p) => p.id === 'default')).toBeDefined()
      expect(palettes.find((p) => p.id === 'skin-tones')).toBeDefined()
    })

    it('creates a new palette', () => {
      const id = useColorStore.getState().createPalette('Test Palette')
      const palette = useColorStore.getState().palettes.find((p) => p.id === id)
      expect(palette).toBeDefined()
      expect(palette!.name).toBe('Test Palette')
      expect(palette!.swatches).toHaveLength(0)
    })

    it('activates newly created palette', () => {
      const id = useColorStore.getState().createPalette('New')
      expect(useColorStore.getState().activePaletteId).toBe(id)
    })

    it('adds a swatch to a palette', () => {
      useColorStore.getState().addSwatch('default', { color: { h: 42, s: 1, b: 1 } })
      const palette = useColorStore.getState().palettes.find((p) => p.id === 'default')!
      const lastSwatch = palette.swatches[palette.swatches.length - 1]
      expect(lastSwatch.color.h).toBe(42)
    })

    it('removes a swatch from a palette', () => {
      const before = useColorStore.getState().palettes.find((p) => p.id === 'default')!.swatches.length
      useColorStore.getState().removeSwatch('default', 0)
      const after = useColorStore.getState().palettes.find((p) => p.id === 'default')!.swatches.length
      expect(after).toBe(before - 1)
    })

    it('deletes a palette', () => {
      const id = useColorStore.getState().createPalette('ToDelete')
      const countBefore = useColorStore.getState().palettes.length
      useColorStore.getState().deletePalette(id)
      expect(useColorStore.getState().palettes.length).toBe(countBefore - 1)
    })

    it('renames a palette', () => {
      useColorStore.getState().renamePalette('default', 'My Colors')
      const palette = useColorStore.getState().palettes.find((p) => p.id === 'default')!
      expect(palette.name).toBe('My Colors')
    })

    it('imports a palette', () => {
      const imported = { id: 'ext', name: 'External', swatches: [{ color: { h: 0, s: 1, b: 1 } }] }
      useColorStore.getState().importPalette(imported)
      const found = useColorStore.getState().palettes.find((p) => p.id === 'ext')
      expect(found).toBeDefined()
      expect(found!.swatches).toHaveLength(1)
    })
  })
})
