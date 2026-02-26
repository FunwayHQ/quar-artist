import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrushControls } from './BrushControls.tsx'
import { useBrushStore } from '@stores/brushStore.ts'
import { useToolStore } from '@stores/toolStore.ts'
import { useSelectionStore } from '@stores/selectionStore.ts'

describe('BrushControls', () => {
  beforeEach(() => {
    useBrushStore.setState({
      activePresetId: 'round-pen',
      size: 12,
      opacity: 1,
    })
    useToolStore.setState({ activeTool: 'brush' })
    useSelectionStore.setState({
      activeSubTool: 'rectangle',
      magicWandOptions: { tolerance: 10, contiguous: true },
      featherOptions: { radius: 0 },
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

  it('does not show brush options when selection tool active', () => {
    useToolStore.setState({ activeTool: 'selection' })
    render(<BrushControls />)
    expect(screen.queryByLabelText('Brush size')).not.toBeInTheDocument()
  })
})

describe('BrushControls — selection mode', () => {
  beforeEach(() => {
    useToolStore.setState({ activeTool: 'selection' })
    useSelectionStore.setState({
      activeSubTool: 'rectangle',
      magicWandOptions: { tolerance: 10, contiguous: true },
      featherOptions: { radius: 0 },
    })
  })

  it('shows selection sub-tool buttons', () => {
    render(<BrushControls />)
    expect(screen.getByText('Rect')).toBeInTheDocument()
    expect(screen.getByText('Ellipse')).toBeInTheDocument()
    expect(screen.getByText('Lasso')).toBeInTheDocument()
    expect(screen.getByText('Wand')).toBeInTheDocument()
  })

  it('marks active sub-tool', () => {
    render(<BrushControls />)
    expect(screen.getByText('Rect').getAttribute('data-active')).toBe('true')
    expect(screen.getByText('Ellipse').getAttribute('data-active')).toBe('false')
  })

  it('switches sub-tool on click', async () => {
    const user = userEvent.setup()
    render(<BrushControls />)
    await user.click(screen.getByText('Ellipse'))
    expect(useSelectionStore.getState().activeSubTool).toBe('ellipse')
  })

  it('shows feather radius slider', () => {
    render(<BrushControls />)
    const slider = screen.getByRole('slider', { name: 'Feather radius' })
    expect(slider).toBeInTheDocument()
  })

  it('updates feather radius via slider', () => {
    render(<BrushControls />)
    const slider = screen.getByRole('slider', { name: 'Feather radius' })
    fireEvent.change(slider, { target: { value: '5' } })
    expect(useSelectionStore.getState().featherOptions.radius).toBe(5)
  })

  it('does not show tolerance slider for rectangle tool', () => {
    render(<BrushControls />)
    expect(screen.queryByLabelText('Magic wand tolerance')).not.toBeInTheDocument()
  })

  it('shows tolerance slider for magic wand tool', () => {
    useSelectionStore.setState({ activeSubTool: 'magicWand' })
    render(<BrushControls />)
    const slider = screen.getByRole('slider', { name: 'Magic wand tolerance' })
    expect(slider).toBeInTheDocument()
  })

  it('updates tolerance via slider', () => {
    useSelectionStore.setState({ activeSubTool: 'magicWand' })
    render(<BrushControls />)
    const slider = screen.getByRole('slider', { name: 'Magic wand tolerance' })
    fireEvent.change(slider, { target: { value: '50' } })
    expect(useSelectionStore.getState().magicWandOptions.tolerance).toBe(50)
  })

  it('shows contiguous checkbox for magic wand tool', () => {
    useSelectionStore.setState({ activeSubTool: 'magicWand' })
    render(<BrushControls />)
    expect(screen.getByText('Contiguous')).toBeInTheDocument()
  })

  it('toggles contiguous checkbox', async () => {
    useSelectionStore.setState({ activeSubTool: 'magicWand' })
    const user = userEvent.setup()
    render(<BrushControls />)
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeChecked()
    await user.click(checkbox)
    expect(useSelectionStore.getState().magicWandOptions.contiguous).toBe(false)
  })

  it('displays feather radius value', () => {
    useSelectionStore.setState({ featherOptions: { radius: 8 } })
    render(<BrushControls />)
    expect(screen.getByText('8px')).toBeInTheDocument()
  })

  it('displays tolerance value', () => {
    useSelectionStore.setState({ activeSubTool: 'magicWand', magicWandOptions: { tolerance: 25, contiguous: true } })
    render(<BrushControls />)
    expect(screen.getByText('25')).toBeInTheDocument()
  })
})
