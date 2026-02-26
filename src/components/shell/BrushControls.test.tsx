import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrushControls } from './BrushControls.tsx'
import { useBrushStore } from '@stores/brushStore.ts'

describe('BrushControls', () => {
  beforeEach(() => {
    useBrushStore.setState({
      activePresetId: 'round-pen',
      size: 12,
      opacity: 1,
    })
  })

  it('renders all 12 preset buttons', () => {
    render(<BrushControls />)
    expect(screen.getByText('Round Pen')).toBeInTheDocument()
    expect(screen.getByText('Airbrush')).toBeInTheDocument()
    expect(screen.getByText('Eraser')).toBeInTheDocument()
    expect(screen.getByText('Pencil')).toBeInTheDocument()
    expect(screen.getByText('Ink')).toBeInTheDocument()
    expect(screen.getByText('Watercolor')).toBeInTheDocument()
    const presetButtons = screen.getAllByTitle(/.+/)
      .filter((el) => el.classList.toString().includes('presetButton'))
    expect(presetButtons).toHaveLength(12)
  })

  it('marks active preset', () => {
    render(<BrushControls />)
    expect(screen.getByText('Round Pen').getAttribute('data-active')).toBe('true')
    expect(screen.getByText('Airbrush').getAttribute('data-active')).toBe('false')
  })

  it('switches preset on click', async () => {
    const user = userEvent.setup()
    render(<BrushControls />)
    await user.click(screen.getByText('Airbrush'))
    expect(useBrushStore.getState().activePresetId).toBe('soft-airbrush')
  })

  it('renders size slider', () => {
    render(<BrushControls />)
    const slider = screen.getByRole('slider', { name: 'Brush size' })
    expect(slider).toBeInTheDocument()
  })

  it('renders opacity slider', () => {
    render(<BrushControls />)
    const slider = screen.getByRole('slider', { name: 'Brush opacity' })
    expect(slider).toBeInTheDocument()
  })

  it('updates size via slider', () => {
    render(<BrushControls />)
    const slider = screen.getByRole('slider', { name: 'Brush size' })
    fireEvent.change(slider, { target: { value: '50' } })
    expect(useBrushStore.getState().size).toBe(50)
  })

  it('updates opacity via slider', () => {
    render(<BrushControls />)
    const slider = screen.getByRole('slider', { name: 'Brush opacity' })
    fireEvent.change(slider, { target: { value: '75' } })
    expect(useBrushStore.getState().opacity).toBeCloseTo(0.75)
  })

  it('displays current size value', () => {
    render(<BrushControls />)
    expect(screen.getByText('12px')).toBeInTheDocument()
  })

  it('displays current opacity value', () => {
    render(<BrushControls />)
    expect(screen.getByText('100%')).toBeInTheDocument()
  })
})
