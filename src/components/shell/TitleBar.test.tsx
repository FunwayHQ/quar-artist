import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TitleBar } from './TitleBar.tsx'

describe('TitleBar', () => {
  it('renders the logo image with alt text', () => {
    render(<TitleBar />)
    const logo = screen.getByAltText('QUAR Artist')
    expect(logo).toBeInTheDocument()
    expect(logo.tagName).toBe('IMG')
  })

  it('renders within a header element', () => {
    render(<TitleBar />)
    const header = screen.getByRole('banner')
    expect(header).toBeInTheDocument()
  })

  it('has a menu button', () => {
    render(<TitleBar />)
    const menuBtn = screen.getByRole('button', { name: 'Menu' })
    expect(menuBtn).toBeInTheDocument()
  })

  it('applies glass class for frosted glass effect', () => {
    render(<TitleBar />)
    const header = screen.getByRole('banner')
    expect(header.classList.contains('glass')).toBe(true)
  })
})
