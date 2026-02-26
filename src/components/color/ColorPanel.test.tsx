import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ColorPanel } from './ColorPanel.tsx'
import { useColorStore } from '@stores/colorStore.ts'

describe('ColorPanel', () => {
  beforeEach(() => {
    useColorStore.setState({
      primary: { h: 0, s: 1, b: 1 },
      secondary: { h: 0, s: 0, b: 0 },
      harmonyMode: 'none',
      recentColors: [],
      activePaletteId: 'default',
    })
  })

  it('renders the panel with Color title', () => {
    render(<ColorPanel />)
    expect(screen.getByText('Color')).toBeInTheDocument()
  })

  it('renders 4 tab buttons', () => {
    render(<ColorPanel />)
    expect(screen.getByText('Disc')).toBeInTheDocument()
    expect(screen.getByText('Classic')).toBeInTheDocument()
    expect(screen.getByText('Harmony')).toBeInTheDocument()
    expect(screen.getByText('Palettes')).toBeInTheDocument()
  })

  it('shows disc tab by default', () => {
    render(<ColorPanel />)
    const discTab = screen.getByText('Disc')
    expect(discTab.getAttribute('data-active')).toBe('true')
  })

  it('renders the color disc on disc tab', () => {
    render(<ColorPanel />)
    expect(screen.getByRole('slider', { name: 'Color disc' })).toBeInTheDocument()
  })

  it('switches to classic tab', async () => {
    const user = userEvent.setup()
    render(<ColorPanel />)
    await user.click(screen.getByText('Classic'))
    expect(screen.getByRole('slider', { name: 'Classic color picker' })).toBeInTheDocument()
  })

  it('switches to harmony tab', async () => {
    const user = userEvent.setup()
    render(<ColorPanel />)
    await user.click(screen.getByText('Harmony'))
    expect(screen.getByRole('combobox', { name: 'Harmony mode' })).toBeInTheDocument()
  })

  it('switches to palettes tab', async () => {
    const user = userEvent.setup()
    render(<ColorPanel />)
    await user.click(screen.getByText('Palettes'))
    expect(screen.getByRole('combobox', { name: 'Active palette' })).toBeInTheDocument()
  })

  it('renders value sliders (HSB/RGB/Hex) in footer', () => {
    render(<ColorPanel />)
    expect(screen.getByText('HSB')).toBeInTheDocument()
    expect(screen.getByText('RGB')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Hex color' })).toBeInTheDocument()
  })

  it('renders swap button', () => {
    render(<ColorPanel />)
    expect(screen.getByRole('button', { name: /swap/i })).toBeInTheDocument()
  })

  it('swaps colors on swap button click', async () => {
    const user = userEvent.setup()
    useColorStore.setState({
      primary: { h: 100, s: 0.5, b: 0.5 },
      secondary: { h: 200, s: 0.8, b: 0.8 },
    })
    render(<ColorPanel />)
    await user.click(screen.getByRole('button', { name: /swap/i }))
    expect(useColorStore.getState().primary.h).toBe(200)
    expect(useColorStore.getState().secondary.h).toBe(100)
  })

  it('renders recent colors when they exist', () => {
    useColorStore.setState({
      recentColors: [
        { h: 0, s: 1, b: 1 },
        { h: 120, s: 1, b: 1 },
      ],
    })
    render(<ColorPanel />)
    expect(screen.getByText('Recent')).toBeInTheDocument()
  })
})
