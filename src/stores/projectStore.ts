import { create } from 'zustand'
import type { ProjectRecord, StackRecord } from '../db/schema.ts'
import type { ColorSpace, GallerySort } from '../types/project.ts'
import { createId } from '../utils/id.ts'

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

/** Loading: deciding where to start, or reading a project before it opens. */
export type AppView = 'loading' | 'gallery' | 'canvas'

/** The project a document session shows. A null id means it can't be saved (no storage). */
export interface OpenDocument {
  id: string | null
  name: string
  width: number
  height: number
  dpi: number
  colorSpace: ColorSpace
}

interface ProjectStore {
  view: AppView
  /** Changes every time a document opens, so the canvas and its engine start afresh. */
  sessionId: string | null
  currentProjectId: string | null
  currentProjectName: string
  /** The Gallery's projects, without deleted ones. */
  projects: ProjectRecord[]
  stacks: StackRecord[]
  gallerySort: GallerySort
  /** The stack the Gallery shows, or null for the top level. */
  openStackId: string | null
  /** The project opened most recently, for the Gallery's Continue button. */
  lastProjectId: string | null
  canvasWidth: number
  canvasHeight: number
  dpi: number
  colorSpace: ColorSpace
  isSaving: boolean
  lastSaved: Date | null
  /** How saving the open project goes: pending while changes wait for the next save. */
  saveStatus: SaveStatus

  setView: (view: AppView) => void
  setCurrentProject: (id: string, name: string, width: number, height: number, dpi: number) => void
  /** Show a document in a new session. */
  openDocument: (doc: OpenDocument) => void
  setProjects: (projects: ProjectRecord[]) => void
  setStacks: (stacks: StackRecord[]) => void
  setProjectName: (name: string) => void
  setSaveStatus: (status: SaveStatus) => void
  setLastSaved: (date: Date) => void
  setCanvasSize: (width: number, height: number) => void
  setGallerySort: (sort: GallerySort) => void
  setOpenStack: (stackId: string | null) => void
  setLastProjectId: (id: string | null) => void
  clearCurrentProject: () => void
}

export const useProjectStore = create<ProjectStore>((set) => ({
  view: 'loading',
  sessionId: null,
  currentProjectId: null,
  currentProjectName: 'Untitled Project',
  projects: [],
  stacks: [],
  gallerySort: 'updated',
  openStackId: null,
  lastProjectId: null,
  canvasWidth: 1920,
  canvasHeight: 1080,
  dpi: 72,
  colorSpace: 'srgb',
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

  openDocument: (doc) =>
    set({
      sessionId: createId(),
      currentProjectId: doc.id,
      currentProjectName: doc.name,
      canvasWidth: doc.width,
      canvasHeight: doc.height,
      dpi: doc.dpi,
      colorSpace: doc.colorSpace,
      view: 'canvas',
      isSaving: false,
      lastSaved: null,
      saveStatus: 'idle',
    }),

  setProjects: (projects) => set({ projects }),

  setStacks: (stacks) => set({ stacks }),

  setProjectName: (name) => set({ currentProjectName: name }),

  setSaveStatus: (status) =>
    set((s) => ({
      saveStatus: status,
      isSaving: status === 'saving',
      lastSaved: status === 'saved' ? new Date() : s.lastSaved,
    })),

  setLastSaved: (date) => set({ lastSaved: date }),

  setCanvasSize: (width, height) => set({ canvasWidth: width, canvasHeight: height }),

  setGallerySort: (gallerySort) => set({ gallerySort }),

  setOpenStack: (openStackId) => set({ openStackId }),

  setLastProjectId: (lastProjectId) => set({ lastProjectId }),

  clearCurrentProject: () =>
    set({
      sessionId: null,
      currentProjectId: null,
      currentProjectName: 'Untitled Project',
      view: 'gallery',
    }),
}))
