import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoadingOverlay } from './LoadingOverlay.tsx'

describe('LoadingOverlay', () => {
  it('says what it waits for, without a bar when how far it got is unknown', () => {
    render(<LoadingOverlay />)
    expect(screen.getByRole('status').textContent).toContain('Initializing engine...')
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('shows how far it got as a bar and a percentage (plan M1.4)', () => {
    render(<LoadingOverlay label="Opening “Sketch”" progress={0.426} />)
    const bar = screen.getByRole('progressbar', { name: 'Opening “Sketch”' })
    expect(bar.getAttribute('aria-valuenow')).toBe('43')
    expect(screen.getByText('43%')).toBeTruthy()
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('43%')
  })

  it('keeps the bar within 0 and 100%', () => {
    const { rerender } = render(<LoadingOverlay progress={1.7} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
    rerender(<LoadingOverlay progress={-1} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
  })
})
