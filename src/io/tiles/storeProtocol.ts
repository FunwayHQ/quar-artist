import type { DocumentStore } from './TileStore.ts'
import type { TileBackendKind } from './tileFormat.ts'

/** How the app talks to the persistence worker: a call to one of the DocumentStore's methods, and its answer. */
export type StoreMethod = keyof DocumentStore

export interface StoreRequest {
  id: number
  method: StoreMethod
  args: unknown[]
}

export interface WireError {
  name: string
  message: string
}

export type StoreReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: WireError }

/** The worker's first message: it started, and saves to this backend. */
export interface StoreReady {
  ready: true
  backend: TileBackendKind
}

/** Sent at most once a second while the worker works on a call: it hasn't stalled. */
export interface StoreProgress {
  progress: true
}

/** How often, at most, the worker says it is making progress. */
export const PROGRESS_INTERVAL_MS = 1000

/** A store the worker can serve. */
export interface ServedStore extends DocumentStore {
  backend(): Promise<TileBackendKind>
  onProgress: (() => void) | null
}

/** Either end of the conversation: a Worker, or the worker's global scope. */
export interface StorePort {
  postMessage(message: unknown, transfer: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

/** An error as it crosses to the other side, keeping its name (QuotaExceededError says the storage is full). */
export function toWireError(err: unknown): WireError {
  const { name, message } = (typeof err === 'object' && err !== null ? err : {}) as { name?: unknown; message?: unknown }
  return {
    name: typeof name === 'string' ? name : 'Error',
    message: typeof message === 'string' && message ? message : String(err),
  }
}

export function fromWireError({ name, message }: WireError): Error {
  const err = new Error(message)
  err.name = name
  return err
}

/** The distinct transferable buffers under some pixel arrays. */
export function buffersOf(arrays: readonly (Uint8Array | null | undefined)[]): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  for (const array of arrays) if (array && array.buffer instanceof ArrayBuffer) buffers.add(array.buffer)
  return [...buffers]
}

/** Call one of a store's methods by name. */
export function callStore(store: DocumentStore, method: StoreMethod, args: unknown[]): Promise<unknown> {
  const fn = store[method] as (this: DocumentStore, ...a: unknown[]) => Promise<unknown>
  if (typeof fn !== 'function') return Promise.reject(new Error(`the document store has no ${String(method)}`))
  return fn.apply(store, args)
}

/** Answer requests arriving on `port` with `store`: the persistence worker's side. */
export function serveDocumentStore(
  store: ServedStore,
  port: StorePort,
  { progressIntervalMs = PROGRESS_INTERVAL_MS } = {},
) {
  let lastProgress = 0
  store.onProgress = () => {
    const now = Date.now()
    if (now - lastProgress < progressIntervalMs) return
    lastProgress = now
    port.postMessage({ progress: true } satisfies StoreProgress, [])
  }
  port.addEventListener('message', (event: MessageEvent<StoreRequest>) => {
    const { id, method, args } = event.data
    void (async () => {
      try {
        const value = await callStore(store, method, args)
        // Loaded layers move to the app without a copy.
        const layers = method === 'load' && value ? (value as { layers: { pixels: Uint8Array | null }[] }).layers : []
        port.postMessage({ id, ok: true, value } satisfies StoreReply, buffersOf(layers.map((l) => l.pixels)))
      } catch (err) {
        port.postMessage({ id, ok: false, error: toWireError(err) } satisfies StoreReply, [])
      }
    })()
  })
  void store.backend().then((backend) => port.postMessage({ ready: true, backend } satisfies StoreReady, []))
}
