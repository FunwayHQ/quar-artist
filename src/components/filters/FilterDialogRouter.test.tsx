import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FilterDialogRouter } from './FilterDialogRouter.tsx'
import { useFilterStore } from '@stores/filterStore.ts'

// Mock the CurvesEditor since it uses HTML Canvas
vi.mock('./CurvesEditor.tsx', () => ({
  CurvesEditor: () => <div data-testid="curves-editor" />,
}))

describe('FilterDialogRouter', () => {
  const onApply = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useFilterStore.setState({ activeFilter: null, params: null })
  })

  it('renders nothing when no filter is active', () => {
    const { container } = render(<FilterDialogRouter onApply={onApply} onCancel={onCancel} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders Gaussian Blur panel when gaussianBlur is active', () => {
    useFilterStore.getState().openFilter('gaussianBlur')
    render(<FilterDialogRouter onApply={onApply} onCancel={onCancel} />)
    expect(screen.getByText('Gaussian Blur')).toBeInTheDocument()
    expect(screen.getByLabelText('Radius')).toBeInTheDocument()
  })

  it('renders Sharpen panel when sharpen is active', () => {
    useFilterStore.getState().openFilter('sharpen')
    render(<FilterDialogRouter onApply={onApply} onCancel={onCancel} />)
    expect(screen.getByText('Sharpen')).toBeInTheDocument()
    expect(screen.getByLabelText('Amount')).toBeInTheDocument()
    expect(screen.getByLabelText('Threshold')).toBeInTheDocument()
  })

  it('renders HSB Adjustment panel when hsbAdjustment is active', () => {
    useFilterStore.getState().openFilter('hsbAdjustment')
    render(<FilterDialogRouter onApply={onApply} onCancel={onCancel} />)
    expect(screen.getByText('HSB Adjustment')).toBeInTheDocument()
    expect(screen.getByLabelText('Hue')).toBeInTheDocument()
    expect(screen.getByLabelText('Saturation')).toBeInTheDocument()
    expect(screen.getByLabelText('Brightness')).toBeInTheDocument()
  })

  it('renders Curves panel when curves is active', () => {
    useFilterStore.getState().openFilter('curves')
    render(<FilterDialogRouter onApply={onApply} onCancel={onCancel} />)
    expect(screen.getByText('Curves')).toBeInTheDocument()
    expect(screen.getByTestId('curves-editor')).toBeInTheDocument()
  })

  it('has Apply and Cancel buttons', () => {
    useFilterStore.getState().openFilter('gaussianBlur')
    render(<FilterDialogRouter onApply={onApply} onCancel={onCancel} />)
    expect(screen.getByText('Apply')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })
})
