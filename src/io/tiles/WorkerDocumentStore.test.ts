import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { resetDB } from '../../db/schema.ts'
import type { LayerInfo } from '../../types/layer.ts'
import { IdbTileBackend } from './IdbTileBackend.ts'
import { serveDocumentStore, type ServedStore, type StorePort } from './storeProtocol.ts'
import { TileStore } from './TileStore.ts'
import { WorkerDocumentStore, type WorkerLike } from './WorkerDocumentStore.ts'
import { sameBytes } from '../../test/bytes.ts'

const info: LayerInfo = {
  id: 'ink',
  name: 'Ink',
  visible: true,
  opacity: 1,
  blendMode: 'normal',
  alphaLock: false,
  clippingMask: false,
  locked: false,
}

function opaque(width: number, height: number, value = 200): Uint8Array {
  const pixels = new Uint8Array(width * height * 4).fill(value)
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255
  return pixels
}

function idbStore() {
  const idb = new IdbTileBackend()
  return new TileStore({ write: idb, read: { idb } })
}

type Listener = (event: never) => void

/**
 * A worker that runs a document store on this thread, with messages cloned
 * and buffers transferred as between threads.
 */
class LoopbackWorker implements WorkerLike {
  private readonly listeners: Record<'message' | 'messageerror' | 'error', Listener[]> = {
    message: [],
    messageerror: [],
    error: [],
  }
  private readonly inside: ((event: MessageEvent) => void)[] = []
  terminated = false
  /** Messages the worker received. */
  received: unknown[] = []

  constructor(store: ServedStore, options: { silent?: boolean; progressIntervalMs?: number } = {}) {
    const port: StorePort = {
      postMessage: (message, transfer) => {
        if (options.silent && (message as { ready?: boolean }).ready) return
        const copy = structuredClone(message, { transfer })
        queueMicrotask(() => {
          if (!this.terminated) this.emit('message', { data: copy })
        })
      },
      addEventListener: (_type, listener) => this.inside.push(listener),
    }
    serveDocumentStore(store, port, { progressIntervalMs: options.progressIntervalMs })
  }

  postMessage(message: unknown, transfer: Transferable[]) {
    const copy = structuredClone(message, { transfer })
    this.received.push(copy)
    queueMicrotask(() => {
      if (!this.terminated) for (const listener of this.inside) listener({ data: copy } as MessageEvent)
    })
  }

  addEventListener(type: 'message' | 'messageerror' | 'error', listener: Listener) {
    this.listeners[type].push(listener)
  }

  terminate() {
    this.terminated = true
  }

  /** Fail as a worker does whose script didn't load, or that crashed. */
  fail(message = '') {
    this.emit('error', { message, preventDefault() {} })
  }

  /** Send an answer that can't be read. */
  garble() {
    this.emit('messageerror', {})
  }

  private emit(type: 'message' | 'messageerror' | 'error', event: object) {
    for (const listener of this.listeners[type]) listener(event as never)
  }
}

describe('WorkerDocumentStore', () => {
  beforeEach(async () => {
    resetDB()
    indexedDB.deleteDatabase('QuarArtistDB')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('saves and loads through the worker, moving pixel buffers instead of copying them', async () => {
    const worker = new LoopbackWorker(idbStore())
    const local = vi.fn(idbStore)
    const store = new WorkerDocumentStore(() => worker, local)
    expect(await store.backend()).toBe('idb')

    const pixels = opaque(300, 20)
    const report = await store.save('p', { width: 300, height: 20, layers: [{ info, pixels }] })
    expect(report).toMatchObject({ backend: 'idb', written: 2 })
    // Handed over to the worker.
    expect(pixels.byteLength).toBe(0)

    const doc = (await store.load('p'))!
    expect(sameBytes(doc.layers[0].pixels!, opaque(300, 20))).toBe(true)
    expect(await store.copy('p', 'q')).toBe(true)
    await store.delete('p')
    expect(await store.load('p')).toBeNull()
    expect(await store.load('q')).not.toBeNull()
    expect(local).not.toHaveBeenCalled()
  })

  it("keeps an error's name across the worker, so a full storage is reported as one", async () => {
    const inner = idbStore()
    vi.spyOn(inner, 'save').mockRejectedValue(new DOMException('no room', 'QuotaExceededError'))
    const store = new WorkerDocumentStore(() => new LoopbackWorker(inner), idbStore)
    await expect(store.save('p', { width: 1, height: 1, layers: [] })).rejects.toMatchObject({
      name: 'QuotaExceededError',
      message: 'no room',
    })
  })

  it('answers calls in any order', async () => {
    const inner = idbStore()
    let release: () => void = () => {}
    const slow = new Promise<void>((resolve) => (release = resolve))
    const load = inner.load.bind(inner)
    vi.spyOn(inner, 'load').mockImplementation(async (id) => {
      if (id === 'slow') await slow
      return load(id)
    })
    const store = new WorkerDocumentStore(() => new LoopbackWorker(inner), idbStore)
    await store.save('fast', { width: 1, height: 1, layers: [{ info, pixels: opaque(1, 1) }] })

    const slowLoad = store.load('slow')
    expect(await store.load('fast')).not.toBeNull()
    release()
    expect(await slowLoad).toBeNull()
  })

  it("saves on this thread when the worker can't be created", async () => {
    const store = new WorkerDocumentStore(() => {
      throw new Error('workers are blocked')
    }, idbStore)
    await store.save('p', { width: 1, height: 1, layers: [{ info, pixels: opaque(1, 1) }] })
    expect(await store.load('p')).not.toBeNull()
    expect(await store.backend()).toBe('idb')
  })

  it("saves on this thread when the worker's script doesn't load", async () => {
    const worker = new LoopbackWorker(idbStore(), { silent: true })
    const store = new WorkerDocumentStore(() => worker, idbStore)
    const pixels = opaque(1, 1)
    const saving = store.save('p', { width: 1, height: 1, layers: [{ info, pixels }] })
    worker.fail()
    await saving
    expect(worker.terminated).toBe(true)
    expect(worker.received).toEqual([])
    // Nothing was handed over: the pixels stayed here to be saved.
    expect(await store.load('p')).not.toBeNull()
  })

  it('saves on this thread when the worker takes too long to start', async () => {
    const worker = new LoopbackWorker(idbStore(), { silent: true })
    const store = new WorkerDocumentStore(() => worker, idbStore, { startTimeoutMs: 20 })
    await store.save('p', { width: 1, height: 1, layers: [{ info, pixels: opaque(1, 1) }] })
    expect(worker.terminated).toBe(true)
    expect(await store.load('p')).not.toBeNull()
  })

  it('fails the calls a stopped worker had, and runs later ones on this thread', async () => {
    const inner = idbStore()
    vi.spyOn(inner, 'load').mockReturnValue(new Promise(() => {}))
    const worker = new LoopbackWorker(inner)
    const store = new WorkerDocumentStore(() => worker, idbStore)
    await store.backend()

    const waiting = store.load('p')
    await vi.waitFor(() => expect(worker.received).toHaveLength(1))
    worker.fail('out of memory')
    await expect(waiting).rejects.toThrow('the persistence worker stopped: out of memory')

    await store.save('p', { width: 1, height: 1, layers: [{ info, pixels: opaque(1, 1) }] })
    expect(await store.load('p')).not.toBeNull()
  })

  it('gives up on a worker that stops answering, and runs later calls on this thread', async () => {
    const inner = idbStore()
    vi.spyOn(inner, 'load').mockReturnValue(new Promise(() => {}))
    const worker = new LoopbackWorker(inner)
    const store = new WorkerDocumentStore(() => worker, idbStore, { stallMs: 50 })
    await store.backend()

    await expect(store.load('p')).rejects.toThrow('the persistence worker stopped answering')
    expect(worker.terminated).toBe(true)
    // The main thread's store, in IndexedDB: the worker's OPFS can't be written from here.
    expect(await store.backend()).toBe('idb')
    await store.save('p', { width: 1, height: 1, layers: [{ info, pixels: opaque(1, 1) }] })
    expect(await store.load('p')).not.toBeNull()
  })

  it('waits for a long call as long as the worker reports progress', async () => {
    const inner = idbStore()
    const save = inner.save.bind(inner)
    vi.spyOn(inner, 'save').mockImplementation(async (...args) => {
      // Four times the stall limit, reporting progress all along.
      for (let i = 0; i < 20; i++) {
        inner.onProgress?.()
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      return save(...args)
    })
    const worker = new LoopbackWorker(inner, { progressIntervalMs: 5 })
    const store = new WorkerDocumentStore(() => worker, idbStore, { stallMs: 50 })

    expect(await store.save('p', { width: 1, height: 1, layers: [{ info, pixels: opaque(1, 1) }] })).toMatchObject({
      written: 1,
    })
    expect(worker.terminated).toBe(false)
  })

  it('gives up on the worker when an answer arrives that cannot be read', async () => {
    const inner = idbStore()
    vi.spyOn(inner, 'load').mockReturnValue(new Promise(() => {}))
    const worker = new LoopbackWorker(inner)
    const store = new WorkerDocumentStore(() => worker, idbStore)
    await store.backend()

    const waiting = store.load('p')
    await vi.waitFor(() => expect(worker.received).toHaveLength(1))
    worker.garble()
    await expect(waiting).rejects.toThrow('could not be read')
    expect(worker.terminated).toBe(true)
  })
})
