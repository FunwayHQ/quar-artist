import { create } from 'zustand'

interface UIStore {
  leftPanelOpen: boolean
  rightPanelOpen: boolean
  rightPanelTab: 'layers' | 'color' | 'brush'
  fullscreen: boolean
  zoom: number
  showExportDialog: boolean
  showNewProjectDialog: boolean
  toggleLeftPanel: () => void
  toggleRightPanel: () => void
  setRightPanelTab: (tab: 'layers' | 'color' | 'brush') => void
  toggleFullscreen: () => void
  setZoom: (zoom: number) => void
  setShowExportDialog: (show: boolean) => void
  setShowNewProjectDialog: (show: boolean) => void
}

export const useUIStore = create<UIStore>((set) => ({
  leftPanelOpen: true,
  rightPanelOpen: true,
  rightPanelTab: 'color',
  fullscreen: false,
  zoom: 1,
  showExportDialog: false,
  showNewProjectDialog: false,

  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  toggleFullscreen: () => set((s) => ({ fullscreen: !s.fullscreen })),
  setZoom: (zoom) => set({ zoom }),
  setShowExportDialog: (show) => set({ showExportDialog: show }),
  setShowNewProjectDialog: (show) => set({ showNewProjectDialog: show }),
}))
