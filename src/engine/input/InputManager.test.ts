import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { InputManager } from './InputManager.ts'
import { ViewTransform } from '../canvas/ViewTransform.ts'

function createPointerEvent(
  type: string,
  overrides: Partial<PointerEvent> = {},
): PointerEvent {
  const defaults = {
    clientX: 0,
    clientY: 0,
    pointerId: 1,
    pointerType: 'mouse',
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    getCoalescedEvents: () => [],
  }
  return new PointerEvent(type, { ...defaults, ...overrides } as PointerEventInit)
}

function createWheelEvent(overrides: Partial<WheelEvent> = {}): WheelEvent {
  return new WheelEvent('wheel', {
    deltaY: 0,
    deltaX: 0,
    clientX: 0,
    clientY: 0,
    ...overrides,
  } as WheelEventInit)
}

describe('InputManager', () => {
  let vt: ViewTransform
  let input: InputManager
  let el: HTMLDivElement

  beforeEach(() => {
    vt = new ViewTransform()
    input = new InputManager(vt)
    el = document.createElement('div')
    // Stub setPointerCapture (not available in jsdom)
    el.setPointerCapture = vi.fn()
    el.releasePointerCapture = vi.fn()
    document.body.appendChild(el)
    input.attach(el)
  })

  afterEach(() => {
    input.detach()
    document.body.removeChild(el)
  })

  describe('attach/detach', () => {
    it('adds event listeners on attach', () => {
      const spy = vi.spyOn(el, 'addEventListener')
      const input2 = new InputManager(vt)
      input2.attach(el)
      expect(spy).toHaveBeenCalledWith('pointerdown', expect.any(Function))
      expect(spy).toHaveBeenCalledWith('pointermove', expect.any(Function))
      expect(spy).toHaveBeenCalledWith('pointerup', expect.any(Function))
      expect(spy).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false })
      input2.detach()
    })

    it('removes event listeners on detach', () => {
      const spy = vi.spyOn(el, 'removeEventListener')
      input.detach()
      expect(spy).toHaveBeenCalledWith('pointerdown', expect.any(Function))
      expect(spy).toHaveBeenCalledWith('pointermove', expect.any(Function))
      expect(spy).toHaveBeenCalledWith('pointerup', expect.any(Function))
      expect(spy).toHaveBeenCalledWith('wheel', expect.any(Function))
    })

    it('detach is safe to call twice', () => {
      input.detach()
      expect(() => input.detach()).not.toThrow()
    })
  })

  describe('stroke callbacks', () => {
    it('fires onPointerDown for single pointer', () => {
      const onDown = vi.fn()
      input.setStrokeCallbacks({ onPointerDown: onDown })
      el.dispatchEvent(createPointerEvent('pointerdown', { clientX: 50, clientY: 60 }))
      expect(onDown).toHaveBeenCalledTimes(1)
      expect(onDown).toHaveBeenCalledWith(
        expect.objectContaining({ x: 50, y: 60 }),
      )
    })

    it('fires onPointerMove with coalesced and predicted events', () => {
      const onMove = vi.fn()
      input.setStrokeCallbacks({ onPointerMove: onMove })
      el.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 1 }))
      el.dispatchEvent(createPointerEvent('pointermove', { pointerId: 1, clientX: 10, clientY: 20 }))
      expect(onMove).toHaveBeenCalledTimes(1)
      expect(onMove).toHaveBeenCalledWith(
        expect.objectContaining({ x: 10, y: 20 }),
        expect.any(Array),
        expect.any(Array),
      )
    })

    it('fires onPointerUp when all pointers released', () => {
      const onUp = vi.fn()
      input.setStrokeCallbacks({ onPointerUp: onUp })
      el.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 1 }))
      el.dispatchEvent(createPointerEvent('pointerup', { pointerId: 1 }))
      expect(onUp).toHaveBeenCalledTimes(1)
    })

    it('does not fire stroke callbacks during space+drag pan', () => {
      const onDown = vi.fn()
      const onMove = vi.fn()
      input.setStrokeCallbacks({ onPointerDown: onDown, onPointerMove: onMove })

      // Press space first
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
      el.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 1 }))
      el.dispatchEvent(createPointerEvent('pointermove', { pointerId: 1, clientX: 50, clientY: 50 }))

      expect(onDown).not.toHaveBeenCalled()
      expect(onMove).not.toHaveBeenCalled()

      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }))
    })
  })

  describe('space+drag panning', () => {
    it('pans the view transform when space is held and pointer drags', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
      el.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 }))
      el.dispatchEvent(createPointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 130 }))

      const state = vt.getState()
      expect(state.x).toBe(20)
      expect(state.y).toBe(30)

      el.dispatchEvent(createPointerEvent('pointerup', { pointerId: 1 }))
      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }))
    })

    it('sets grab cursor when space is pressed', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
      expect(el.style.cursor).toBe('grab')

      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }))
      expect(el.style.cursor).toBe('')
    })
  })

  describe('wheel zoom', () => {
    it('zooms on mouse wheel', () => {
      el.dispatchEvent(createWheelEvent({ deltaY: -100, clientX: 50, clientY: 50 }))
      expect(vt.getState().zoom).toBeGreaterThan(1)
    })

    it('zooms with Ctrl+wheel (trackpad pinch)', () => {
      el.dispatchEvent(createWheelEvent({ deltaY: -100, clientX: 50, clientY: 50, ctrlKey: true }))
      expect(vt.getState().zoom).toBeGreaterThan(1)
    })

    it('pans with Shift+wheel', () => {
      el.dispatchEvent(createWheelEvent({ deltaY: 50, shiftKey: true }))
      const state = vt.getState()
      // Shift+wheel pans
      expect(state.x).toBe(-50)
      expect(state.zoom).toBe(1) // zoom unchanged
    })
  })

  describe('two-finger drag pan', () => {
    it('pans the view when two pointers move together', () => {
      // Put down first pointer
      el.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 }))
      // Put down second pointer — starts gesture with center=(150,150)
      el.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 2, clientX: 200, clientY: 200 }))

      // Move BOTH pointers by the same amount (+20,+20) to pan without zoom/rotate
      el.dispatchEvent(createPointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 120 }))
      el.dispatchEvent(createPointerEvent('pointermove', { pointerId: 2, clientX: 220, clientY: 220 }))

      // After both moves, center went from (150,150) to (170,170)
      // Pan delta should accumulate to ~20 in each axis
      const state = vt.getState()
      expect(state.x).toBeCloseTo(20, 0)
      expect(state.y).toBeCloseTo(20, 0)

      // Cleanup
      el.dispatchEvent(createPointerEvent('pointerup', { pointerId: 1 }))
      el.dispatchEvent(createPointerEvent('pointerup', { pointerId: 2 }))
    })

    it('does not fire stroke callbacks during two-finger gesture', () => {
      const onDown = vi.fn()
      const onMove = vi.fn()
      input.setStrokeCallbacks({ onPointerDown: onDown, onPointerMove: onMove })

      el.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 }))
      el.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 2, clientX: 200, clientY: 200 }))
      el.dispatchEvent(createPointerEvent('pointermove', { pointerId: 1, clientX: 120, clientY: 120 }))

      // onPointerDown fires for the first pointer but not subsequent gesture moves
      expect(onDown).toHaveBeenCalledTimes(1) // first pointer down only
      expect(onMove).not.toHaveBeenCalled()

      el.dispatchEvent(createPointerEvent('pointerup', { pointerId: 1 }))
      el.dispatchEvent(createPointerEvent('pointerup', { pointerId: 2 }))
    })
  })

  describe('predicted events', () => {
    it('passes predicted events array to onPointerMove', () => {
      const onMove = vi.fn()
      input.setStrokeCallbacks({ onPointerMove: onMove })
      el.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 1 }))
      el.dispatchEvent(createPointerEvent('pointermove', { pointerId: 1, clientX: 10, clientY: 10 }))

      expect(onMove).toHaveBeenCalledTimes(1)
      // Third argument is the predicted events array
      const thirdArg = onMove.mock.calls[0][2]
      expect(Array.isArray(thirdArg)).toBe(true)
    })

    it('extracts predicted events when getPredictedEvents is available', () => {
      const onMove = vi.fn()
      input.setStrokeCallbacks({ onPointerMove: onMove })

      el.dispatchEvent(createPointerEvent('pointerdown', { pointerId: 1 }))

      // Create event with getPredictedEvents returning mock data
      const moveEvent = createPointerEvent('pointermove', { pointerId: 1, clientX: 20, clientY: 30 })
      const predictedEvent = createPointerEvent('pointermove', { pointerId: 1, clientX: 25, clientY: 35 })
      Object.defineProperty(moveEvent, 'getPredictedEvents', {
        value: () => [predictedEvent],
      })

      el.dispatchEvent(moveEvent)

      expect(onMove).toHaveBeenCalledTimes(1)
      const predicted = onMove.mock.calls[0][2]
      expect(predicted).toHaveLength(1)
      expect(predicted[0].x).toBe(25)
      expect(predicted[0].y).toBe(35)
    })
  })

  describe('ignores pointermove for untracked pointers', () => {
    it('does not fire callbacks for unknown pointerId', () => {
      const onMove = vi.fn()
      input.setStrokeCallbacks({ onPointerMove: onMove })
      // Send move without a prior down
      el.dispatchEvent(createPointerEvent('pointermove', { pointerId: 999, clientX: 10, clientY: 10 }))
      expect(onMove).not.toHaveBeenCalled()
    })
  })
})
