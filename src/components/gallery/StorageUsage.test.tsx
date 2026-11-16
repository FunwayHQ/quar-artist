import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { StorageUsage } from './StorageUsage.tsx'

function storage(usage: number, quota: number, persisted: boolean | undefined) {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: {
      estimate: async () => ({ usage, quota }),
      ...(persisted === undefined ? {} : { persisted: async () => persisted }),
    },
  })
}

const GB = 1024 ** 3

describe('StorageUsage', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'storage')
  })

  it('shows nothing where the browser cannot say how much it uses', async () => {
    const { container } = render(<StorageUsage refreshKey={1} />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows how much of the allowed storage the projects use, and whether the browser may clear it', async () => {
    storage(1.2 * GB, 60 * GB, false)
    render(<StorageUsage refreshKey={1} />)
    const usage = await screen.findByTestId('storage-usage')
    expect(usage).toHaveTextContent('1.2 GB of 60 GB')
    expect(usage).toHaveAttribute('aria-label', 'Storage: 1.2 GB of 60 GB used')
    expect(usage.getAttribute('title')).toContain('may clear it')
    expect(usage.dataset.full).toBeUndefined()
  })

  it('warns once the storage is nearly full', async () => {
    storage(850, 1000, true)
    render(<StorageUsage refreshKey={1} />)
    const usage = await screen.findByTestId('storage-usage')
    expect(usage.dataset.full).toBe('true')
    expect(usage.getAttribute('title')).toContain('keeps it until you clear')
  })

  it('reads again when the projects change', async () => {
    storage(1024, 10_240, undefined)
    const { rerender } = render(<StorageUsage refreshKey={1} />)
    await screen.findByText('1.0 KB of 10 KB')
    storage(5120, 10_240, undefined)
    rerender(<StorageUsage refreshKey={2} />)
    await waitFor(() => expect(screen.getByTestId('storage-usage')).toHaveTextContent('5.0 KB of 10 KB'))
  })
})
