import { create } from 'zustand'
import type { LayerInfo, BlendMode } from '../types/layer.ts'

interface LayerStore {
  layers: LayerInfo[]
  activeLayerId: string

  /** Sync from engine (called by LayerManager change callback). */
  syncFromEngine: (layers: LayerInfo[], activeId: string) => void

  setActiveLayer: (id: string) => void
}

export const useLayerStore = create<LayerStore>((set) => ({
  layers: [],
  activeLayerId: '',

  syncFromEngine: (layers, activeId) =>
    set({ layers, activeLayerId: activeId }),

  setActiveLayer: (id) => set({ activeLayerId: id }),
}))
