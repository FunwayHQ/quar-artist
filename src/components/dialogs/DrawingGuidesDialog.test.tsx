import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DrawingGuidesDialog } from './DrawingGuidesDialog.tsx'
import { useGuideStore } from '@stores/guideStore.ts'

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
}))

describe('DrawingGuidesDialog', () => {
  beforeEach(() => {
    useGuideStore.getState().resetGuides()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <DrawingGuidesDialog open={false} onClose={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders dialog when open', () => {
    render(<DrawingGuidesDialog open={true} onClose={() => {}} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Drawing Guides')).toBeInTheDocument()
  })

  it('shows sidebar with all guide sections', () => {
    render(<DrawingGuidesDialog open={true} onClose={() => {}} />)
    // "Grid" appears both in the sidebar and as a section title, so use getAllByText
    expect(screen.getAllByText('Grid').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Isometric')).toBeInTheDocument()
    expect(screen.getByText('Perspective')).toBeInTheDocument()
    expect(screen.getByText('Symmetry')).toBeInTheDocument()
    expect(screen.getByText('QuickShape')).toBeInTheDocument()
  })

  it('calls onClose when Close button clicked', () => {
    const onClose = vi.fn()
    render(<DrawingGuidesDialog open={true} onClose={onClose} />)
    fireEvent.click(screen.getByText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when X button clicked', () => {
    const onClose = vi.fn()
    render(<DrawingGuidesDialog open={true} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when overlay clicked', () => {
    const onClose = vi.fn()
    render(<DrawingGuidesDialog open={true} onClose={onClose} />)
    // Click the overlay (first child)
    const overlay = screen.getByRole('dialog').parentElement!
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('toggles grid enable/disable', () => {
    render(<DrawingGuidesDialog open={true} onClose={() => {}} />)
    const toggle = screen.getByLabelText('Enable grid')
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    expect(useGuideStore.getState().gridEnabled).toBe(true)
  })

  it('switches to symmetry section and toggles enable', () => {
    render(<DrawingGuidesDialog open={true} onClose={() => {}} />)
    // Click Symmetry in sidebar
    fireEvent.click(screen.getByText('Symmetry'))
    const toggle = screen.getByLabelText('Enable symmetry')
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    expect(useGuideStore.getState().symmetryEnabled).toBe(true)
  })

  it('switches to perspective section', () => {
    render(<DrawingGuidesDialog open={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Perspective'))
    expect(screen.getByLabelText('Enable perspective guides')).toBeInTheDocument()
    expect(screen.getByText('1-point')).toBeInTheDocument()
    expect(screen.getByText('2-point')).toBeInTheDocument()
  })

  it('changes perspective type', () => {
    render(<DrawingGuidesDialog open={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Perspective'))
    fireEvent.click(screen.getByText('2-point'))
    expect(useGuideStore.getState().perspectiveType).toBe('2-point')
  })

  it('switches to QuickShape section', () => {
    render(<DrawingGuidesDialog open={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('QuickShape'))
    expect(screen.getByLabelText('Enable QuickShape')).toBeInTheDocument()
  })

  it('toggles QuickShape enable', () => {
    render(<DrawingGuidesDialog open={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('QuickShape'))
    const toggle = screen.getByLabelText('Enable QuickShape')
    fireEvent.click(toggle)
    expect(useGuideStore.getState().quickShapeEnabled).toBe(true)
  })

  it('shows symmetry type buttons', () => {
    render(<DrawingGuidesDialog open={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Symmetry'))
    expect(screen.getByText('Vertical')).toBeInTheDocument()
    expect(screen.getByText('Horizontal')).toBeInTheDocument()
    expect(screen.getByText('Quadrant')).toBeInTheDocument()
    expect(screen.getByText('Radial')).toBeInTheDocument()
  })

  it('changes symmetry type to radial and shows axes slider', () => {
    render(<DrawingGuidesDialog open={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Symmetry'))
    fireEvent.click(screen.getByText('Radial'))
    expect(useGuideStore.getState().symmetryType).toBe('radial')
    expect(screen.getByText('Axes')).toBeInTheDocument()
    expect(screen.getByText('Rotation')).toBeInTheDocument()
  })

  it('switches to isometric section and toggles', () => {
    render(<DrawingGuidesDialog open={true} onClose={() => {}} />)
    fireEvent.click(screen.getByText('Isometric'))
    const toggle = screen.getByLabelText('Enable isometric grid')
    fireEvent.click(toggle)
    expect(useGuideStore.getState().isometricEnabled).toBe(true)
  })
})
