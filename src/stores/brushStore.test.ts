import { describe, it, expect, beforeEach } from 'vitest'
import { useBrushStore } from './brushStore.ts'

describe('brushStore', () => {
  beforeEach(() => {
    useBrushStore.setState({
      activePresetId: 'round-pen',
      size: 12,
      opacity: 1,
    })
  })

  it('defaults to round-pen preset', () => {
    expect(useBrushStore.getState().activePresetId).toBe('round-pen')
  })

  it('has 12 presets', () => {
    expect(useBrushStore.getState().presets).toHaveLength(12)
  })

  describe('setPreset', () => {
    it('switches to a different preset', () => {
      useBrushStore.getState().setPreset('soft-airbrush')
      const s = useBrushStore.getState()
      expect(s.activePresetId).toBe('soft-airbrush')
      expect(s.size).toBe(60) // Soft Airbrush default
      expect(s.opacity).toBe(0.3)
    })

    it('ignores unknown preset id', () => {
      useBrushStore.getState().setPreset('nonexistent')
      expect(useBrushStore.getState().activePresetId).toBe('round-pen')
    })
  })

  describe('setSize', () => {
    it('updates size', () => {
      useBrushStore.getState().setSize(50)
      expect(useBrushStore.getState().size).toBe(50)
    })

    it('clamps to min 1', () => {
      useBrushStore.getState().setSize(-10)
      expect(useBrushStore.getState().size).toBe(1)
    })

    it('clamps to max 500', () => {
      useBrushStore.getState().setSize(999)
      expect(useBrushStore.getState().size).toBe(500)
    })
  })

  describe('setOpacity', () => {
    it('updates opacity', () => {
      useBrushStore.getState().setOpacity(0.5)
      expect(useBrushStore.getState().opacity).toBe(0.5)
    })

    it('clamps to [0, 1]', () => {
      useBrushStore.getState().setOpacity(-1)
      expect(useBrushStore.getState().opacity).toBe(0)
      useBrushStore.getState().setOpacity(2)
      expect(useBrushStore.getState().opacity).toBe(1)
    })
  })

  describe('getActivePreset', () => {
    it('returns the active preset with overridden size and opacity', () => {
      useBrushStore.getState().setSize(42)
      useBrushStore.getState().setOpacity(0.7)
      const preset = useBrushStore.getState().getActivePreset()
      expect(preset.id).toBe('round-pen')
      expect(preset.size).toBe(42)
      expect(preset.opacity).toBe(0.7)
    })
  })
})
