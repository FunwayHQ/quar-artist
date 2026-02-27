import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DropdownMenu, type MenuItem } from './DropdownMenu.tsx'

describe('DropdownMenu', () => {
  const onClose = vi.fn()

  const items: MenuItem[] = [
    { label: 'Undo', shortcut: 'Ctrl+Z', action: vi.fn() },
    { label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: vi.fn() },
    { separator: true, label: '' },
    { label: 'Disabled Item', action: vi.fn(), disabled: true },
  ]

  let anchorEl: HTMLButtonElement

  beforeEach(() => {
    vi.clearAllMocks()
    anchorEl = document.createElement('button')
    anchorEl.getBoundingClientRect = vi.fn(() => ({
      top: 40,
      bottom: 60,
      left: 100,
      right: 200,
      width: 100,
      height: 20,
      x: 100,
      y: 40,
      toJSON: () => {},
    }))
    document.body.appendChild(anchorEl)
  })

  afterEach(() => {
    document.body.removeChild(anchorEl)
  })

  it('renders menu items', () => {
    render(<DropdownMenu items={items} onClose={onClose} anchorEl={anchorEl} />)
    expect(screen.getByText('Undo')).toBeInTheDocument()
    expect(screen.getByText('Redo')).toBeInTheDocument()
    expect(screen.getByText('Disabled Item')).toBeInTheDocument()
  })

  it('renders shortcuts', () => {
    render(<DropdownMenu items={items} onClose={onClose} anchorEl={anchorEl} />)
    expect(screen.getByText('Ctrl+Z')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+Shift+Z')).toBeInTheDocument()
  })

  it('renders separator', () => {
    render(<DropdownMenu items={items} onClose={onClose} anchorEl={anchorEl} />)
    const separator = screen.getByRole('separator')
    expect(separator).toBeInTheDocument()
  })

  it('calls action and closes on click', () => {
    render(<DropdownMenu items={items} onClose={onClose} anchorEl={anchorEl} />)
    fireEvent.click(screen.getByText('Undo'))
    expect(items[0].action).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call action on disabled items', () => {
    render(<DropdownMenu items={items} onClose={onClose} anchorEl={anchorEl} />)
    const btn = screen.getByText('Disabled Item')
    fireEvent.click(btn)
    expect(items[3].action).not.toHaveBeenCalled()
  })

  it('closes on Escape key', () => {
    render(<DropdownMenu items={items} onClose={onClose} anchorEl={anchorEl} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('has menu role', () => {
    render(<DropdownMenu items={items} onClose={onClose} anchorEl={anchorEl} />)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('has menuitem roles for non-separator items', () => {
    render(<DropdownMenu items={items} onClose={onClose} anchorEl={anchorEl} />)
    const menuItems = screen.getAllByRole('menuitem')
    expect(menuItems.length).toBe(3) // 3 non-separator items
  })
})
