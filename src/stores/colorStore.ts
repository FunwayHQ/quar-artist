import { create } from 'zustand'
import type { HSBColor, HarmonyMode, ColorPalette, ColorSwatch } from '@app-types/color.ts'

const MAX_RECENT = 10

interface ColorStore {
  primary: HSBColor
  secondary: HSBColor
  harmonyMode: HarmonyMode
  recentColors: HSBColor[]
  palettes: ColorPalette[]
  activePaletteId: string

  setPrimary: (color: HSBColor) => void
  setSecondary: (color: HSBColor) => void
  swapColors: () => void
  resetColors: () => void
  setHarmonyMode: (mode: HarmonyMode) => void
  addRecentColor: (color: HSBColor) => void

  // Palette operations
  createPalette: (name: string) => string
  deletePalette: (id: string) => void
  renamePalette: (id: string, name: string) => void
  setActivePalette: (id: string) => void
  addSwatch: (paletteId: string, swatch: ColorSwatch) => void
  removeSwatch: (paletteId: string, index: number) => void
  importPalette: (palette: ColorPalette) => void
}

let paletteIdCounter = 1

const DEFAULT_PALETTE: ColorPalette = {
  id: 'default',
  name: 'Default',
  swatches: [
    { color: { h: 0, s: 0, b: 1 } },      // White
    { color: { h: 0, s: 0, b: 0.75 } },    // Light gray
    { color: { h: 0, s: 0, b: 0.5 } },     // Medium gray
    { color: { h: 0, s: 0, b: 0.25 } },    // Dark gray
    { color: { h: 0, s: 0, b: 0 } },       // Black
    { color: { h: 0, s: 1, b: 1 } },       // Red
    { color: { h: 30, s: 1, b: 1 } },      // Orange
    { color: { h: 39, s: 0.93, b: 0.96 } }, // Amber (brand)
    { color: { h: 60, s: 1, b: 1 } },      // Yellow
    { color: { h: 120, s: 1, b: 0.5 } },   // Green
    { color: { h: 200, s: 1, b: 0.8 } },   // Sky blue
    { color: { h: 240, s: 1, b: 1 } },     // Blue
    { color: { h: 270, s: 1, b: 0.8 } },   // Purple
    { color: { h: 300, s: 0.7, b: 0.9 } }, // Pink
    { color: { h: 15, s: 0.6, b: 0.5 } },  // Brown
    { color: { h: 20, s: 0.3, b: 0.9 } },  // Peach
  ],
}

const SKIN_TONES_PALETTE: ColorPalette = {
  id: 'skin-tones',
  name: 'Skin Tones',
  swatches: [
    { color: { h: 25, s: 0.15, b: 0.95 } },
    { color: { h: 25, s: 0.25, b: 0.9 } },
    { color: { h: 22, s: 0.35, b: 0.85 } },
    { color: { h: 20, s: 0.4, b: 0.75 } },
    { color: { h: 18, s: 0.45, b: 0.65 } },
    { color: { h: 15, s: 0.5, b: 0.55 } },
    { color: { h: 12, s: 0.55, b: 0.45 } },
    { color: { h: 10, s: 0.6, b: 0.35 } },
    { color: { h: 8, s: 0.5, b: 0.25 } },
    { color: { h: 350, s: 0.3, b: 0.85 } },  // Blush
    { color: { h: 0, s: 0.15, b: 0.7 } },    // Lip neutral
    { color: { h: 5, s: 0.6, b: 0.6 } },     // Lip warm
  ],
}

function colorsMatch(a: HSBColor, b: HSBColor): boolean {
  return Math.abs(a.h - b.h) < 1 && Math.abs(a.s - b.s) < 0.01 && Math.abs(a.b - b.b) < 0.01
}

export const useColorStore = create<ColorStore>((set, get) => ({
  primary: { h: 0, s: 0, b: 1 },     // White
  secondary: { h: 0, s: 0, b: 0 },   // Black
  harmonyMode: 'none' as HarmonyMode,
  recentColors: [],
  palettes: [DEFAULT_PALETTE, SKIN_TONES_PALETTE],
  activePaletteId: 'default',

  setPrimary: (color) => {
    set({ primary: color })
    get().addRecentColor(color)
  },

  setSecondary: (color) => set({ secondary: color }),

  swapColors: () => {
    const { primary, secondary } = get()
    set({ primary: secondary, secondary: primary })
  },

  resetColors: () => set({
    primary: { h: 0, s: 0, b: 0 },    // Black
    secondary: { h: 0, s: 0, b: 1 },  // White
  }),

  setHarmonyMode: (mode) => set({ harmonyMode: mode }),

  addRecentColor: (color) => {
    set((s) => {
      const filtered = s.recentColors.filter((c) => !colorsMatch(c, color))
      return { recentColors: [color, ...filtered].slice(0, MAX_RECENT) }
    })
  },

  createPalette: (name) => {
    const id = `palette_${paletteIdCounter++}`
    set((s) => ({
      palettes: [...s.palettes, { id, name, swatches: [] }],
      activePaletteId: id,
    }))
    return id
  },

  deletePalette: (id) => {
    set((s) => {
      const filtered = s.palettes.filter((p) => p.id !== id)
      return {
        palettes: filtered,
        activePaletteId: s.activePaletteId === id
          ? (filtered[0]?.id ?? '')
          : s.activePaletteId,
      }
    })
  },

  renamePalette: (id, name) => {
    set((s) => ({
      palettes: s.palettes.map((p) => (p.id === id ? { ...p, name } : p)),
    }))
  },

  setActivePalette: (id) => set({ activePaletteId: id }),

  addSwatch: (paletteId, swatch) => {
    set((s) => ({
      palettes: s.palettes.map((p) =>
        p.id === paletteId ? { ...p, swatches: [...p.swatches, swatch] } : p,
      ),
    }))
  },

  removeSwatch: (paletteId, index) => {
    set((s) => ({
      palettes: s.palettes.map((p) =>
        p.id === paletteId
          ? { ...p, swatches: p.swatches.filter((_, i) => i !== index) }
          : p,
      ),
    }))
  },

  importPalette: (palette) => {
    set((s) => ({
      palettes: [...s.palettes, palette],
      activePaletteId: palette.id,
    }))
  },
}))
