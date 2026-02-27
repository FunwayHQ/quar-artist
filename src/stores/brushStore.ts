import { create } from 'zustand'
import { DEFAULT_PRESETS } from '@engine/brush/BrushParams.ts'
import type { BrushPreset } from '@app-types/brush.ts'

interface BrushStore {
  activePresetId: string
  size: number
  opacity: number
  presets: BrushPreset[]
  customPresets: BrushPreset[]
  getActivePreset: () => BrushPreset
  setPreset: (id: string) => void
  setSize: (size: number) => void
  setOpacity: (opacity: number) => void
  setActivePresetParams: (updates: Partial<BrushPreset>) => void
  addCustomPreset: (preset: BrushPreset) => void
  deleteCustomPreset: (id: string) => void
  setCustomPresets: (presets: BrushPreset[]) => void
}

export const useBrushStore = create<BrushStore>((set, get) => ({
  activePresetId: 'round-pen',
  size: 12,
  opacity: 1,
  presets: DEFAULT_PRESETS,
  customPresets: [],

  getActivePreset: () => {
    const state = get()
    const allPresets = [...state.presets, ...state.customPresets]
    const preset = allPresets.find((p) => p.id === state.activePresetId)
    if (!preset) return state.presets[0]
    return { ...preset, size: state.size, opacity: state.opacity }
  },

  setPreset: (id) => {
    const state = get()
    const allPresets = [...state.presets, ...state.customPresets]
    const preset = allPresets.find((p) => p.id === id)
    if (preset) {
      set({ activePresetId: id, size: preset.size, opacity: preset.opacity })
    }
  },

  setSize: (size) => set({ size: Math.max(1, Math.min(500, size)) }),
  setOpacity: (opacity) => set({ opacity: Math.max(0, Math.min(1, opacity)) }),

  setActivePresetParams: (updates) => {
    const state = get()
    const isDefault = state.presets.some((p) => p.id === state.activePresetId)
    const isCustom = state.customPresets.some((p) => p.id === state.activePresetId)

    if (isDefault) {
      // For default presets, update in-place in presets array
      set({
        presets: state.presets.map((p) =>
          p.id === state.activePresetId ? { ...p, ...updates } : p,
        ),
        ...(updates.size !== undefined ? { size: updates.size } : {}),
        ...(updates.opacity !== undefined ? { opacity: updates.opacity } : {}),
      })
    } else if (isCustom) {
      set({
        customPresets: state.customPresets.map((p) =>
          p.id === state.activePresetId ? { ...p, ...updates } : p,
        ),
        ...(updates.size !== undefined ? { size: updates.size } : {}),
        ...(updates.opacity !== undefined ? { opacity: updates.opacity } : {}),
      })
    }
  },

  addCustomPreset: (preset) => {
    set((s) => ({
      customPresets: [...s.customPresets, preset],
      activePresetId: preset.id,
      size: preset.size,
      opacity: preset.opacity,
    }))
  },

  deleteCustomPreset: (id) => {
    set((s) => {
      const newCustom = s.customPresets.filter((p) => p.id !== id)
      const needsSwitch = s.activePresetId === id
      return {
        customPresets: newCustom,
        ...(needsSwitch ? { activePresetId: s.presets[0].id, size: s.presets[0].size, opacity: s.presets[0].opacity } : {}),
      }
    })
  },

  setCustomPresets: (presets) => set({ customPresets: presets }),
}))
