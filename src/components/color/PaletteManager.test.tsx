import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PaletteManager } from './PaletteManager.tsx'
import type { ColorPalette } from '../../types/color.ts'

const testPalettes: ColorPalette[] = [
  {
    id: 'test-1',
    name: 'Test Palette',
    swatches: [
      { color: { h: 0, s: 1, b: 1 } },
      { color: { h: 120, s: 1, b: 1 } },
      { color: { h: 240, s: 1, b: 1 } },
    ],
  },
  {
    id: 'test-2',
    name: 'Another Palette',
    swatches: [],
  },
]

describe('PaletteManager', () => {
  const defaultProps = {
    palettes: testPalettes,
    activePaletteId: 'test-1',
    currentColor: { h: 0, s: 1, b: 1 },
    onSetActivePalette: vi.fn(),
    onAddSwatch: vi.fn(),
    onRemoveSwatch: vi.fn(),
    onSelectColor: vi.fn(),
    onCreatePalette: vi.fn(),
    onDeletePalette: vi.fn(),
    onImportPalette: vi.fn(),
  }

  it('renders palette selector', () => {
    render(<PaletteManager {...defaultProps} />)
    const select = screen.getByRole('combobox', { name: 'Active palette' })
    expect(select).toBeInTheDocument()
  })

  it('lists all palettes in selector', () => {
    render(<PaletteManager {...defaultProps} />)
    const select = screen.getByRole('combobox', { name: 'Active palette' }) as HTMLSelectElement
    expect(select.options).toHaveLength(2)
    expect(select.options[0].text).toBe('Test Palette')
  })

  it('renders swatches for active palette', () => {
    render(<PaletteManager {...defaultProps} />)
    // 3 color swatches inside the listbox (not the select options)
    const listbox = screen.getByRole('listbox', { name: 'Color swatches' })
    const swatches = listbox.querySelectorAll('[role="option"]')
    expect(swatches).toHaveLength(3)
  })

  it('renders new palette button', () => {
    render(<PaletteManager {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'New palette' })).toBeInTheDocument()
  })

  it('calls onCreatePalette on new button click', async () => {
    const onCreate = vi.fn()
    const user = userEvent.setup()
    render(<PaletteManager {...defaultProps} onCreatePalette={onCreate} />)
    await user.click(screen.getByRole('button', { name: 'New palette' }))
    expect(onCreate).toHaveBeenCalled()
  })

  it('renders add swatch button', () => {
    render(<PaletteManager {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'Add current color to palette' })).toBeInTheDocument()
  })

  it('calls onAddSwatch when clicking add', async () => {
    const onAdd = vi.fn()
    const user = userEvent.setup()
    render(<PaletteManager {...defaultProps} onAddSwatch={onAdd} />)
    await user.click(screen.getByRole('button', { name: 'Add current color to palette' }))
    expect(onAdd).toHaveBeenCalledWith('test-1')
  })

  it('calls onSelectColor when clicking a swatch', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<PaletteManager {...defaultProps} onSelectColor={onSelect} />)
    const listbox = screen.getByRole('listbox', { name: 'Color swatches' })
    const swatches = listbox.querySelectorAll('[role="option"]')
    await user.click(swatches[0] as HTMLElement)
    expect(onSelect).toHaveBeenCalledWith({ h: 0, s: 1, b: 1 })
  })

  it('renders export button', () => {
    render(<PaletteManager {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'Export palette' })).toBeInTheDocument()
  })

  it('renders import button', () => {
    render(<PaletteManager {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'Import palette' })).toBeInTheDocument()
  })

  it('disables delete when only 1 palette', () => {
    render(
      <PaletteManager
        {...defaultProps}
        palettes={[testPalettes[0]]}
      />
    )
    const deleteBtn = screen.getByRole('button', { name: 'Delete palette' })
    expect(deleteBtn).toBeDisabled()
  })
})
