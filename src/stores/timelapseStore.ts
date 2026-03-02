import { create } from 'zustand'
import type { TimelapseState, TimelapseResolution } from '../engine/timelapse/TimelapseRecorder.ts'

interface TimelapseStore {
  state: TimelapseState
  frameCount: number
  resolution: TimelapseResolution
  videoBlob: Blob | null
  showExportDialog: boolean

  setState: (state: TimelapseState) => void
  setFrameCount: (count: number) => void
  setResolution: (res: TimelapseResolution) => void
  setVideoBlob: (blob: Blob | null) => void
  setShowExportDialog: (show: boolean) => void
  reset: () => void
}

export const useTimelapseStore = create<TimelapseStore>((set) => ({
  state: 'idle',
  frameCount: 0,
  resolution: '1080p',
  videoBlob: null,
  showExportDialog: false,

  setState: (state) => set({ state }),
  setFrameCount: (frameCount) => set({ frameCount }),
  setResolution: (resolution) => set({ resolution }),
  setVideoBlob: (videoBlob) => set({ videoBlob }),
  setShowExportDialog: (showExportDialog) => set({ showExportDialog }),
  reset: () => set({ state: 'idle', frameCount: 0, videoBlob: null, showExportDialog: false }),
}))
