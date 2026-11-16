import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StrictMode, useEffect } from 'react'
import { act, render } from '@testing-library/react'
import { useEngine } from './useEngine.ts'

const { FakeManager } = vi.hoisted(() => {
  /** A CanvasManager stand-in whose init() the test settles by hand. */
  class FakeManager {
    static instances: FakeManager[] = []
    container: HTMLElement | null = null
    settle: { resolve: () => void; reject: (err: unknown) => void } | null = null
    init = vi.fn((container: HTMLElement) => {
      this.container = container
      return new Promise<void>((resolve, reject) => {
        this.settle = { resolve, reject }
      })
    })
    destroy = vi.fn()
    setLayerChangeCallback = vi.fn()
    constructor() {
      FakeManager.instances.push(this)
    }
  }
  return { FakeManager }
})

vi.mock('@engine/canvas/CanvasManager.ts', () => ({ CanvasManager: FakeManager }))

type FakeManager = InstanceType<typeof FakeManager>

/** What the hook returned on the latest render, recorded after each commit. */
let engine: ReturnType<typeof useEngine>
const record = (value: ReturnType<typeof useEngine>) => {
  engine = value
}

function Canvas({ mounted = true }: { mounted?: boolean }) {
  const value = useEngine()
  const { containerRef } = value
  useEffect(() => record(value))
  return mounted ? <div data-testid="container" ref={containerRef} /> : null
}

async function settle(manager: FakeManager, outcome: 'resolve' | Error = 'resolve') {
  await act(async () => {
    if (outcome === 'resolve') manager.settle!.resolve()
    else manager.settle!.reject(outcome)
  })
}

describe('useEngine', () => {
  beforeEach(() => {
    FakeManager.instances = []
  })

  it('starts an engine on the mounted container and reports ready when init finishes', async () => {
    const { getByTestId } = render(<Canvas />)
    expect(FakeManager.instances).toHaveLength(1)
    const [manager] = FakeManager.instances
    expect(manager.container).toBe(getByTestId('container'))
    expect(engine.ready).toBe(false)
    expect(engine.manager).toBeNull()

    await settle(manager)
    expect(engine.ready).toBe(true)
    expect(engine.manager).toBe(manager)
  })

  it('under StrictMode, exactly one engine survives and ready waits for it', async () => {
    render(
      <StrictMode>
        <Canvas />
      </StrictMode>,
    )
    const live = FakeManager.instances.filter((m) => m.destroy.mock.calls.length === 0)
    expect(live).toHaveLength(1)
    // Engines StrictMode discarded finishing first must not make the app look ready (F60).
    for (const m of FakeManager.instances) if (m !== live[0]) await settle(m)
    expect(engine.ready).toBe(false)

    await settle(live[0])
    expect(engine.ready).toBe(true)
    expect(engine.manager).toBe(live[0])
  })

  it('ignores an engine that finishes starting after its container went away', async () => {
    const { rerender } = render(<Canvas />)
    const [first] = FakeManager.instances
    rerender(<Canvas mounted={false} />)
    rerender(<Canvas />)
    const second = FakeManager.instances[1]
    expect(first.destroy).toHaveBeenCalled()

    await settle(first)
    expect(engine.ready).toBe(false)
    expect(engine.manager).toBeNull()

    await settle(second)
    expect(engine.manager).toBe(second)
  })

  it('starts a new engine when the container is replaced, and destroys the old one', async () => {
    const { rerender, getByTestId } = render(<Canvas />)
    const [first] = FakeManager.instances
    await settle(first)

    // Leaving the canvas view (e.g. for the Gallery) unmounts the container.
    rerender(<Canvas mounted={false} />)
    expect(first.destroy).toHaveBeenCalled()
    expect(engine.ready).toBe(false)
    expect(engine.manager).toBeNull()

    // Coming back mounts a new container, which gets its own engine (F02).
    rerender(<Canvas />)
    expect(FakeManager.instances).toHaveLength(2)
    const second = FakeManager.instances[1]
    expect(second.container).toBe(getByTestId('container'))
    await settle(second)
    expect(engine.manager).toBe(second)
  })

  it('reports an init failure instead of staying in the loading state', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Canvas />)
    const [manager] = FakeManager.instances
    await settle(manager, new Error('no WebGPU or WebGL 2'))
    expect(engine.ready).toBe(false)
    expect(engine.error?.message).toBe('no WebGPU or WebGL 2')
  })

  it('ignores a failure from an engine that was already discarded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(<Canvas />)
    const [first] = FakeManager.instances
    rerender(<Canvas mounted={false} />)
    await settle(first, new Error('context lost during teardown'))
    expect(engine.error).toBeNull()
  })
})
