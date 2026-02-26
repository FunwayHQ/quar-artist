import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from './uiStore.ts'

describe('uiStore', () => {
  beforeEach(() => {
    useUIStore.setState({
      leftPanelOpen: true,
      rightPanelOpen: true,
      rightPanelTab: 'color',
      fullscreen: false,
    })
  })

  it('has correct default state', () => {
    const s = useUIStore.getState()
    expect(s.leftPanelOpen).toBe(true)
    expect(s.rightPanelOpen).toBe(true)
    expect(s.rightPanelTab).toBe('color')
    expect(s.fullscreen).toBe(false)
  })

  describe('toggleLeftPanel', () => {
    it('toggles left panel', () => {
      useUIStore.getState().toggleLeftPanel()
      expect(useUIStore.getState().leftPanelOpen).toBe(false)
      useUIStore.getState().toggleLeftPanel()
      expect(useUIStore.getState().leftPanelOpen).toBe(true)
    })
  })

  describe('toggleRightPanel', () => {
    it('toggles right panel', () => {
      useUIStore.getState().toggleRightPanel()
      expect(useUIStore.getState().rightPanelOpen).toBe(false)
    })
  })

  describe('setRightPanelTab', () => {
    it('sets tab to color', () => {
      useUIStore.getState().setRightPanelTab('color')
      expect(useUIStore.getState().rightPanelTab).toBe('color')
    })

    it('sets tab to brush', () => {
      useUIStore.getState().setRightPanelTab('brush')
      expect(useUIStore.getState().rightPanelTab).toBe('brush')
    })

    it('sets tab to layers', () => {
      useUIStore.getState().setRightPanelTab('brush')
      useUIStore.getState().setRightPanelTab('layers')
      expect(useUIStore.getState().rightPanelTab).toBe('layers')
    })
  })

  describe('toggleFullscreen', () => {
    it('toggles fullscreen', () => {
      useUIStore.getState().toggleFullscreen()
      expect(useUIStore.getState().fullscreen).toBe(true)
      useUIStore.getState().toggleFullscreen()
      expect(useUIStore.getState().fullscreen).toBe(false)
    })
  })
})
