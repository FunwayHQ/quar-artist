import { create } from 'zustand'
import type { TextProperties } from '../types/text.ts'
import { DEFAULT_TEXT_PROPERTIES, WEB_SAFE_FONTS } from '../types/text.ts'

interface TextStore {
  properties: TextProperties
  availableFonts: string[]
  isEditing: boolean
  editPosition: { screenX: number; screenY: number; canvasX: number; canvasY: number } | null

  setFontFamily: (fontFamily: string) => void
  setFontSize: (fontSize: number) => void
  setFontWeight: (fontWeight: TextProperties['fontWeight']) => void
  setFontStyle: (fontStyle: TextProperties['fontStyle']) => void
  setTextAlign: (textAlign: TextProperties['textAlign']) => void
  setColor: (color: string) => void
  setAvailableFonts: (fonts: string[]) => void
  beginEditing: (screenX: number, screenY: number, canvasX: number, canvasY: number) => void
  endEditing: () => void
}

export const useTextStore = create<TextStore>((set) => ({
  properties: { ...DEFAULT_TEXT_PROPERTIES },
  availableFonts: [...WEB_SAFE_FONTS],
  isEditing: false,
  editPosition: null,

  setFontFamily: (fontFamily) => set((s) => ({ properties: { ...s.properties, fontFamily } })),
  setFontSize: (fontSize) => set((s) => ({ properties: { ...s.properties, fontSize: Math.max(1, fontSize) } })),
  setFontWeight: (fontWeight) => set((s) => ({ properties: { ...s.properties, fontWeight } })),
  setFontStyle: (fontStyle) => set((s) => ({ properties: { ...s.properties, fontStyle } })),
  setTextAlign: (textAlign) => set((s) => ({ properties: { ...s.properties, textAlign } })),
  setColor: (color) => set((s) => ({ properties: { ...s.properties, color } })),
  setAvailableFonts: (fonts) => set({ availableFonts: fonts }),
  beginEditing: (screenX, screenY, canvasX, canvasY) =>
    set({ isEditing: true, editPosition: { screenX, screenY, canvasX, canvasY } }),
  endEditing: () => set({ isEditing: false, editPosition: null }),
}))
