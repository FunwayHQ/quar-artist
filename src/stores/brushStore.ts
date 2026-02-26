import { create } from 'zustand'
import { DEFAULT_PRESETS } from '@engine/brush/BrushParams.ts'
import type { BrushPreset } from '@app-types/brush.ts'

interface BrushStore {
  activePresetId: string
  size: number
  opacity: number
  presets: BrushPreset[]
  getActivePreset: () => BrushPreset
  setPreset: (id: string) => void
  setSize: (size: number) => void
  setOpacity: (opacity: number) => void
}

export const useBrushStore = create<BrushStore>((set, get) => ({
  activePresetId: 'round-pen',
  size: 12,
  opacity: 1,
  presets: DEFAULT_PRESETS,

  getActivePreset: () => {
    const state = get()
    const preset = state.presets.find((p) => p.id === state.activePresetId)
    if (!preset) return state.presets[0]
    return { ...preset, size: state.size, opacity: state.opacity }
  },

  setPreset: (id) => {
    const preset = get().presets.find((p) => p.id === id)
    if (preset) {
      set({ activePresetId: id, size: preset.size, opacity: preset.opacity })
    }
  },

  setSize: (size) => set({ size: Math.max(1, Math.min(500, size)) }),
  setOpacity: (opacity) => set({ opacity: Math.max(0, Math.min(1, opacity)) }),
}))
