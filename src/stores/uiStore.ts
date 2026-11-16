import { create } from 'zustand'

export interface ToastAction {
  label: string
  run: () => void
}

/** Why a toast went away: it timed out, the user dismissed it, or the user chose its action. */
export type ToastCloseReason = 'timeout' | 'dismiss' | 'action'

export interface ToastOptions {
  /** A button on the toast, such as Undo. */
  action?: ToastAction
  /** How long the toast stays up, in ms. */
  durationMs?: number
  /** Called once when the toast goes away. */
  onClose?: (reason: ToastCloseReason) => void
}

export interface Toast extends ToastOptions {
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
  showTimelapseExportDialog: boolean
  showQuickMenuSettings: boolean
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
  setShowTimelapseExportDialog: (show: boolean) => void
  setShowQuickMenuSettings: (show: boolean) => void
  addToast: (message: string, type?: Toast['type'], options?: ToastOptions) => void
  dismissToast: (id: string, reason?: ToastCloseReason) => void
}

let toastIdCounter = 0

export const useUIStore = create<UIStore>((set, get) => ({
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
  showTimelapseExportDialog: false,
  showQuickMenuSettings: false,
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
  setShowTimelapseExportDialog: (show) => set({ showTimelapseExportDialog: show }),
  setShowQuickMenuSettings: (show) => set({ showQuickMenuSettings: show }),

  addToast: (message, type = 'info', options = {}) => {
    const id = `toast_${++toastIdCounter}`
    set((s) => ({ toasts: [...s.toasts, { ...options, id, message, type }] }))
  },

  dismissToast: (id, reason = 'dismiss') => {
    const toast = get().toasts.find((t) => t.id === id)
    if (!toast) return
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    toast.onClose?.(reason)
  },
}))
