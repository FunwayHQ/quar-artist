import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFileDrop } from './useFileDrop.ts'

/**
 * A drag event on an element, as the browser fires it: jsdom has no
 * DragEvent, so a plain event carries the data transfer.
 */
function dragEvent(type: 'dragover' | 'drop', transfer: { types: string[]; files?: File[] }) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const dataTransfer = { types: transfer.types, files: transfer.files ?? [], dropEffect: 'none' }
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  return { event, dataTransfer }
}

/** An element somewhere on the page: the title bar, a panel. */
function somewhere() {
  const el = document.createElement('div')
  document.body.append(el)
  return el
}

const file = new File(['text'], 'notes.txt', { type: 'text/plain' })

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useFileDrop (plan M1.5)', () => {
  it('keeps files dropped anywhere from opening in the browser, and hands them over', () => {
    const onDrop = vi.fn()
    renderHook(() => useFileDrop(onDrop))
    const target = somewhere()

    const over = dragEvent('dragover', { types: ['Files'], files: [file] })
    target.dispatchEvent(over.event)
    expect(over.event.defaultPrevented).toBe(true)
    expect(over.dataTransfer.dropEffect).toBe('copy')

    const drop = dragEvent('drop', { types: ['Files'], files: [file] })
    target.dispatchEvent(drop.event)
    expect(drop.event.defaultPrevented).toBe(true)
    expect(onDrop).toHaveBeenCalledWith([file])
  })

  it('keeps them from opening in the browser where nothing takes them, and says they can’t be dropped', () => {
    renderHook(() => useFileDrop(null))
    const target = somewhere()

    const over = dragEvent('dragover', { types: ['Files'], files: [file] })
    target.dispatchEvent(over.event)
    expect(over.event.defaultPrevented).toBe(true)
    expect(over.dataTransfer.dropEffect).toBe('none')

    const drop = dragEvent('drop', { types: ['Files'], files: [file] })
    target.dispatchEvent(drop.event)
    expect(drop.event.defaultPrevented).toBe(true)
  })

  it('leaves drops that a drop zone on the page took to it', () => {
    const onDrop = vi.fn()
    renderHook(() => useFileDrop(onDrop))
    const zone = somewhere()
    zone.addEventListener('dragover', (e) => {
      e.preventDefault()
      ;(e as unknown as { dataTransfer: DataTransfer }).dataTransfer.dropEffect = 'copy'
    })
    zone.addEventListener('drop', (e) => e.preventDefault())

    const over = dragEvent('dragover', { types: ['Files'], files: [file] })
    zone.dispatchEvent(over.event)
    expect(over.dataTransfer.dropEffect).toBe('copy')
    zone.dispatchEvent(dragEvent('drop', { types: ['Files'], files: [file] }).event)
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('leaves drags of anything but files alone', () => {
    const onDrop = vi.fn()
    renderHook(() => useFileDrop(onDrop))
    const target = somewhere()

    const over = dragEvent('dragover', { types: ['text/plain'] })
    target.dispatchEvent(over.event)
    expect(over.event.defaultPrevented).toBe(false)
    const drop = dragEvent('drop', { types: ['text/plain'] })
    target.dispatchEvent(drop.event)
    expect(drop.event.defaultPrevented).toBe(false)
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('stops listening when it goes, and listens with the handler it has now', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender, unmount } = renderHook(({ onDrop }) => useFileDrop(onDrop), { initialProps: { onDrop: first } })
    rerender({ onDrop: second })
    somewhere().dispatchEvent(dragEvent('drop', { types: ['Files'], files: [file] }).event)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()

    unmount()
    const drop = dragEvent('drop', { types: ['Files'], files: [file] })
    somewhere().dispatchEvent(drop.event)
    expect(drop.event.defaultPrevented).toBe(false)
    expect(second).toHaveBeenCalledOnce()
  })
})
