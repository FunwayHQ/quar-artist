import { describe, it, expect, vi, afterEach } from 'vitest'
import { QartCodec, appQartLimits } from './qartCodec.ts'
import { serveQartCodec, type QartPort, type QartRequest } from './qartProtocol.ts'
import type { QartWriterInput } from './QartWriter.ts'
import type { WorkerLike } from '../../tiles/WorkerDocumentStore.ts'
import { manifestOf, qartArchive, solidLayer, text } from './testArchives.ts'
import { MAX_LAYERS, type LayerInfo } from '../../../types/layer.ts'
import { maxCanvasSide } from '../../../utils/deviceLimits.ts'
import { encodeLayersThumbnail } from '../../persistence/thumbnail.ts'
import { sameBytes } from '../../../test/bytes.ts'

function layer(id: string): LayerInfo {
  return { id, name: id, visible: true, opacity: 1, blendMode: 'normal', alphaLock: false, clippingMask: false, locked: false }
}

function input(): QartWriterInput {
  return {
    name: 'Doc',
    width: 64,
    height: 64,
    dpi: 72,
    layers: [{ info: layer('a'), pixels: solidLayer(64, 64, [255, 0, 0, 255]) }],
    activeLayerId: 'a',
  }
}

// jsdom has no 2D canvas: the Gallery's thumbnails are stood in for.
vi.mock('../../persistence/thumbnail.ts', () => ({
  encodeLayersThumbnail: vi.fn(async () => ({ type: 'image/webp', data: new Uint8Array([7, 7]).buffer })),
}))

type Listener = (event: never) => void

/** A worker that runs the .qart codec on this thread, recording what crosses, as a real one would. */
class FakeWorker implements WorkerLike {
  readonly listeners: Record<string, Listener[]> = { message: [], error: [], messageerror: [] }
  readonly sent: { message: QartRequest; transfer: Transferable[] }[] = []
  readonly replies: { message: unknown; transfer: Transferable[] }[] = []
  terminated = false
  private portListener: ((event: MessageEvent<QartRequest>) => void) | null = null

  constructor({ serve = true } = {}) {
    if (!serve) return
    const port: QartPort = {
      postMessage: (message, transfer) => {
        this.replies.push({ message, transfer })
        setTimeout(() => this.emit('message', { data: message }))
      },
      addEventListener: (_type, listener) => {
        this.portListener = listener
      },
    }
    serveQartCodec(port)
  }

  postMessage(message: unknown, transfer: Transferable[]) {
    this.sent.push({ message: message as QartRequest, transfer })
    setTimeout(() => this.portListener?.({ data: message } as MessageEvent<QartRequest>))
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners[type].push(listener)
  }

  terminate() {
    this.terminated = true
  }

  emit(type: string, event: unknown) {
    for (const listener of this.listeners[type]) listener(event as never)
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('QartCodec', () => {
  it('writes and reads in the worker, handing pixel buffers over without copies', async () => {
    const worker = new FakeWorker()
    const codec = new QartCodec(() => worker)
    const doc = input()
    const pixels = doc.layers[0].pixels

    const blob = await codec.write(doc)
    expect(worker.sent[0].message.method).toBe('write')
    expect(worker.sent[0].transfer).toHaveLength(1)
    expect(worker.sent[0].transfer[0]).toBe(pixels.buffer)

    const { document, thumbnail } = await codec.open(blob, { maxLayers: 20 })
    expect(worker.sent[1].message).toMatchObject({ method: 'open', limits: { maxLayers: 20 }, thumbnail: false })
    expect(sameBytes(document.layers[0].pixels, solidLayer(64, 64, [255, 0, 0, 255]))).toBe(true)
    expect(thumbnail).toBeNull()
    expect(worker.replies.at(-1)!.transfer).toHaveLength(1)
    expect(worker.replies.at(-1)!.transfer[0]).toBe(document.layers[0].pixels.buffer)
  })

  it("draws the Gallery's thumbnail where it reads the file, when asked to, and hands it over too", async () => {
    vi.mocked(encodeLayersThumbnail).mockClear()
    const worker = new FakeWorker()
    const codec = new QartCodec(() => worker)

    const { document, thumbnail } = await codec.open(await codec.write(input()), {}, { thumbnail: true })

    expect(thumbnail?.type).toBe('image/webp')
    expect(new Uint8Array(thumbnail!.data)).toEqual(new Uint8Array([7, 7]))
    expect(vi.mocked(encodeLayersThumbnail).mock.calls.at(-1)!.slice(1)).toEqual([64, 64])
    expect(worker.replies.at(-1)!.transfer).toEqual([document.layers[0].pixels.buffer, thumbnail!.data])
  })

  it('opens a document as large as the app can make on this device: as many layers as it allows, at its largest canvas', async () => {
    const side = maxCanvasSide()
    expect(appQartLimits()).toEqual({ maxLayers: MAX_LAYERS, maxSide: side, maxBytes: MAX_LAYERS * side * side * 4 })
    // More than 4 GiB on a desktop: 20 layers of 8192 × 8192.
    const ids = Array.from({ length: MAX_LAYERS }, (_, i) => `l${i}`)
    const file = new Blob([qartArchive(manifestOf({ width: side, height: side, layerIds: ids }))])

    const { document } = await new QartCodec(null).open(file, appQartLimits())

    expect(document.layers).toHaveLength(MAX_LAYERS)
    expect(document.layers[0].pixels.length).toBe(side * side * 4)
  })

  it("passes on why a file can't be opened, as a QartError", async () => {
    const codec = new QartCodec(() => new FakeWorker())
    const refused = await codec.open(new Blob([text('not a qart file, but long enough to look at')])).catch((err: Error) => err)
    expect(refused).toMatchObject({ name: 'QartError', message: "it isn't a .qart file" })
  })

  it('works on the main thread where there are no workers', async () => {
    const codec = new QartCodec(null)
    const { document, thumbnail } = await codec.open(await codec.write(input()), {}, { thumbnail: true })
    expect(document.name).toBe('Doc')
    expect(thumbnail?.type).toBe('image/webp')
  })

  it("works on the main thread when the worker can't start, or doesn't say it started in time", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const throwing = new QartCodec(() => {
      throw new Error('no workers here')
    })
    expect((await throwing.open(await throwing.write(input()))).document.name).toBe('Doc')

    const silent = new FakeWorker({ serve: false })
    const slow = new QartCodec(() => silent, { startTimeoutMs: 20 })
    expect((await slow.open(await slow.write(input()))).document.name).toBe('Doc')
    expect(silent.terminated).toBe(true)
    expect(silent.sent).toHaveLength(0)
  })

  it('fails the calls a stopped worker had, and does later ones on the main thread', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const worker = new FakeWorker({ serve: false })
    const codec = new QartCodec(() => worker)
    setTimeout(() => worker.emit('message', { data: { ready: true } }))
    const waiting = codec.write(input())
    await vi.waitFor(() => expect(worker.sent).toHaveLength(1))
    worker.emit('error', { message: 'out of memory', preventDefault: () => {} })
    await expect(waiting).rejects.toThrow('the .qart worker stopped: out of memory')
    expect(worker.terminated).toBe(true)
    expect((await codec.open(await codec.write(input()))).document.name).toBe('Doc')
    expect(worker.sent).toHaveLength(1)
  })
})
