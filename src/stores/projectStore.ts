import { create } from 'zustand'
import type { ProjectRecord, StackRecord } from '../db/schema.ts'
import type { ColorSpace, GallerySort } from '../types/project.ts'
import type { SavedView } from '../types/engine.ts'
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
  /** How the canvas showed it last time, to show it the same way (plan M1.4). */
  view?: SavedView | null
  /** Whether a saved document is to load into the canvas: `openProgress` starts at 0. */
  loadsSaved?: boolean
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
  /**
   * How much of the open document's saved tiles has loaded into the canvas,
   * from 0 to 1, while it opens (plan M1.4); null once it is open. Nothing on
   * the canvas can be used until then.
   */
  openProgress: number | null
  /** The view the canvas shows the document with first, if it has one to come back to. Taken once. */
  initialView: SavedView | null

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
  setOpenProgress: (progress: number | null) => void
  /** The view to show the document with first, once: later the canvas fits the document instead. */
  takeInitialView: () => SavedView | null
  clearCurrentProject: () => void
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
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
  openProgress: null,
  initialView: null,

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
      openProgress: doc.loadsSaved ? 0 : null,
      initialView: doc.view ?? null,
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

  setOpenProgress: (openProgress) => set({ openProgress }),

  takeInitialView: () => {
    const view = get().initialView
    if (view) set({ initialView: null })
    return view
  },

  clearCurrentProject: () =>
    set({
      sessionId: null,
      currentProjectId: null,
      currentProjectName: 'Untitled Project',
      view: 'gallery',
      openProgress: null,
      initialView: null,
    }),
}))
