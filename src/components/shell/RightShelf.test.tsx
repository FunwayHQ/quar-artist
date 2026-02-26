import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RightShelf } from './RightShelf.tsx'
import { useUIStore } from '@stores/uiStore.ts'
import { useColorStore } from '@stores/colorStore.ts'

describe('RightShelf', () => {
  beforeEach(() => {
    useUIStore.setState({
      leftPanelOpen: true,
      rightPanelOpen: true,
      rightPanelTab: 'layers',
      fullscreen: false,
    })
    useColorStore.setState({
      primary: { h: 0, s: 0, b: 1 },
    })
  })

  it('renders with tablist role', () => {
    render(<RightShelf />)
    expect(screen.getByRole('tablist', { name: 'Right panel' })).toBeInTheDocument()
  })

  it('renders primary color swatch', () => {
    render(<RightShelf />)
    const swatch = screen.getByRole('button', { name: 'Primary color' })
    expect(swatch).toBeInTheDocument()
  })

  it('renders Color, Layers, Brush buttons', () => {
    render(<RightShelf />)
    expect(screen.getByRole('button', { name: 'Color picker' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Layers panel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Brush settings' })).toBeInTheDocument()
  })

  it('marks Layers as active by default', () => {
    render(<RightShelf />)
    const layersBtn = screen.getByRole('button', { name: 'Layers panel' })
    expect(layersBtn.getAttribute('data-active')).toBe('true')
  })

  it('switches active tab on click', async () => {
    const user = userEvent.setup()
    render(<RightShelf />)

    await user.click(screen.getByRole('button', { name: 'Color picker' }))
    expect(useUIStore.getState().rightPanelTab).toBe('color')
    expect(screen.getByRole('button', { name: 'Color picker' }).getAttribute('data-active')).toBe('true')
    expect(screen.getByRole('button', { name: 'Layers panel' }).getAttribute('data-active')).toBe('false')
  })

  it('switches to brush tab', async () => {
    const user = userEvent.setup()
    render(<RightShelf />)

    await user.click(screen.getByRole('button', { name: 'Brush settings' }))
    expect(useUIStore.getState().rightPanelTab).toBe('brush')
  })

  it('applies glass class', () => {
    render(<RightShelf />)
    const shelf = screen.getByRole('tablist')
    expect(shelf.classList.contains('glass')).toBe(true)
  })

  it('color swatch reflects primary color from store', () => {
    render(<RightShelf />)
    const swatch = screen.getByRole('button', { name: 'Primary color' })
    // Default primary is white {h:0, s:0, b:1} = #ffffff
    expect(swatch.style.background).toBe('rgb(255, 255, 255)')
  })

  it('color swatch opens color tab on click', async () => {
    const user = userEvent.setup()
    render(<RightShelf />)
    await user.click(screen.getByRole('button', { name: 'Primary color' }))
    expect(useUIStore.getState().rightPanelTab).toBe('color')
  })
})
