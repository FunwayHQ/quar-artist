import { TileStore, type DocumentStore, type DocumentToSave, type SaveReport, type SavedDocument } from './TileStore.ts'
import {
  buffersOf,
  callStore,
  fromWireError,
  type StoreMethod,
  type StoreProgress,
  type StoreReady,
  type StoreReply,
} from './storeProtocol.ts'
import type { TileBackendKind } from './tileFormat.ts'

/** How long the worker gets to start before saves run on the main thread instead. */
export const WORKER_START_MS = 10_000
/**
 * How long the worker may go without a word while calls wait for it. It
 * reports progress every second while it works, so this means it stalled:
 * waiting forever would block closing the project and everything after it.
 */
export const WORKER_STALL_MS = 60_000

/** What the client needs of a Worker. */
export interface WorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void
  addEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent) => void): void
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  terminate(): void
}

interface Call {
  resolve(value: unknown): void
  reject(err: unknown): void
}

/**
 * The document store as the app uses it: calls go to the persistence worker,
 * and pixel buffers move there and back without copies. If the worker can't
 * start, or stops, the store runs on the main thread instead.
 */
export class WorkerDocumentStore implements DocumentStore {
  private worker: WorkerLike | null = null
  private local: DocumentStore | null = null
  private readonly createLocal: () => DocumentStore
  private readonly started: Promise<boolean>
  private readonly calls = new Map<number, Call>()
  private nextId = 1
  private workerBackend: TileBackendKind | null = null
  private readonly stallMs: number
  /** When the worker last said anything, or the first waiting call was sent. */
  private lastHeard = 0
  private watchdog: ReturnType<typeof setInterval> | null = null

  constructor(
    createWorker: () => WorkerLike,
    createLocal: () => DocumentStore = () => new TileStore(),
    { startTimeoutMs = WORKER_START_MS, stallMs = WORKER_STALL_MS } = {},
  ) {
    this.createLocal = createLocal
    this.stallMs = stallMs
    this.started = new Promise<boolean>((resolve) => {
      let worker: WorkerLike
      try {
        worker = createWorker()
      } catch (err) {
        console.warn('[QUAR] The persistence worker could not start; saving on the main thread:', err)
        resolve(false)
        return
      }
      this.worker = worker
      const timer = setTimeout(() => this.stop(new Error('the persistence worker did not start'), resolve), startTimeoutMs)
      worker.addEventListener('message', (event) => {
        this.lastHeard = Date.now()
        const data = event.data as StoreReady | StoreProgress | StoreReply
        if ('progress' in data) return
        if ('ready' in data) {
          clearTimeout(timer)
          this.workerBackend = data.backend
          resolve(true)
          return
        }
        const call = this.calls.get(data.id)
        if (!call) return
        this.calls.delete(data.id)
        if (data.ok) call.resolve(data.value)
        else call.reject(fromWireError(data.error))
      })
      worker.addEventListener('error', (event) => {
        clearTimeout(timer)
        event.preventDefault?.()
        this.stop(new Error(`the persistence worker stopped: ${event.message || 'it could not load'}`), resolve)
      })
      // An answer that can't be read leaves its call waiting: start over without the worker.
      worker.addEventListener('messageerror', () => {
        clearTimeout(timer)
        this.stop(new Error('the persistence worker sent an answer that could not be read'), resolve)
      })
    })
  }

  /** Where saves are written, once known: the worker's backend, or the main thread's once it stopped. */
  async backend(): Promise<TileBackendKind | null> {
    if ((await this.started) && this.worker) return this.workerBackend
    const local = this.fallback()
    return local instanceof TileStore ? local.backend() : null
  }

  /** The pixel buffers are handed over: don't use them after calling. */
  save(projectId: string, doc: DocumentToSave): Promise<SaveReport> {
    return this.call('save', [projectId, doc], () =>
      buffersOf(doc.layers.flatMap((l) => [l.pixels, ...(l.tiles ?? []).map((t) => t.pixels)])),
    )
  }

  load(projectId: string): Promise<SavedDocument | null> {
    return this.call('load', [projectId])
  }

  copy(fromProjectId: string, toProjectId: string): Promise<boolean> {
    return this.call('copy', [fromProjectId, toProjectId])
  }

  delete(projectId: string): Promise<void> {
    return this.call('delete', [projectId])
  }

  storedProjects(): Promise<string[]> {
    return this.call('storedProjects', [])
  }

  private async call<T>(method: StoreMethod, args: unknown[], transfer: () => ArrayBuffer[] = () => []): Promise<T> {
    if (!(await this.started) || !this.worker) return callStore(this.fallback(), method, args) as Promise<T>
    const worker = this.worker
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++
      if (this.calls.size === 0) this.lastHeard = Date.now()
      this.calls.set(id, { resolve: resolve as (value: unknown) => void, reject })
      try {
        worker.postMessage({ id, method, args }, transfer())
      } catch (err) {
        this.calls.delete(id)
        reject(err)
        return
      }
      this.watch()
    })
  }

  /** While calls wait, check that the worker keeps talking. */
  private watch() {
    this.watchdog ??= setInterval(
      () => {
        if (this.calls.size === 0) {
          clearInterval(this.watchdog!)
          this.watchdog = null
        } else if (Date.now() - this.lastHeard > this.stallMs) {
          this.stop(new Error('the persistence worker stopped answering'), () => {})
        }
      },
      Math.max(10, Math.min(5000, this.stallMs / 4)),
    )
  }

  private fallback(): DocumentStore {
    this.local ??= this.createLocal()
    return this.local
  }

  /** Give up on the worker: calls waiting for it fail, and later ones run here. */
  private stop(reason: Error, resolveStarted: (started: boolean) => void) {
    if (this.watchdog !== null) {
      clearInterval(this.watchdog)
      this.watchdog = null
    }
    if (this.worker) {
      console.warn('[QUAR] Saving on the main thread:', reason.message)
      this.worker.terminate()
      this.worker = null
    }
    resolveStarted(false)
    for (const call of this.calls.values()) call.reject(reason)
    this.calls.clear()
  }
}

/** The app's document store: the persistence worker where workers run, the store itself otherwise. */
export function createDocumentStore(): DocumentStore {
  if (typeof Worker !== 'function') return new TileStore()
  return new WorkerDocumentStore(
    () =>
      new Worker(new URL('./tileWorker.ts', import.meta.url), {
        type: 'module',
        name: 'QUAR Artist persistence',
      }) as unknown as WorkerLike,
  )
}
