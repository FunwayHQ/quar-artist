import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TimelapseExportDialog } from './TimelapseExportDialog.tsx'

// Mock URL.createObjectURL / revokeObjectURL
const mockUrl = 'blob:mock-url'
vi.stubGlobal('URL', {
  ...globalThis.URL,
  createObjectURL: vi.fn().mockReturnValue(mockUrl),
  revokeObjectURL: vi.fn(),
})

describe('TimelapseExportDialog', () => {
  const blob = new Blob(['test'], { type: 'video/webm' })
  const defaultProps = {
    open: true,
    videoBlob: blob,
    frameCount: 50,
    onDownload: vi.fn(),
    onDiscard: vi.fn(),
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when not open', () => {
    const { container } = render(<TimelapseExportDialog {...defaultProps} open={false} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders video element with blob URL', () => {
    render(<TimelapseExportDialog {...defaultProps} />)
    const video = screen.getByTestId('timelapse-video') as HTMLVideoElement
    expect(video.src).toContain(mockUrl)
  })

  it('shows frame count and estimated duration', () => {
    render(<TimelapseExportDialog {...defaultProps} />)
    expect(screen.getByText('50')).toBeTruthy()
    expect(screen.getByText('5.0s')).toBeTruthy()
  })

  it('download button calls onDownload', () => {
    render(<TimelapseExportDialog {...defaultProps} />)
    fireEvent.click(screen.getByTestId('timelapse-download'))
    expect(defaultProps.onDownload).toHaveBeenCalledTimes(1)
  })

  it('discard button calls onDiscard', () => {
    render(<TimelapseExportDialog {...defaultProps} />)
    fireEvent.click(screen.getByText('Discard'))
    expect(defaultProps.onDiscard).toHaveBeenCalledTimes(1)
  })
})
