import { describe, it, expect, beforeEach } from 'vitest'
import { useTimelapseStore } from './timelapseStore.ts'

describe('timelapseStore', () => {
  beforeEach(() => {
    useTimelapseStore.getState().reset()
  })

  it('initializes with idle state and 0 frames', () => {
    const s = useTimelapseStore.getState()
    expect(s.state).toBe('idle')
    expect(s.frameCount).toBe(0)
    expect(s.resolution).toBe('1080p')
    expect(s.videoBlob).toBeNull()
    expect(s.showExportDialog).toBe(false)
  })

  it('transitions state to recording', () => {
    useTimelapseStore.getState().setState('recording')
    expect(useTimelapseStore.getState().state).toBe('recording')
  })

  it('updates frame count', () => {
    useTimelapseStore.getState().setFrameCount(42)
    expect(useTimelapseStore.getState().frameCount).toBe(42)
  })

  it('updates resolution', () => {
    useTimelapseStore.getState().setResolution('4k')
    expect(useTimelapseStore.getState().resolution).toBe('4k')
  })

  it('stores and clears videoBlob', () => {
    const blob = new Blob(['test'], { type: 'video/webm' })
    useTimelapseStore.getState().setVideoBlob(blob)
    expect(useTimelapseStore.getState().videoBlob).toBe(blob)

    useTimelapseStore.getState().setVideoBlob(null)
    expect(useTimelapseStore.getState().videoBlob).toBeNull()
  })

  it('toggles showExportDialog', () => {
    useTimelapseStore.getState().setShowExportDialog(true)
    expect(useTimelapseStore.getState().showExportDialog).toBe(true)
  })

  it('resets all state', () => {
    useTimelapseStore.getState().setState('recording')
    useTimelapseStore.getState().setFrameCount(10)
    useTimelapseStore.getState().setVideoBlob(new Blob())
    useTimelapseStore.getState().setShowExportDialog(true)

    useTimelapseStore.getState().reset()
    const s = useTimelapseStore.getState()
    expect(s.state).toBe('idle')
    expect(s.frameCount).toBe(0)
    expect(s.videoBlob).toBeNull()
    expect(s.showExportDialog).toBe(false)
  })
})
