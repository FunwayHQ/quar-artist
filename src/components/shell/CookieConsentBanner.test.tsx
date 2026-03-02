import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CookieConsentBanner } from './CookieConsentBanner.tsx'

describe('CookieConsentBanner', () => {
  it('renders banner text', () => {
    render(<CookieConsentBanner onAccept={vi.fn()} onDecline={vi.fn()} />)
    expect(screen.getByText(/Google Fonts/)).toBeInTheDocument()
  })

  it('calls onAccept when Allow clicked', async () => {
    const user = userEvent.setup()
    const onAccept = vi.fn()
    render(<CookieConsentBanner onAccept={onAccept} onDecline={vi.fn()} />)
    await user.click(screen.getByText('Allow'))
    expect(onAccept).toHaveBeenCalledTimes(1)
  })

  it('calls onDecline when No thanks clicked', async () => {
    const user = userEvent.setup()
    const onDecline = vi.fn()
    render(<CookieConsentBanner onAccept={vi.fn()} onDecline={onDecline} />)
    await user.click(screen.getByText('No thanks'))
    expect(onDecline).toHaveBeenCalledTimes(1)
  })

  it('has data-testid for E2E testing', () => {
    render(<CookieConsentBanner onAccept={vi.fn()} onDecline={vi.fn()} />)
    expect(screen.getByTestId('cookie-consent-banner')).toBeInTheDocument()
  })
})
