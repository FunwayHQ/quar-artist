import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuickMenuSettingsDialog } from './QuickMenuSettingsDialog.tsx'
import { useQuickMenuStore } from '@stores/quickMenuStore.ts'
import { DEFAULT_QUICK_MENU_SLOTS } from '../../types/quickmenu.ts'

describe('QuickMenuSettingsDialog', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useQuickMenuStore.getState().resetToDefaults()
  })

  it('renders nothing when not open', () => {
    const { container } = render(<QuickMenuSettingsDialog open={false} onClose={onClose} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders 8 slot rows when open', () => {
    render(<QuickMenuSettingsDialog open={true} onClose={onClose} />)
    for (let i = 0; i < 8; i++) {
      expect(screen.getByTestId(`quickmenu-slot-row-${i}`)).toBeTruthy()
    }
  })

  it('reset button restores defaults', () => {
    // Modify a slot first
    useQuickMenuStore.getState().setSlot(0, {
      label: 'Text',
      icon: 'Type',
      actionType: { kind: 'tool', tool: 'text' },
    })

    render(<QuickMenuSettingsDialog open={true} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('quickmenu-reset'))

    expect(useQuickMenuStore.getState().slots).toEqual(DEFAULT_QUICK_MENU_SLOTS)
  })
})
