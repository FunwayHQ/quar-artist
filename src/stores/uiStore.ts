import { create } from 'zustand'

export interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'error'
}

interface UIStore {
  leftPanelOpen: boolean
  rightPanelOpen: boolean
  rightPanelTab: 'layers' | 'color' | 'brush'
  fullscreen: boolean
  panelsHidden: boolean
  zoom: number
  showExportDialog: boolean
  showNewProjectDialog: boolean
  showShortcutsModal: boolean
  showAboutModal: boolean
  showCanvasSizeDialog: boolean
  showBrushStudio: boolean
  showDrawingGuidesDialog: boolean
  toasts: Toast[]
  toggleLeftPanel: () => void
  toggleRightPanel: () => void
  setRightPanelTab: (tab: 'layers' | 'color' | 'brush') => void
  toggleFullscreen: () => void
  togglePanelsHidden: () => void
  setZoom: (zoom: number) => void
  setShowExportDialog: (show: boolean) => void
  setShowNewProjectDialog: (show: boolean) => void
  setShowShortcutsModal: (show: boolean) => void
  setShowAboutModal: (show: boolean) => void
  setShowCanvasSizeDialog: (show: boolean) => void
  setShowBrushStudio: (show: boolean) => void
  setShowDrawingGuidesDialog: (show: boolean) => void
  addToast: (message: string, type?: Toast['type']) => void
  dismissToast: (id: string) => void
}

let toastIdCounter = 0

export const useUIStore = create<UIStore>((set) => ({
  leftPanelOpen: true,
  rightPanelOpen: true,
  rightPanelTab: 'color',
  fullscreen: false,
  panelsHidden: false,
  zoom: 1,
  showExportDialog: false,
  showNewProjectDialog: false,
  showShortcutsModal: false,
  showAboutModal: false,
  showCanvasSizeDialog: false,
  showBrushStudio: false,
  showDrawingGuidesDialog: false,
  toasts: [],

  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  toggleFullscreen: () => set((s) => ({ fullscreen: !s.fullscreen })),
  togglePanelsHidden: () => set((s) => ({ panelsHidden: !s.panelsHidden })),
  setZoom: (zoom) => set({ zoom }),
  setShowExportDialog: (show) => set({ showExportDialog: show }),
  setShowNewProjectDialog: (show) => set({ showNewProjectDialog: show }),
  setShowShortcutsModal: (show) => set({ showShortcutsModal: show }),
  setShowAboutModal: (show) => set({ showAboutModal: show }),
  setShowCanvasSizeDialog: (show) => set({ showCanvasSizeDialog: show }),
  setShowBrushStudio: (show) => set({ showBrushStudio: show }),
  setShowDrawingGuidesDialog: (show) => set({ showDrawingGuidesDialog: show }),

  addToast: (message, type = 'info') => {
    const id = `toast_${++toastIdCounter}`
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
  },

  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))
