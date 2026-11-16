import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('../../io/persistence/ProjectService.ts', () => ({ projectService: { saveNow: vi.fn(async () => true) } }))

import { SaveIndicator } from './SaveIndicator.tsx'
import { useProjectStore } from '@stores/projectStore.ts'
import { projectService } from '../../io/persistence/ProjectService.ts'

const initial = useProjectStore.getState()

describe('SaveIndicator', () => {
  beforeEach(() => {
    useProjectStore.setState(initial, true)
    useProjectStore.setState({ currentProjectId: 'p', saveStatus: 'idle' })
    vi.mocked(projectService.saveNow).mockClear()
  })

  const status = () => screen.queryByTestId('save-status')

  it('shows nothing until there is something to say', () => {
    render(<SaveIndicator />)
    expect(status()).toBeNull()
  })

  it('follows a save: Edited while changes wait, Saving… while they are written, then Saved', () => {
    render(<SaveIndicator />)
    for (const [s, text] of [
      ['pending', 'Edited'],
      ['saving', 'Saving…'],
      ['saved', 'Saved'],
    ] as const) {
      act(() => useProjectStore.getState().setSaveStatus(s))
      expect(status()).toHaveTextContent(text)
      expect(status()?.dataset.status).toBe(s)
    }
    expect(status()?.getAttribute('title')).toMatch(/^Saved at /)
  })

  it('offers to save again when saving failed', () => {
    useProjectStore.setState({ saveStatus: 'error' })
    render(<SaveIndicator />)
    expect(status()).toHaveTextContent('Not saved')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(projectService.saveNow).toHaveBeenCalledTimes(1)
  })

  it("says so when the browser can't save the open canvas at all", () => {
    useProjectStore.setState({ currentProjectId: null })
    render(<SaveIndicator />)
    expect(status()).toHaveTextContent('Not saving')
    expect(status()?.dataset.status).toBe('unavailable')
  })
})
