import { create } from 'zustand'
import type { ProjectRecord } from '../db/schema.ts'

export type AppView = 'gallery' | 'canvas'

interface ProjectStore {
  view: AppView
  currentProjectId: number | null
  currentProjectName: string
  projects: ProjectRecord[]
  canvasWidth: number
  canvasHeight: number
  dpi: number
  isSaving: boolean
  lastSaved: Date | null
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'

  setView: (view: AppView) => void
  setCurrentProject: (id: number, name: string, width: number, height: number, dpi: number) => void
  setProjects: (projects: ProjectRecord[]) => void
  setProjectName: (name: string) => void
  setSaveStatus: (status: 'idle' | 'saving' | 'saved' | 'error') => void
  setLastSaved: (date: Date) => void
  setCanvasSize: (width: number, height: number) => void
  clearCurrentProject: () => void
}

export const useProjectStore = create<ProjectStore>((set) => ({
  view: 'canvas',
  currentProjectId: null,
  currentProjectName: 'Untitled Project',
  projects: [],
  canvasWidth: 1920,
  canvasHeight: 1080,
  dpi: 72,
  isSaving: false,
  lastSaved: null,
  saveStatus: 'idle',

  setView: (view) => set({ view }),

  setCurrentProject: (id, name, width, height, dpi) =>
    set({
      currentProjectId: id,
      currentProjectName: name,
      canvasWidth: width,
      canvasHeight: height,
      dpi,
      view: 'canvas',
    }),

  setProjects: (projects) => set({ projects }),

  setProjectName: (name) => set({ currentProjectName: name }),

  setSaveStatus: (status) =>
    set((s) => ({
      saveStatus: status,
      isSaving: status === 'saving',
      lastSaved: status === 'saved' ? new Date() : s.lastSaved,
    })),

  setCanvasSize: (width, height) => set({ canvasWidth: width, canvasHeight: height }),

  clearCurrentProject: () =>
    set({
      currentProjectId: null,
      currentProjectName: 'Untitled Project',
      view: 'gallery',
    }),
}))
