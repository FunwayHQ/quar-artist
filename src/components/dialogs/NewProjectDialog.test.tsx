import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewProjectDialog } from './NewProjectDialog.tsx'

describe('NewProjectDialog', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onCreate: vi.fn(),
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

    expect(defaultProps.onCreate).toHaveBeenCalledWith('My Art', 1920, 1080, 72)
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
