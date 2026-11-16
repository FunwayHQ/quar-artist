import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EngineErrorScreen } from './EngineErrorScreen.tsx'

describe('EngineErrorScreen', () => {
  it('explains what the app needs and shows the error', () => {
    render(<EngineErrorScreen error={new Error('No WebGL 2 context')} />)
    expect(screen.getByRole('alert')).toHaveTextContent('WebGPU or WebGL 2')
    expect(screen.getByText('No WebGL 2 context')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })
})
