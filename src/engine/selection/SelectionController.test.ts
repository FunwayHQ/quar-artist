import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SelectionController } from './SelectionController.ts'

describe('SelectionController', () => {
  let ctrl: SelectionController

  beforeEach(() => {
    ctrl = new SelectionController(100, 100)
  })

  it('starts with rectangle sub-tool', () => {
    expect(ctrl.getSubTool()).toBe('rectangle')
  })

  it('starts with no selection', () => {
    expect(ctrl.hasSelection()).toBe(false)
  })

  describe('setSubTool', () => {
    it('changes the active sub-tool', () => {
      ctrl.setSubTool('ellipse')
      expect(ctrl.getSubTool()).toBe('ellipse')
    })

    it('cancels any active tool when switching', () => {
      ctrl.handlePointerDown({ x: 0, y: 0 })
      expect(ctrl.isToolActive()).toBe(true)
      ctrl.setSubTool('ellipse')
      expect(ctrl.isToolActive()).toBe(false)
    })
  })

  describe('rectangle selection workflow', () => {
    it('creates a selection via pointer events', () => {
      ctrl.setSubTool('rectangle')
      ctrl.handlePointerDown({ x: 10, y: 10 })
      expect(ctrl.isToolActive()).toBe(true)

      ctrl.handlePointerMove({ x: 50, y: 50 })
      ctrl.handlePointerUp()

      expect(ctrl.isToolActive()).toBe(false)
      expect(ctrl.hasSelection()).toBe(true)
      // Check that pixels inside the rect are selected
      expect(ctrl.manager.getPixel(20, 20)).toBe(255)
      expect(ctrl.manager.getPixel(0, 0)).toBe(0)
    })

    it('constrains to square with setConstrained', () => {
      ctrl.setSubTool('rectangle')
      ctrl.setConstrained(true)
      ctrl.handlePointerDown({ x: 0, y: 0 })
      ctrl.handlePointerMove({ x: 50, y: 30 })
      ctrl.handlePointerUp()

      // Should be a square, so selection at (40, 40) should be selected
      // (50x50 square from origin)
      expect(ctrl.manager.getPixel(40, 40)).toBe(255)
    })
  })

  describe('ellipse selection workflow', () => {
    it('creates an elliptical selection', () => {
      ctrl.setSubTool('ellipse')
      ctrl.handlePointerDown({ x: 20, y: 20 })
      ctrl.handlePointerMove({ x: 80, y: 80 })
      ctrl.handlePointerUp()

      expect(ctrl.hasSelection()).toBe(true)
      // Center of ellipse should be selected
      expect(ctrl.manager.getPixel(50, 50)).toBe(255)
    })
  })

  describe('freehand selection workflow', () => {
    it('creates a polygon selection from path', () => {
      ctrl.setSubTool('freehand')
      ctrl.handlePointerDown({ x: 10, y: 10 })
      ctrl.handlePointerMove({ x: 50, y: 10 })
      ctrl.handlePointerMove({ x: 50, y: 50 })
      ctrl.handlePointerUp()

      expect(ctrl.hasSelection()).toBe(true)
    })
  })

  describe('magic wand', () => {
    it('executes magic wand selection', () => {
      ctrl.setSubTool('magicWand')
      // Create a uniform red image
      const pixels = new Uint8Array(100 * 100 * 4)
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = 255 // R
        pixels[i + 1] = 0 // G
        pixels[i + 2] = 0 // B
        pixels[i + 3] = 255 // A
      }

      ctrl.executeMagicWand({ x: 50, y: 50 }, pixels)
      expect(ctrl.hasSelection()).toBe(true)
      // All pixels are the same color, so all should be selected
      expect(ctrl.manager.getPixel(0, 0)).toBe(255)
      expect(ctrl.manager.getPixel(99, 99)).toBe(255)
    })
  })

  describe('selection modes', () => {
    it('replace mode replaces existing selection', () => {
      ctrl.setSelectionMode('replace')
      ctrl.setSubTool('rectangle')

      // First selection
      ctrl.handlePointerDown({ x: 0, y: 0 })
      ctrl.handlePointerMove({ x: 30, y: 30 })
      ctrl.handlePointerUp()
      expect(ctrl.manager.getPixel(10, 10)).toBe(255)

      // Second selection replaces
      ctrl.handlePointerDown({ x: 50, y: 50 })
      ctrl.handlePointerMove({ x: 80, y: 80 })
      ctrl.handlePointerUp()
      expect(ctrl.manager.getPixel(10, 10)).toBe(0) // old area deselected
      expect(ctrl.manager.getPixel(60, 60)).toBe(255)
    })

    it('add mode unions selections', () => {
      ctrl.setSelectionMode('replace')
      ctrl.setSubTool('rectangle')
      ctrl.handlePointerDown({ x: 0, y: 0 })
      ctrl.handlePointerMove({ x: 30, y: 30 })
      ctrl.handlePointerUp()

      ctrl.setSelectionMode('add')
      ctrl.handlePointerDown({ x: 50, y: 50 })
      ctrl.handlePointerMove({ x: 80, y: 80 })
      ctrl.handlePointerUp()

      expect(ctrl.manager.getPixel(10, 10)).toBe(255) // first area kept
      expect(ctrl.manager.getPixel(60, 60)).toBe(255) // second area added
    })

    it('subtract mode removes from selection', () => {
      ctrl.selectAll()
      ctrl.setSelectionMode('subtract')
      ctrl.setSubTool('rectangle')
      ctrl.handlePointerDown({ x: 20, y: 20 })
      ctrl.handlePointerMove({ x: 40, y: 40 })
      ctrl.handlePointerUp()

      expect(ctrl.manager.getPixel(0, 0)).toBe(255) // outside subtraction
      expect(ctrl.manager.getPixel(30, 30)).toBe(0) // inside subtraction
    })
  })

  describe('selection actions', () => {
    it('selectAll selects entire canvas', () => {
      ctrl.selectAll()
      expect(ctrl.hasSelection()).toBe(true)
      expect(ctrl.manager.getPixel(0, 0)).toBe(255)
      expect(ctrl.manager.getPixel(99, 99)).toBe(255)
    })

    it('deselect clears all selection', () => {
      ctrl.selectAll()
      ctrl.deselect()
      expect(ctrl.hasSelection()).toBe(false)
    })

    it('invertSelection flips selection', () => {
      ctrl.setSubTool('rectangle')
      ctrl.handlePointerDown({ x: 0, y: 0 })
      ctrl.handlePointerMove({ x: 50, y: 50 })
      ctrl.handlePointerUp()

      ctrl.invertSelection()
      expect(ctrl.manager.getPixel(10, 10)).toBe(0) // was selected
      expect(ctrl.manager.getPixel(60, 60)).toBe(255) // was not selected
    })

    it('feather softens edges', () => {
      ctrl = new SelectionController(40, 40)
      ctrl.setSubTool('rectangle')
      ctrl.handlePointerDown({ x: 5, y: 5 })
      ctrl.handlePointerMove({ x: 35, y: 35 })
      ctrl.handlePointerUp()

      ctrl.feather(2)
      // Center should be fully or near-fully selected
      expect(ctrl.manager.getPixel(20, 20)).toBe(255)
      // Edge should be partially selected
      const edge = ctrl.manager.getPixel(5, 20)
      expect(edge).toBeLessThan(255)
      expect(edge).toBeGreaterThan(0)
    })
  })

  describe('selection change callback', () => {
    it('fires when selection changes', () => {
      const cb = vi.fn()
      ctrl.setSelectionChangeCallback(cb)
      ctrl.selectAll()
      expect(cb).toHaveBeenCalledWith(true, expect.any(Object))
    })

    it('fires when selection is cleared', () => {
      ctrl.selectAll()
      const cb = vi.fn()
      ctrl.setSelectionChangeCallback(cb)
      ctrl.deselect()
      expect(cb).toHaveBeenCalledWith(false, null)
    })
  })

  describe('isToolActive', () => {
    it('returns true when a tool is in progress', () => {
      ctrl.handlePointerDown({ x: 10, y: 10 })
      expect(ctrl.isToolActive()).toBe(true)
    })

    it('returns false after tool completes', () => {
      ctrl.handlePointerDown({ x: 10, y: 10 })
      ctrl.handlePointerMove({ x: 50, y: 50 })
      ctrl.handlePointerUp()
      expect(ctrl.isToolActive()).toBe(false)
    })
  })

  describe('resize', () => {
    it('resizes the manager and clears selection', () => {
      ctrl.selectAll()
      ctrl.resize(200, 150)
      expect(ctrl.hasSelection()).toBe(false)
      expect(ctrl.manager.getWidth()).toBe(200)
      expect(ctrl.manager.getHeight()).toBe(150)
    })
  })

  describe('destroy', () => {
    it('cleans up without errors', () => {
      ctrl.selectAll()
      ctrl.destroy()
    })
  })
})
