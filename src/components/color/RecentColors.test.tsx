import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecentColors } from './RecentColors.tsx'

describe('RecentColors', () => {
  it('renders nothing when empty', () => {
    const { container } = render(<RecentColors colors={[]} onSelect={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders label and swatches', () => {
    render(
      <RecentColors
        colors={[{ h: 0, s: 1, b: 1 }, { h: 120, s: 1, b: 1 }]}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('Recent')).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('calls onSelect with the correct color', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    const colors = [
      { h: 0, s: 1, b: 1 },
      { h: 120, s: 0.5, b: 0.8 },
    ]
    render(<RecentColors colors={colors} onSelect={onSelect} />)
    const buttons = screen.getAllByRole('button')
    await user.click(buttons[1])
    expect(onSelect).toHaveBeenCalledWith({ h: 120, s: 0.5, b: 0.8 })
  })

  it('each swatch has an aria-label', () => {
    render(
      <RecentColors
        colors={[{ h: 0, s: 1, b: 1 }]}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /Recent color 1/i })).toBeInTheDocument()
  })
})
