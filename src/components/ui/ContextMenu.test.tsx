import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContextMenu } from './ContextMenu.tsx'

const items = [
  { label: 'Undo', shortcut: 'Ctrl+Z', action: vi.fn() },
  { label: 'Redo', shortcut: 'Ctrl+Y', action: vi.fn() },
  { separator: true, label: '' },
  { label: 'Select All', action: vi.fn() },
  { label: 'Disabled', action: vi.fn(), disabled: true },
]

describe('ContextMenu', () => {
  it('renders all items', () => {
    render(<ContextMenu items={items} x={100} y={100} onClose={() => {}} />)
    expect(screen.getByText('Undo')).toBeTruthy()
    expect(screen.getByText('Redo')).toBeTruthy()
    expect(screen.getByText('Select All')).toBeTruthy()
  })

  it('shows shortcut labels', () => {
    render(<ContextMenu items={items} x={100} y={100} onClose={() => {}} />)
    expect(screen.getByText('Ctrl+Z')).toBeTruthy()
  })

  it('calls action and closes on item click', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ContextMenu items={items} x={100} y={100} onClose={onClose} />)

    await user.click(screen.getByText('Undo'))
    expect(items[0].action).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape key', () => {
    const onClose = vi.fn()
    render(<ContextMenu items={items} x={100} y={100} onClose={onClose} />)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).toHaveBeenCalled()
  })
})
