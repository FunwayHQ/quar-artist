import { create } from 'zustand'

interface UIStore {
  leftPanelOpen: boolean
  rightPanelOpen: boolean
  rightPanelTab: 'layers' | 'color' | 'brush'
  fullscreen: boolean
  toggleLeftPanel: () => void
  toggleRightPanel: () => void
  setRightPanelTab: (tab: 'layers' | 'color' | 'brush') => void
  toggleFullscreen: () => void
}

export const useUIStore = create<UIStore>((set) => ({
  leftPanelOpen: true,
  rightPanelOpen: true,
  rightPanelTab: 'color',
  fullscreen: false,

  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  toggleFullscreen: () => set((s) => ({ fullscreen: !s.fullscreen })),
}))
