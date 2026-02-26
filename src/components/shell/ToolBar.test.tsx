import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToolBar } from './ToolBar.tsx'
import { useToolStore } from '@stores/toolStore.ts'

describe('ToolBar', () => {
  beforeEach(() => {
    useToolStore.setState({ activeTool: 'brush', previousTool: 'brush' })
  })

  it('renders all 7 tool buttons', () => {
    render(<ToolBar />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(7)
  })

  it('renders with toolbar role', () => {
    render(<ToolBar />)
    expect(screen.getByRole('toolbar', { name: 'Drawing tools' })).toBeInTheDocument()
  })

  it('renders each tool with aria-label', () => {
    render(<ToolBar />)
    expect(screen.getByRole('button', { name: 'Brush' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Eraser' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fill' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Eyedropper' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Selection' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Transform' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move' })).toBeInTheDocument()
  })

  it('marks the active tool with data-active="true"', () => {
    render(<ToolBar />)
    const brushBtn = screen.getByRole('button', { name: 'Brush' })
    expect(brushBtn.getAttribute('data-active')).toBe('true')
    const eraserBtn = screen.getByRole('button', { name: 'Eraser' })
    expect(eraserBtn.getAttribute('data-active')).toBe('false')
  })

  it('updates active tool on click', async () => {
    const user = userEvent.setup()
    render(<ToolBar />)

    await user.click(screen.getByRole('button', { name: 'Eraser' }))
    expect(useToolStore.getState().activeTool).toBe('eraser')
  })

  it('updates the data-active attribute after clicking', async () => {
    const user = userEvent.setup()
    render(<ToolBar />)

    await user.click(screen.getByRole('button', { name: 'Fill' }))
    expect(screen.getByRole('button', { name: 'Fill' }).getAttribute('data-active')).toBe('true')
    expect(screen.getByRole('button', { name: 'Brush' }).getAttribute('data-active')).toBe('false')
  })

  it('is rendered as a nav element', () => {
    render(<ToolBar />)
    const toolbar = screen.getByRole('toolbar')
    expect(toolbar.tagName).toBe('NAV')
  })
})
