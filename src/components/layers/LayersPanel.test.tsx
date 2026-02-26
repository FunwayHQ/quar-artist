import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LayersPanel } from './LayersPanel.tsx'
import { useLayerStore } from '@stores/layerStore.ts'
import type { LayerInfo } from '../../types/layer.ts'

const layer1: LayerInfo = {
  id: 'l1',
  name: 'Background',
  visible: true,
  opacity: 1,
  blendMode: 'normal',
  alphaLock: false,
  clippingMask: false,
  locked: false,
}

const layer2: LayerInfo = {
  id: 'l2',
  name: 'Sketch',
  visible: true,
  opacity: 0.8,
  blendMode: 'multiply',
  alphaLock: false,
  clippingMask: false,
  locked: false,
}

function setupLayers(layers: LayerInfo[], activeId: string) {
  useLayerStore.setState({ layers, activeLayerId: activeId })
}

describe('LayersPanel', () => {
  beforeEach(() => {
    setupLayers([layer1, layer2], 'l2')
  })

  it('renders the panel with "Layers" title', () => {
    render(<LayersPanel manager={null} />)
    expect(screen.getByText('Layers')).toBeInTheDocument()
  })

  it('renders layer names', () => {
    render(<LayersPanel manager={null} />)
    expect(screen.getByDisplayValue('Background')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Sketch')).toBeInTheDocument()
  })

  it('displays layers in reverse order (top to bottom)', () => {
    render(<LayersPanel manager={null} />)
    const inputs = screen.getAllByRole('textbox')
    // Top layer (Sketch) first in display, Background second
    expect((inputs[0] as HTMLInputElement).value).toBe('Sketch')
    expect((inputs[1] as HTMLInputElement).value).toBe('Background')
  })

  it('shows layer count', () => {
    render(<LayersPanel manager={null} />)
    expect(screen.getByText('2 / 20 layers')).toBeInTheDocument()
  })

  it('has add layer button', () => {
    render(<LayersPanel manager={null} />)
    expect(screen.getByLabelText('Add layer')).toBeInTheDocument()
  })

  it('has delete layer button', () => {
    render(<LayersPanel manager={null} />)
    expect(screen.getByLabelText('Delete layer')).toBeInTheDocument()
  })

  it('has merge down button', () => {
    render(<LayersPanel manager={null} />)
    expect(screen.getByLabelText('Merge down')).toBeInTheDocument()
  })

  it('marks the active layer', () => {
    render(<LayersPanel manager={null} />)
    const items = screen.getAllByRole('treeitem')
    // Sketch (l2) is active — displayed first (reversed)
    expect(items[0].getAttribute('data-active')).toBe('true')
    expect(items[1].getAttribute('data-active')).toBe('false')
  })

  it('has visibility toggle buttons', () => {
    render(<LayersPanel manager={null} />)
    const hideButtons = screen.getAllByLabelText('Hide layer')
    expect(hideButtons.length).toBeGreaterThan(0)
  })

  it('renders blend mode selects', () => {
    render(<LayersPanel manager={null} />)
    const selects = screen.getAllByLabelText('Blend mode')
    expect(selects).toHaveLength(2)
  })

  it('has tree role for accessibility', () => {
    render(<LayersPanel manager={null} />)
    expect(screen.getByRole('tree')).toBeInTheDocument()
  })

  it('applies glass class', () => {
    render(<LayersPanel manager={null} />)
    const panel = screen.getByRole('tree')
    expect(panel.classList.contains('glass')).toBe(true)
  })

  it('renders opacity sliders for each layer', () => {
    render(<LayersPanel manager={null} />)
    const sliders = screen.getAllByLabelText('Layer opacity')
    expect(sliders).toHaveLength(2)
  })

  it('renders alpha lock toggle buttons', () => {
    render(<LayersPanel manager={null} />)
    const lockBtns = screen.getAllByTitle('Alpha lock')
    expect(lockBtns).toHaveLength(2)
  })

  it('renders clipping mask toggle buttons', () => {
    render(<LayersPanel manager={null} />)
    const clipBtns = screen.getAllByTitle('Clipping mask')
    expect(clipBtns).toHaveLength(2)
  })

  it('opacity slider shows correct value', () => {
    render(<LayersPanel manager={null} />)
    const sliders = screen.getAllByLabelText('Layer opacity') as HTMLInputElement[]
    // layer2 (Sketch) is at 80% opacity, displayed first (reversed)
    expect(sliders[0].value).toBe('80')
    // layer1 (Background) is at 100%
    expect(sliders[1].value).toBe('100')
  })

  it('disable delete button when only 1 layer', () => {
    setupLayers([layer1], 'l1')
    render(<LayersPanel manager={null} />)
    const deleteBtn = screen.getByLabelText('Delete layer')
    expect(deleteBtn).toBeDisabled()
  })
})
