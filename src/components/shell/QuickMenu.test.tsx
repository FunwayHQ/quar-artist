import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuickMenu } from './QuickMenu.tsx'
import { useQuickMenuStore } from '@stores/quickMenuStore.ts'

describe('QuickMenu', () => {
  const onAction = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useQuickMenuStore.getState().resetToDefaults()
    useQuickMenuStore.getState().hide()
  })

  it('renders nothing when not visible', () => {
    const { container } = render(<QuickMenu onAction={onAction} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders 8 slots when visible', () => {
    useQuickMenuStore.getState().show(300, 300)
    render(<QuickMenu onAction={onAction} />)
    expect(screen.getByTestId('quick-menu')).toBeTruthy()

    for (let i = 0; i < 8; i++) {
      expect(screen.getByTestId(`quick-menu-slot-${i}`)).toBeTruthy()
    }
  })

  it('hides on Escape', () => {
    useQuickMenuStore.getState().show(300, 300)
    render(<QuickMenu onAction={onAction} />)
    expect(screen.getByTestId('quick-menu')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useQuickMenuStore.getState().visible).toBe(false)
  })

  it('executes action on slot click', () => {
    useQuickMenuStore.getState().show(300, 300)
    render(<QuickMenu onAction={onAction} />)

    fireEvent.click(screen.getByTestId('quick-menu-slot-0'))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Brush' }),
    )
  })
})
