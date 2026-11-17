import { MAX_LAYERS } from '../../../types/layer.ts'
import { maxCanvasSide } from '../../../utils/deviceLimits.ts'
import { fromWireError } from '../../tiles/storeProtocol.ts'
import type { WorkerLike } from '../../tiles/WorkerDocumentStore.ts'
import { inputBuffers, openQartFile, type OpenedQart, type QartCall, type QartReady, type QartReply } from './qartProtocol.ts'
import type { QartLimits } from './QartReader.ts'
import { encodeQart, type QartWriterInput } from './QartWriter.ts'

/** How long the worker gets to start before files are read and written on the main thread instead. */
export const CODEC_START_MS = 10_000

interface Call {
  resolve(value: unknown): void
  reject(err: unknown): void
}

/**
 * Writes and reads .qart files in the .qart worker, which starts with the
 * first call. Pixel buffers move there and back without copies. Where the
 * worker can't start, or once it stops, the main thread does the work.
 */
export class QartCodec {
  private readonly createWorker: (() => WorkerLike) | null
  private readonly startTimeoutMs: number
  private worker: WorkerLike | null = null
  private started: Promise<boolean> | null = null
  private readonly calls = new Map<number, Call>()
  private nextId = 1

  constructor(createWorker: (() => WorkerLike) | null, { startTimeoutMs = CODEC_START_MS } = {}) {
    this.createWorker = createWorker
    this.startTimeoutMs = startTimeoutMs
  }

  /** Write a document as a .qart file. Its pixel buffers are handed over: don't use them after calling. */
  write(input: QartWriterInput): Promise<Blob> {
    return this.call({ method: 'write', input }, () => inputBuffers(input), () => encodeQart(input)) as Promise<Blob>
  }

  /**
   * Read a .qart file to open, with the thumbnail the Gallery shows when
   * `thumbnail` asks for one. Rejects with a QartError saying why it can't be opened.
   */
  open(file: Blob, limits: QartLimits = {}, { thumbnail = false } = {}): Promise<OpenedQart> {
    return this.call(
      { method: 'open', file, limits, thumbnail },
      () => [],
      () => openQartFile(file, limits, thumbnail),
    ) as Promise<OpenedQart>
  }

  private async call(
    request: QartCall,
    transfer: () => ArrayBuffer[],
    local: () => Promise<unknown>,
  ): Promise<unknown> {
    if (!(await this.start()) || !this.worker) return local()
    const worker = this.worker
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.calls.set(id, { resolve, reject })
      try {
        worker.postMessage({ ...request, id }, transfer())
      } catch (err) {
        this.calls.delete(id)
        reject(err)
      }
    })
  }

  private start(): Promise<boolean> {
    this.started ??= new Promise<boolean>((resolve) => {
      if (!this.createWorker) {
        resolve(false)
        return
      }
      let worker: WorkerLike
      try {
        worker = this.createWorker()
      } catch (err) {
        console.warn('[QUAR] The .qart worker could not start; reading and writing files on the main thread:', err)
        resolve(false)
        return
      }
      this.worker = worker
      const timer = setTimeout(() => this.stop(new Error('the .qart worker did not start'), resolve), this.startTimeoutMs)
      worker.addEventListener('message', (event) => {
        const data = event.data as QartReady | QartReply
        if ('ready' in data) {
          clearTimeout(timer)
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
        this.stop(new Error(`the .qart worker stopped: ${event.message || 'it could not load'}`), resolve)
      })
      worker.addEventListener('messageerror', () => {
        clearTimeout(timer)
        this.stop(new Error('the .qart worker sent an answer that could not be read'), resolve)
      })
    })
    return this.started
  }

  /** Give up on the worker: calls waiting for it fail, and later ones run on the main thread. */
  private stop(reason: Error, resolveStarted: (started: boolean) => void) {
    if (this.worker) {
      console.warn('[QUAR] Reading and writing files on the main thread:', reason.message)
      this.worker.terminate()
      this.worker = null
    }
    resolveStarted(false)
    for (const call of this.calls.values()) call.reject(reason)
    this.calls.clear()
  }
}

let shared: QartCodec | null = null

function codec(): QartCodec {
  shared ??= new QartCodec(
    typeof Worker === 'function'
      ? () =>
          new Worker(new URL('./qartWorker.ts', import.meta.url), {
            type: 'module',
            name: 'QUAR Artist files',
          }) as unknown as WorkerLike
      : null,
  )
  return shared
}

/**
 * Write a document as a .qart file, off the main thread where it can be.
 * The layers' pixel buffers are handed over: don't use them after calling.
 */
export function writeQart(input: QartWriterInput): Promise<Blob> {
  return codec().write(input)
}

/**
 * The limits the app opens files within: whatever it can make itself on
 * this device, as many layers as it allows at its largest canvas. So a file
 * it wrote always opens again.
 */
export function appQartLimits(): Required<QartLimits> {
  const side = maxCanvasSide()
  return { maxLayers: MAX_LAYERS, maxSide: side, maxBytes: MAX_LAYERS * side * side * 4 }
}

/**
 * Read a .qart file to open, off the main thread where it can be, with the
 * thumbnail the Gallery shows when `thumbnail` asks for one. Rejects with a
 * QartError saying why it can't be opened.
 */
export function openQart(file: Blob, limits: QartLimits, options?: { thumbnail?: boolean }): Promise<OpenedQart> {
  return codec().open(file, limits, options)
}
