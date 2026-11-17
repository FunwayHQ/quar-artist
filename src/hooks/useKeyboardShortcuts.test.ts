import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboardShortcuts } from './useKeyboardShortcuts.ts'
import { useToolStore } from '@stores/toolStore.ts'
import { useBrushStore } from '@stores/brushStore.ts'
import { useUIStore } from '@stores/uiStore.ts'
import { useProjectStore } from '@stores/projectStore.ts'

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

  it('ignores shortcuts while a saved document is still loading into the canvas (plan M1.4)', () => {
    mount()
    useProjectStore.setState({ openProgress: 0.25 })
    try {
      fireKey('e')
      fireKey('z', { ctrlKey: true })
      expect(useToolStore.getState().activeTool).toBe('brush')
      expect(undo).not.toHaveBeenCalled()
    } finally {
      useProjectStore.setState({ openProgress: null })
    }
    fireKey('e')
    expect(useToolStore.getState().activeTool).toBe('eraser')
  })

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

  it('saves on Ctrl+S (and Cmd+S), instead of the browser saving the page', () => {
    const onSave = vi.fn()
    renderHook(() => useKeyboardShortcuts({ manager: null, undo, redo, onOpenFilter, onSave }))

    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    fireKey('s', { metaKey: true })

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(event.defaultPrevented).toBe(true)
  })

  it('saves as a .qart file on Ctrl+Shift+S, and opens a file on Ctrl+O, instead of the browser (plan M1.5)', () => {
    const onSave = vi.fn()
    const onSaveAs = vi.fn()
    const onOpen = vi.fn()
    renderHook(() => useKeyboardShortcuts({ manager: null, undo, redo, onOpenFilter, onSave, onSaveAs, onOpen }))

    const saveAs = new KeyboardEvent('keydown', { key: 'S', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(saveAs)
    const open = new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(open)
    fireKey('o', { metaKey: true })

    expect(onSaveAs).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
    expect(onOpen).toHaveBeenCalledTimes(2)
    expect(saveAs.defaultPrevented).toBe(true)
    expect(open.defaultPrevented).toBe(true)
  })

  it('does not open files while a document opens (plan M1.4)', () => {
    const onOpen = vi.fn()
    renderHook(() => useKeyboardShortcuts({ manager: null, undo, redo, onOpenFilter, onOpen }))
    useProjectStore.setState({ openProgress: 0.5 })
    try {
      fireKey('o', { ctrlKey: true })
      expect(onOpen).not.toHaveBeenCalled()
    } finally {
      useProjectStore.setState({ openProgress: null })
    }
  })

  it("keeps the browser's Save Page, Open File and screenshots from running while a document opens (plan M1.5)", () => {
    const onSave = vi.fn()
    const onSaveAs = vi.fn()
    const onOpen = vi.fn()
    renderHook(() => useKeyboardShortcuts({ manager: null, undo, redo, onOpenFilter, onSave, onSaveAs, onOpen }))
    useProjectStore.setState({ openProgress: 0.5 })
    try {
      const key = (k: string, shiftKey = false) => {
        const event = new KeyboardEvent('keydown', { key: k, ctrlKey: true, shiftKey, bubbles: true, cancelable: true })
        document.dispatchEvent(event)
        return event.defaultPrevented
      }
      // Firefox takes Ctrl+Shift+S for its screenshots.
      expect({ save: key('s'), saveAs: key('S', true), open: key('o') }).toEqual({ save: true, saveAs: true, open: true })
      expect(onSave).not.toHaveBeenCalled()
      expect(onSaveAs).not.toHaveBeenCalled()
      expect(onOpen).not.toHaveBeenCalled()
    } finally {
      useProjectStore.setState({ openProgress: null })
    }
  })

  it('saves, saves as and opens once for a held key, which would read the whole document for every repeat (plan M1.5)', () => {
    const onSave = vi.fn()
    const onSaveAs = vi.fn()
    const onOpen = vi.fn()
    renderHook(() => useKeyboardShortcuts({ manager: null, undo, redo, onOpenFilter, onSave, onSaveAs, onOpen }))
    for (const repeat of [false, true, true]) {
      fireKey('s', { ctrlKey: true, repeat })
      fireKey('S', { ctrlKey: true, shiftKey: true, repeat })
      fireKey('o', { ctrlKey: true, repeat })
    }
    expect([onSave, onSaveAs, onOpen].map((f) => f.mock.calls.length)).toEqual([1, 1, 1])

    // Other shortcuts still repeat: a held ] keeps growing the brush, from 12 by 5 a press.
    fireKey(']')
    fireKey(']', { repeat: true })
    expect(useBrushStore.getState().size).toBe(22)
  })
})

