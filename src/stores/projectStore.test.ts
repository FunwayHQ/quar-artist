import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectStore } from './projectStore.ts'

describe('projectStore', () => {
  beforeEach(() => {
    useProjectStore.setState({
      view: 'gallery',
      currentProjectId: null,
      currentProjectName: 'Untitled Project',
      projects: [],
      canvasWidth: 1920,
      canvasHeight: 1080,
      dpi: 72,
      isSaving: false,
      lastSaved: null,
      saveStatus: 'idle',
    })
  })

  it('starts loading, until the project service decides where the app opens', () => {
    expect(useProjectStore.getInitialState().view).toBe('loading')
    expect(useProjectStore.getInitialState().sessionId).toBeNull()
  })

  it('starts with no current project', () => {
    expect(useProjectStore.getState().currentProjectId).toBeNull()
  })

  it('setView changes the app view', () => {
    useProjectStore.getState().setView('canvas')
    expect(useProjectStore.getState().view).toBe('canvas')
  })

  it('setCurrentProject updates all project fields', () => {
    useProjectStore.getState().setCurrentProject('p1', 'My Art', 2048, 2048, 300)
    const state = useProjectStore.getState()
    expect(state.currentProjectId).toBe('p1')
    expect(state.currentProjectName).toBe('My Art')
    expect(state.canvasWidth).toBe(2048)
    expect(state.canvasHeight).toBe(2048)
    expect(state.dpi).toBe(300)
    expect(state.view).toBe('canvas')
  })

  it('setProjects updates the project list', () => {
    const projects = [
      { id: 'p1', name: 'P1', width: 100, height: 100, dpi: 72, createdAt: new Date(), updatedAt: new Date() },
      { id: 'p2', name: 'P2', width: 200, height: 200, dpi: 150, createdAt: new Date(), updatedAt: new Date() },
    ]
    useProjectStore.getState().setProjects(projects)
    expect(useProjectStore.getState().projects).toHaveLength(2)
  })

  it('setProjectName updates the name', () => {
    useProjectStore.getState().setProjectName('New Name')
    expect(useProjectStore.getState().currentProjectName).toBe('New Name')
  })

  it('setSaveStatus to saving sets isSaving true', () => {
    useProjectStore.getState().setSaveStatus('saving')
    expect(useProjectStore.getState().isSaving).toBe(true)
    expect(useProjectStore.getState().saveStatus).toBe('saving')
  })

  it('setSaveStatus to saved sets isSaving false and updates lastSaved', () => {
    useProjectStore.getState().setSaveStatus('saved')
    expect(useProjectStore.getState().isSaving).toBe(false)
    expect(useProjectStore.getState().lastSaved).toBeInstanceOf(Date)
  })

  it('setSaveStatus to error sets isSaving false', () => {
    useProjectStore.getState().setSaveStatus('error')
    expect(useProjectStore.getState().isSaving).toBe(false)
    expect(useProjectStore.getState().saveStatus).toBe('error')
  })

  it('clearCurrentProject returns to gallery', () => {
    useProjectStore.getState().setCurrentProject('p1', 'Test', 1920, 1080, 72)
    useProjectStore.getState().clearCurrentProject()

    const state = useProjectStore.getState()
    expect(state.view).toBe('gallery')
    expect(state.currentProjectId).toBeNull()
    expect(state.currentProjectName).toBe('Untitled Project')
  })

  it('opens each document in a new session', () => {
    const doc = { id: 'p1', name: 'Sketch', width: 640, height: 480, dpi: 300, colorSpace: 'srgb' as const }
    useProjectStore.getState().setSaveStatus('error')
    useProjectStore.getState().openDocument(doc)
    const first = useProjectStore.getState().sessionId

    expect(useProjectStore.getState()).toMatchObject({
      view: 'canvas',
      currentProjectId: 'p1',
      currentProjectName: 'Sketch',
      canvasWidth: 640,
      canvasHeight: 480,
      dpi: 300,
      colorSpace: 'srgb',
      saveStatus: 'idle',
      lastSaved: null,
    })
    expect(first).toEqual(expect.any(String))

    // The same project opened again still gets a new session, so its canvas starts afresh.
    useProjectStore.getState().openDocument(doc)
    expect(useProjectStore.getState().sessionId).not.toBe(first)
  })

  it('opens an unsaved document without a project id', () => {
    useProjectStore.getState().openDocument({ id: null, name: 'Untitled Project', width: 1920, height: 1080, dpi: 72, colorSpace: 'srgb' })
    expect(useProjectStore.getState()).toMatchObject({ view: 'canvas', currentProjectId: null })
    expect(useProjectStore.getState().sessionId).not.toBeNull()
  })

  it('ends the session when the project closes', () => {
    useProjectStore.getState().openDocument({ id: 'p1', name: 'Sketch', width: 640, height: 480, dpi: 72, colorSpace: 'srgb' })
    useProjectStore.getState().clearCurrentProject()
    expect(useProjectStore.getState().sessionId).toBeNull()
  })

  it('keeps the Gallery\'s sort, open stack and last project', () => {
    useProjectStore.getState().setGallerySort('name')
    useProjectStore.getState().setOpenStack('s1')
    useProjectStore.getState().setLastProjectId('p1')
    useProjectStore.getState().setStacks([{ id: 's1', name: 'Studies', createdAt: new Date(), updatedAt: new Date() }])
    expect(useProjectStore.getState()).toMatchObject({ gallerySort: 'name', openStackId: 's1', lastProjectId: 'p1' })
    expect(useProjectStore.getState().stacks).toHaveLength(1)
  })

  it('shows how far a saved document has loaded, from opening it until it is all in (plan M1.4)', () => {
    const doc = { id: 'p1', name: 'Sketch', width: 640, height: 480, dpi: 72, colorSpace: 'srgb' as const }
    useProjectStore.getState().openDocument({ ...doc, loadsSaved: true })
    expect(useProjectStore.getState().openProgress).toBe(0)
    useProjectStore.getState().setOpenProgress(0.5)
    expect(useProjectStore.getState().openProgress).toBe(0.5)
    useProjectStore.getState().setOpenProgress(null)
    expect(useProjectStore.getState().openProgress).toBeNull()

    // A new document has nothing to load; closing stops a load.
    useProjectStore.getState().openDocument(doc)
    expect(useProjectStore.getState().openProgress).toBeNull()
    useProjectStore.getState().openDocument({ ...doc, loadsSaved: true })
    useProjectStore.getState().clearCurrentProject()
    expect(useProjectStore.getState().openProgress).toBeNull()
  })

  it('hands the view a project was saved with to the canvas once (plan M1.4)', () => {
    const view = { x: 10, y: 20, zoom: 2, rotation: 0 }
    const doc = { id: 'p1', name: 'Sketch', width: 640, height: 480, dpi: 72, colorSpace: 'srgb' as const }
    useProjectStore.getState().openDocument({ ...doc, view })
    expect(useProjectStore.getState().takeInitialView()).toEqual(view)
    // A canvas that starts again later fits the document instead.
    expect(useProjectStore.getState().takeInitialView()).toBeNull()

    useProjectStore.getState().openDocument({ ...doc, view })
    useProjectStore.getState().openDocument(doc)
    expect(useProjectStore.getState().takeInitialView()).toBeNull()
    useProjectStore.getState().openDocument({ ...doc, view })
    useProjectStore.getState().clearCurrentProject()
    expect(useProjectStore.getState().takeInitialView()).toBeNull()
  })
})
