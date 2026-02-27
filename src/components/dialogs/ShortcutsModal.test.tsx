import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShortcutsModal } from './ShortcutsModal.tsx'

describe('ShortcutsModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<ShortcutsModal open={false} onClose={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders shortcut categories when open', () => {
    render(<ShortcutsModal open={true} onClose={() => {}} />)
    expect(screen.getByText('Keyboard Shortcuts')).toBeTruthy()
    expect(screen.getByText('Tools')).toBeTruthy()
    expect(screen.getByText('Edit')).toBeTruthy()
    expect(screen.getByText('View')).toBeTruthy()
  })

  it('shows tool shortcuts', () => {
    render(<ShortcutsModal open={true} onClose={() => {}} />)
    expect(screen.getByText('Brush')).toBeTruthy()
    expect(screen.getByText('Eraser')).toBeTruthy()
  })

  it('filters by search query', async () => {
    const user = userEvent.setup()
    render(<ShortcutsModal open={true} onClose={() => {}} />)

    const input = screen.getByPlaceholderText('Search shortcuts...')
    await user.type(input, 'undo')

    expect(screen.getByText('Undo')).toBeTruthy()
    expect(screen.queryByText('Brush')).toBeNull()
  })

  it('shows empty state when no matches', async () => {
    const user = userEvent.setup()
    render(<ShortcutsModal open={true} onClose={() => {}} />)

    const input = screen.getByPlaceholderText('Search shortcuts...')
    await user.type(input, 'zzzzzzz')

    expect(screen.getByText(/No shortcuts match/)).toBeTruthy()
  })

  it('closes on Escape key', () => {
    const onClose = vi.fn()
    render(<ShortcutsModal open={true} onClose={onClose} />)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on overlay click', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ShortcutsModal open={true} onClose={onClose} />)

    // Click the overlay (the outer div)
    const overlay = screen.getByRole('dialog').parentElement!
    await user.click(overlay)
    expect(onClose).toHaveBeenCalled()
  })
})
