import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ValueSliders } from './ValueSliders.tsx'

describe('ValueSliders', () => {
  const defaultProps = {
    color: { h: 200, s: 0.5, b: 0.8 },
    onChange: vi.fn(),
  }

  it('renders HSB and RGB toggle buttons', () => {
    render(<ValueSliders {...defaultProps} />)
    expect(screen.getByText('HSB')).toBeInTheDocument()
    expect(screen.getByText('RGB')).toBeInTheDocument()
  })

  it('shows HSB sliders by default', () => {
    render(<ValueSliders {...defaultProps} />)
    expect(screen.getByRole('slider', { name: 'Hue' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Saturation' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Brightness' })).toBeInTheDocument()
  })

  it('shows RGB sliders when RGB mode selected', async () => {
    const user = userEvent.setup()
    render(<ValueSliders {...defaultProps} />)
    await user.click(screen.getByText('RGB'))
    expect(screen.getByRole('slider', { name: 'Red' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Green' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Blue' })).toBeInTheDocument()
  })

  it('renders hex input', () => {
    render(<ValueSliders {...defaultProps} />)
    expect(screen.getByRole('textbox', { name: 'Hex color' })).toBeInTheDocument()
  })

  it('renders color preview', () => {
    render(<ValueSliders {...defaultProps} />)
    expect(screen.getByLabelText('Color preview')).toBeInTheDocument()
  })

  it('calls onChange when hue slider changes', () => {
    const onChange = vi.fn()
    render(<ValueSliders {...defaultProps} onChange={onChange} />)
    fireEvent.change(screen.getByRole('slider', { name: 'Hue' }), { target: { value: '100' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ h: 100 }))
  })

  it('calls onChange when saturation slider changes', () => {
    const onChange = vi.fn()
    render(<ValueSliders {...defaultProps} onChange={onChange} />)
    fireEvent.change(screen.getByRole('slider', { name: 'Saturation' }), { target: { value: '75' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ s: 0.75 }))
  })

  it('displays current hue value', () => {
    render(<ValueSliders {...defaultProps} />)
    expect(screen.getByText('200°')).toBeInTheDocument()
  })

  it('displays current saturation percentage', () => {
    render(<ValueSliders {...defaultProps} />)
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('displays current brightness percentage', () => {
    render(<ValueSliders {...defaultProps} />)
    expect(screen.getByText('80%')).toBeInTheDocument()
  })
})
