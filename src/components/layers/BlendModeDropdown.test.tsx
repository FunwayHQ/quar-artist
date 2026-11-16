import { beforeAll, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BlendModeDropdown } from './BlendModeDropdown.tsx'
import { ALL_BLEND_MODES } from '../../types/layer.ts'

// Plain DOM queries: role queries with accessible names are slow in jsdom
// over the 26 options, enough to time out when the whole suite runs.
const options = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))

describe('BlendModeDropdown', () => {
  beforeAll(() => {
    // jsdom has no layout, so no scrollIntoView; the menu scrolls to the current mode.
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('lists every blend mode', () => {
    render(<BlendModeDropdown value="normal" onChange={() => {}} />)
    fireEvent.click(screen.getByLabelText('Blend mode'))
    expect(options()).toHaveLength(ALL_BLEND_MODES.length)
  })

  it('says which modes are drawn as Normal for now', () => {
    render(<BlendModeDropdown value="hue" onChange={() => {}} />)
    const trigger = screen.getByLabelText('Blend mode')
    expect(trigger).toHaveAttribute('title', expect.stringContaining('drawn as Normal'))

    fireEvent.click(trigger)
    const marked = options().filter((o) => o.textContent?.includes('as Normal'))
    expect(marked.map((o) => o.textContent)).toEqual(['Dissolve as Normal', 'Hue as Normal'])
    expect(marked.every((o) => o.title.includes('drawn as Normal'))).toBe(true)
    expect(screen.getByText('Multiply')).not.toHaveAttribute('title')
  })

  it('does not mark modes that render', () => {
    render(<BlendModeDropdown value="multiply" onChange={() => {}} />)
    expect(screen.getByLabelText('Blend mode')).not.toHaveAttribute('title')
  })

  it('reports the chosen mode', () => {
    const onChange = vi.fn()
    render(<BlendModeDropdown value="normal" onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Blend mode'))
    fireEvent.click(screen.getByText('Soft Light'))
    expect(onChange).toHaveBeenCalledWith('softLight')
  })
})
