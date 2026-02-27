import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrushStudio } from './BrushStudio.tsx'

// Mock lucide-react
vi.mock('lucide-react', () => ({
  X: () => <span data-testid="x-icon">X</span>,
}))

describe('BrushStudio', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<BrushStudio open={false} onClose={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders dialog when open', () => {
    render(<BrushStudio open={true} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByText('Brush Studio')).toBeDefined()
  })

  it('shows tab buttons', () => {
    render(<BrushStudio open={true} onClose={vi.fn()} />)
    expect(screen.getByText('Shape')).toBeDefined()
    expect(screen.getByText('Dynamics')).toBeDefined()
    expect(screen.getByText('Texture')).toBeDefined()
    expect(screen.getByText('Transfer')).toBeDefined()
    expect(screen.getByText('Scatter')).toBeDefined()
    expect(screen.getByText('Smoothing')).toBeDefined()
  })

  it('switches tabs on click', () => {
    render(<BrushStudio open={true} onClose={vi.fn()} />)
    const scatterTab = screen.getByText('Scatter')
    fireEvent.click(scatterTab)
    expect(screen.getByText('Scatter Amount')).toBeDefined()
  })

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn()
    render(<BrushStudio open={true} onClose={onClose} />)
    const closeBtn = screen.getByLabelText('Close')
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when Close button in footer clicked', () => {
    const onClose = vi.fn()
    render(<BrushStudio open={true} onClose={onClose} />)
    const closeBtn = screen.getByText('Close')
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows preset list in sidebar', () => {
    render(<BrushStudio open={true} onClose={vi.fn()} />)
    // Default presets should show in the sidebar
    expect(screen.getByText('Round Pen')).toBeDefined()
    // Some preset names overlap with texture labels so use getAllByText
    expect(screen.getAllByText('Oil').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Eraser')).toBeDefined()
  })

  it('opens save dialog when Save as Preset is clicked', () => {
    render(<BrushStudio open={true} onClose={vi.fn()} />)
    const saveBtn = screen.getByText('Save as Preset')
    fireEvent.click(saveBtn)
    // The nested save dialog should appear
    expect(screen.getByLabelText('Preset name')).toBeDefined()
    expect(screen.getByText('Save Preset')).toBeDefined()
    expect(screen.getByText('Cancel')).toBeDefined()
    expect(screen.getByRole('dialog', { name: 'Save Brush Preset' })).toBeDefined()
  })

  it('closes save dialog when Cancel is clicked', () => {
    render(<BrushStudio open={true} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Save as Preset'))
    expect(screen.getByLabelText('Preset name')).toBeDefined()
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByLabelText('Preset name')).toBeNull()
  })

  it('pre-fills save input with current preset name + Copy', () => {
    render(<BrushStudio open={true} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Save as Preset'))
    const input = screen.getByLabelText('Preset name') as HTMLInputElement
    expect(input.value).toContain('Copy')
  })

  it('disables save button when name is empty', () => {
    render(<BrushStudio open={true} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Save as Preset'))
    const input = screen.getByLabelText('Preset name') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    const saveConfirmBtn = screen.getByText('Save Preset')
    expect(saveConfirmBtn.hasAttribute('disabled')).toBe(true)
  })
})
