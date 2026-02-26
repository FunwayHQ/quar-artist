import { describe, it, expect, beforeEach } from 'vitest'
import { useSelectionStore } from './selectionStore.ts'

describe('selectionStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useSelectionStore.setState({
      activeSubTool: 'rectangle',
      selectionMode: 'replace',
      hasSelection: false,
      selectionBounds: null,
      magicWandOptions: { tolerance: 10, contiguous: true },
      featherOptions: { radius: 0 },
    })
  })

  describe('defaults', () => {
    it('starts with rectangle sub-tool', () => {
      expect(useSelectionStore.getState().activeSubTool).toBe('rectangle')
    })

    it('starts with replace mode', () => {
      expect(useSelectionStore.getState().selectionMode).toBe('replace')
    })

    it('starts with no selection', () => {
      expect(useSelectionStore.getState().hasSelection).toBe(false)
      expect(useSelectionStore.getState().selectionBounds).toBeNull()
    })

    it('starts with default magic wand options', () => {
      const opts = useSelectionStore.getState().magicWandOptions
      expect(opts.tolerance).toBe(10)
      expect(opts.contiguous).toBe(true)
    })

    it('starts with no feather', () => {
      expect(useSelectionStore.getState().featherOptions.radius).toBe(0)
    })
  })

  describe('setSubTool', () => {
    it('changes sub-tool', () => {
      useSelectionStore.getState().setSubTool('ellipse')
      expect(useSelectionStore.getState().activeSubTool).toBe('ellipse')
    })
  })

  describe('setSelectionMode', () => {
    it('changes selection mode', () => {
      useSelectionStore.getState().setSelectionMode('add')
      expect(useSelectionStore.getState().selectionMode).toBe('add')
    })
  })

  describe('setHasSelection', () => {
    it('updates selection state and bounds', () => {
      const bounds = { x: 10, y: 20, width: 100, height: 50 }
      useSelectionStore.getState().setHasSelection(true, bounds)
      expect(useSelectionStore.getState().hasSelection).toBe(true)
      expect(useSelectionStore.getState().selectionBounds).toEqual(bounds)
    })

    it('clears bounds when no selection', () => {
      useSelectionStore.getState().setHasSelection(true, { x: 0, y: 0, width: 10, height: 10 })
      useSelectionStore.getState().setHasSelection(false, null)
      expect(useSelectionStore.getState().hasSelection).toBe(false)
      expect(useSelectionStore.getState().selectionBounds).toBeNull()
    })
  })

  describe('setMagicWandTolerance', () => {
    it('updates tolerance', () => {
      useSelectionStore.getState().setMagicWandTolerance(50)
      expect(useSelectionStore.getState().magicWandOptions.tolerance).toBe(50)
    })

    it('clamps to 0-255', () => {
      useSelectionStore.getState().setMagicWandTolerance(-10)
      expect(useSelectionStore.getState().magicWandOptions.tolerance).toBe(0)
      useSelectionStore.getState().setMagicWandTolerance(300)
      expect(useSelectionStore.getState().magicWandOptions.tolerance).toBe(255)
    })

    it('preserves other magic wand options', () => {
      useSelectionStore.getState().setMagicWandContiguous(false)
      useSelectionStore.getState().setMagicWandTolerance(50)
      expect(useSelectionStore.getState().magicWandOptions.contiguous).toBe(false)
    })
  })

  describe('setMagicWandContiguous', () => {
    it('updates contiguous flag', () => {
      useSelectionStore.getState().setMagicWandContiguous(false)
      expect(useSelectionStore.getState().magicWandOptions.contiguous).toBe(false)
    })

    it('preserves tolerance', () => {
      useSelectionStore.getState().setMagicWandTolerance(50)
      useSelectionStore.getState().setMagicWandContiguous(false)
      expect(useSelectionStore.getState().magicWandOptions.tolerance).toBe(50)
    })
  })

  describe('setFeatherRadius', () => {
    it('updates feather radius', () => {
      useSelectionStore.getState().setFeatherRadius(5)
      expect(useSelectionStore.getState().featherOptions.radius).toBe(5)
    })

    it('clamps to non-negative', () => {
      useSelectionStore.getState().setFeatherRadius(-3)
      expect(useSelectionStore.getState().featherOptions.radius).toBe(0)
    })
  })
})
