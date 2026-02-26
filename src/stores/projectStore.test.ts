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

  it('starts in gallery view', () => {
    expect(useProjectStore.getState().view).toBe('gallery')
  })

  it('starts with no current project', () => {
    expect(useProjectStore.getState().currentProjectId).toBeNull()
  })

  it('setView changes the app view', () => {
    useProjectStore.getState().setView('canvas')
    expect(useProjectStore.getState().view).toBe('canvas')
  })

  it('setCurrentProject updates all project fields', () => {
    useProjectStore.getState().setCurrentProject(1, 'My Art', 2048, 2048, 300)
    const state = useProjectStore.getState()
    expect(state.currentProjectId).toBe(1)
    expect(state.currentProjectName).toBe('My Art')
    expect(state.canvasWidth).toBe(2048)
    expect(state.canvasHeight).toBe(2048)
    expect(state.dpi).toBe(300)
    expect(state.view).toBe('canvas')
  })

  it('setProjects updates the project list', () => {
    const projects = [
      { id: 1, name: 'P1', width: 100, height: 100, dpi: 72, createdAt: new Date(), updatedAt: new Date() },
      { id: 2, name: 'P2', width: 200, height: 200, dpi: 150, createdAt: new Date(), updatedAt: new Date() },
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
    useProjectStore.getState().setCurrentProject(1, 'Test', 1920, 1080, 72)
    useProjectStore.getState().clearCurrentProject()

    const state = useProjectStore.getState()
    expect(state.view).toBe('gallery')
    expect(state.currentProjectId).toBeNull()
    expect(state.currentProjectName).toBe('Untitled Project')
  })
})
