import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboardShortcuts } from './useKeyboardShortcuts.ts'
import { useToolStore } from '@stores/toolStore.ts'
import { useBrushStore } from '@stores/brushStore.ts'
import { useUIStore } from '@stores/uiStore.ts'

function fireKey(key: string, opts: Partial<KeyboardEvent> = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    ...opts,
  })
  document.dispatchEvent(event)
}

describe('useKeyboardShortcuts', () => {
  const undo = vi.fn()
  const redo = vi.fn()
  const onOpenFilter = vi.fn()

  beforeEach(() => {
    undo.mockReset()
    redo.mockReset()
    onOpenFilter.mockReset()
    useToolStore.getState().setTool('brush')
    useBrushStore.getState().setSize(12)
    useBrushStore.getState().setOpacity(1)
  })

  afterEach(() => {
    // Clean up
  })

  function mount() {
    return renderHook(() =>
      useKeyboardShortcuts({
        manager: null,
        undo,
        redo,
        onOpenFilter,
      }),
    )
  }

  it('switches to eraser on E key', () => {
    mount()
    fireKey('e')
    expect(useToolStore.getState().activeTool).toBe('eraser')
  })

  it('switches to brush on B key', () => {
    useToolStore.getState().setTool('eraser')
    mount()
    fireKey('b')
    expect(useToolStore.getState().activeTool).toBe('brush')
  })

  it('calls undo on Ctrl+Z', () => {
    mount()
    fireKey('z', { ctrlKey: true })
    expect(undo).toHaveBeenCalledOnce()
  })

  it('calls redo on Ctrl+Shift+Z', () => {
    mount()
    fireKey('z', { ctrlKey: true, shiftKey: true })
    expect(redo).toHaveBeenCalledOnce()
  })

  it('increases brush size on ] key', () => {
    mount()
    fireKey(']')
    expect(useBrushStore.getState().size).toBe(17)
  })

  it('decreases brush size on [ key', () => {
    mount()
    fireKey('[')
    expect(useBrushStore.getState().size).toBe(7)
  })

  it('sets opacity on number keys', () => {
    mount()
    fireKey('5')
    expect(useBrushStore.getState().opacity).toBe(0.5)
    fireKey('0')
    expect(useBrushStore.getState().opacity).toBe(1)
  })

  it('opens shortcuts modal on ?', () => {
    mount()
    fireKey('?', { shiftKey: true })
    expect(useUIStore.getState().showShortcutsModal).toBe(true)
  })

  it('opens export dialog on Ctrl+E', () => {
    mount()
    fireKey('e', { ctrlKey: true })
    expect(useUIStore.getState().showExportDialog).toBe(true)
  })

  it('ignores shortcuts when typing in input', () => {
    mount()
    const input = document.createElement('input')
    document.body.appendChild(input)
    const event = new KeyboardEvent('keydown', { key: 'b', bubbles: true })
    Object.defineProperty(event, 'target', { value: input })
    document.dispatchEvent(event)
    expect(useToolStore.getState().activeTool).toBe('brush') // unchanged
    document.body.removeChild(input)
  })
})
