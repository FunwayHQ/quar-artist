import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewProjectDialog } from './NewProjectDialog.tsx'

describe('NewProjectDialog', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onCreate: vi.fn(),
    maxSide: 8192,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when not open', () => {
    const { container } = render(<NewProjectDialog {...defaultProps} open={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders dialog when open', () => {
    render(<NewProjectDialog {...defaultProps} />)
    expect(screen.getByText('New Project')).toBeInTheDocument()
  })

  it('has a project name input', () => {
    render(<NewProjectDialog {...defaultProps} />)
    expect(screen.getByLabelText('Project name')).toBeInTheDocument()
  })

  it('has width and height inputs', () => {
    render(<NewProjectDialog {...defaultProps} />)
    expect(screen.getByLabelText('Canvas width')).toBeInTheDocument()
    expect(screen.getByLabelText('Canvas height')).toBeInTheDocument()
  })

  it('has a DPI selector', () => {
    render(<NewProjectDialog {...defaultProps} />)
    expect(screen.getByLabelText('DPI')).toBeInTheDocument()
  })

  it('shows canvas preset buttons', () => {
    render(<NewProjectDialog {...defaultProps} />)
    expect(screen.getByText('1080 × 1080 (Square)')).toBeInTheDocument()
    expect(screen.getByText('1920 × 1080 (HD)')).toBeInTheDocument()
  })

  it('applies preset dimensions on click', async () => {
    const user = userEvent.setup()
    render(<NewProjectDialog {...defaultProps} />)
    await user.click(screen.getByText('1080 × 1080 (Square)'))

    const widthInput = screen.getByLabelText('Canvas width') as HTMLInputElement
    const heightInput = screen.getByLabelText('Canvas height') as HTMLInputElement
    expect(widthInput.value).toBe('1080')
    expect(heightInput.value).toBe('1080')
  })

  it('calls onCreate with entered values', async () => {
    const user = userEvent.setup()
    render(<NewProjectDialog {...defaultProps} />)

    const nameInput = screen.getByLabelText('Project name') as HTMLInputElement
    await user.clear(nameInput)
    await user.type(nameInput, 'My Art')

    await user.click(screen.getByText('Create'))

    expect(defaultProps.onCreate).toHaveBeenCalledWith({
      name: 'My Art',
      width: 1920,
      height: 1080,
      dpi: 72,
      colorSpace: 'srgb',
    })
  })

  it('names a project Untitled when the name is blank', async () => {
    const user = userEvent.setup()
    render(<NewProjectDialog {...defaultProps} />)
    await user.clear(screen.getByLabelText('Project name'))
    await user.type(screen.getByLabelText('Project name'), '   ')
    await user.click(screen.getByText('Create'))
    expect(defaultProps.onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Untitled' }))
  })

  describe('size limits (PRD 4.2)', () => {
    it('refuses a side beyond what the device supports, and says why', () => {
      render(<NewProjectDialog {...defaultProps} />)
      fireEvent.change(screen.getByLabelText('Canvas width'), { target: { value: '8193' } })

      expect(screen.getByRole('alert')).toHaveTextContent('up to 8192 × 8192 px')
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))
      expect(defaultProps.onCreate).not.toHaveBeenCalled()
    })

    it('accepts the largest supported side', () => {
      render(<NewProjectDialog {...defaultProps} />)
      fireEvent.change(screen.getByLabelText('Canvas width'), { target: { value: '8192' } })
      fireEvent.change(screen.getByLabelText('Canvas height'), { target: { value: '8192' } })
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
    })

    it('uses the smaller mobile limit when given one', () => {
      render(<NewProjectDialog {...defaultProps} maxSide={4096} />)
      fireEvent.change(screen.getByLabelText('Canvas height'), { target: { value: '5000' } })
      expect(screen.getByRole('alert')).toHaveTextContent('up to 4096 × 4096 px')
    })

    it('hides presets the device can\'t make', () => {
      render(<NewProjectDialog {...defaultProps} maxSide={3000} />)
      expect(screen.getByText('2048 × 2048')).toBeInTheDocument()
      expect(screen.queryByText('4096 × 4096')).toBeNull()
      expect(screen.queryByText('A4 300 DPI')).toBeNull()
    })

    it('refuses sizes that are not whole numbers of at least 1 px', () => {
      render(<NewProjectDialog {...defaultProps} />)
      fireEvent.change(screen.getByLabelText('Canvas width'), { target: { value: '0' } })
      expect(screen.getByRole('alert')).toHaveTextContent('at least 1 px')
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    })
  })

  describe('DPI', () => {
    it('offers 72, 150, 300, 600 and Custom', () => {
      render(<NewProjectDialog {...defaultProps} />)
      const options = Array.from((screen.getByLabelText('DPI') as HTMLSelectElement).options).map((o) => o.text)
      expect(options).toEqual(['72', '150', '300', '600', 'Custom…'])
    })

    it('takes a custom value', async () => {
      const user = userEvent.setup()
      render(<NewProjectDialog {...defaultProps} />)
      fireEvent.change(screen.getByLabelText('DPI'), { target: { value: 'custom' } })
      fireEvent.change(screen.getByLabelText('Custom DPI'), { target: { value: '240' } })
      await user.click(screen.getByText('Create'))
      expect(defaultProps.onCreate).toHaveBeenCalledWith(expect.objectContaining({ dpi: 240 }))
    })

    it('refuses a custom value out of range', () => {
      render(<NewProjectDialog {...defaultProps} />)
      fireEvent.change(screen.getByLabelText('DPI'), { target: { value: 'custom' } })
      fireEvent.change(screen.getByLabelText('Custom DPI'), { target: { value: '0' } })
      expect(screen.getByRole('alert')).toHaveTextContent('DPI must be a whole number from 1 to 9600')
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    })

    it('takes a preset\'s DPI', async () => {
      const user = userEvent.setup()
      render(<NewProjectDialog {...defaultProps} />)
      await user.click(screen.getByText('A4 300 DPI'))
      expect((screen.getByLabelText('DPI') as HTMLSelectElement).value).toBe('300')
      await user.click(screen.getByText('Create'))
      expect(defaultProps.onCreate).toHaveBeenCalledWith(expect.objectContaining({ width: 2480, height: 3508, dpi: 300 }))
    })
  })

  it('offers sRGB now, and Display P3 as not available yet', () => {
    render(<NewProjectDialog {...defaultProps} />)
    const select = screen.getByLabelText('Colour space') as HTMLSelectElement
    expect(select.value).toBe('srgb')
    const p3 = Array.from(select.options).find((o) => o.value === 'display-p3')!
    expect(p3.disabled).toBe(true)
  })

  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup()
    render(<NewProjectDialog {...defaultProps} />)
    await user.click(screen.getByText('Cancel'))
    expect(defaultProps.onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when overlay is clicked', async () => {
    const user = userEvent.setup()
    render(<NewProjectDialog {...defaultProps} />)
    // Click the overlay (parent element of the dialog)
    const overlay = screen.getByRole('dialog').parentElement!
    await user.click(overlay)
    expect(defaultProps.onClose).toHaveBeenCalled()
  })

  it('allows changing DPI', () => {
    render(<NewProjectDialog {...defaultProps} />)
    const dpiSelect = screen.getByLabelText('DPI') as HTMLSelectElement
    fireEvent.change(dpiSelect, { target: { value: '300' } })
    expect(dpiSelect.value).toBe('300')
  })

  it('updates width input', () => {
    render(<NewProjectDialog {...defaultProps} />)
    const widthInput = screen.getByLabelText('Canvas width') as HTMLInputElement
    fireEvent.change(widthInput, { target: { value: '4096' } })
    expect(widthInput.value).toBe('4096')
  })
})
