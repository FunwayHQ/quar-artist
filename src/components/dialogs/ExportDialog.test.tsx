import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportDialog } from './ExportDialog.tsx'

describe('ExportDialog', () => {
  const defaultProps = {
    open: true,
    projectName: 'My Painting',
    width: 1920,
    height: 1080,
    layerCount: 3,
    onClose: vi.fn(),
    onExport: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when not open', () => {
    const { container } = render(<ExportDialog {...defaultProps} open={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders dialog when open', () => {
    render(<ExportDialog {...defaultProps} />)
    expect(screen.getByText('Export')).toBeInTheDocument()
  })

  it('shows format tabs', () => {
    render(<ExportDialog {...defaultProps} />)
    expect(screen.getByText('PNG')).toBeInTheDocument()
    expect(screen.getByText('JPEG')).toBeInTheDocument()
    expect(screen.getByText('PSD')).toBeInTheDocument()
    expect(screen.getByText('QART')).toBeInTheDocument()
  })

  it('shows project details', () => {
    render(<ExportDialog {...defaultProps} />)
    expect(screen.getByText('My Painting')).toBeInTheDocument()
    expect(screen.getByText('1920 × 1080')).toBeInTheDocument()
  })

  it('PNG is default selected format', () => {
    render(<ExportDialog {...defaultProps} />)
    const pngTab = screen.getByText('PNG')
    expect(pngTab.getAttribute('data-active')).toBe('true')
  })

  it('switches to JPEG format and shows quality controls', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)
    await user.click(screen.getByText('JPEG'))

    expect(screen.getByText('JPEG').getAttribute('data-active')).toBe('true')
    expect(screen.getByLabelText('JPEG quality')).toBeInTheDocument()
    expect(screen.getByText('Low')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('does not show quality slider for PNG', () => {
    render(<ExportDialog {...defaultProps} />)
    expect(screen.queryByLabelText('JPEG quality')).not.toBeInTheDocument()
  })

  it('shows layer count for PSD format', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)
    await user.click(screen.getByText('PSD'))
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows layer count for QART format', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)
    await user.click(screen.getByText('QART'))
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('calls onExport with PNG format', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)
    await user.click(screen.getByText('Export PNG'))
    expect(defaultProps.onExport).toHaveBeenCalledWith({
      format: 'png',
      jpegQuality: 0.85,
    })
  })

  it('calls onExport with JPEG format and quality', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)
    await user.click(screen.getByText('JPEG'))
    await user.click(screen.getByText('Low'))
    await user.click(screen.getByText('Export JPEG'))
    expect(defaultProps.onExport).toHaveBeenCalledWith({
      format: 'jpeg',
      jpegQuality: 0.3,
    })
  })

  it('updates quality with slider', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)
    await user.click(screen.getByText('JPEG'))
    const slider = screen.getByLabelText('JPEG quality')
    fireEvent.change(slider, { target: { value: '50' } })
    expect(screen.getByText('Quality: 50%')).toBeInTheDocument()
  })

  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup()
    render(<ExportDialog {...defaultProps} />)
    await user.click(screen.getByText('Cancel'))
    expect(defaultProps.onClose).toHaveBeenCalledOnce()
  })
})
