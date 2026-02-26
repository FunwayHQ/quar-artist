import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ColorHarmony } from './ColorHarmony.tsx'

describe('ColorHarmony', () => {
  const defaultProps = {
    color: { h: 0, s: 1, b: 1 },
    harmonyMode: 'none' as const,
    onHarmonyModeChange: vi.fn(),
    onSelectHarmonyColor: vi.fn(),
  }

  it('renders harmony mode selector', () => {
    render(<ColorHarmony {...defaultProps} />)
    expect(screen.getByRole('combobox', { name: 'Harmony mode' })).toBeInTheDocument()
  })

  it('has all harmony mode options', () => {
    render(<ColorHarmony {...defaultProps} />)
    const select = screen.getByRole('combobox', { name: 'Harmony mode' }) as HTMLSelectElement
    expect(select.options).toHaveLength(6)
  })

  it('does not render swatches for none mode', () => {
    render(<ColorHarmony {...defaultProps} />)
    expect(screen.queryByRole('button', { name: /harmony/i })).not.toBeInTheDocument()
  })

  it('renders companion swatches for complementary mode', () => {
    render(<ColorHarmony {...defaultProps} harmonyMode="complementary" />)
    expect(screen.getByRole('button', { name: 'Primary color' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Harmony color 1' })).toBeInTheDocument()
  })

  it('renders 3 companion swatches for tetradic mode', () => {
    render(<ColorHarmony {...defaultProps} harmonyMode="tetradic" />)
    expect(screen.getByRole('button', { name: 'Harmony color 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Harmony color 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Harmony color 3' })).toBeInTheDocument()
  })

  it('calls onHarmonyModeChange when selecting mode', async () => {
    const onModeChange = vi.fn()
    const user = userEvent.setup()
    render(<ColorHarmony {...defaultProps} onHarmonyModeChange={onModeChange} />)
    await user.selectOptions(screen.getByRole('combobox'), 'complementary')
    expect(onModeChange).toHaveBeenCalledWith('complementary')
  })

  it('calls onSelectHarmonyColor when clicking a companion swatch', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <ColorHarmony
        {...defaultProps}
        harmonyMode="complementary"
        onSelectHarmonyColor={onSelect}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Harmony color 1' }))
    expect(onSelect).toHaveBeenCalled()
    expect(onSelect.mock.calls[0][0].h).toBeCloseTo(180)
  })
})
