import { describe, it, expect, vi, afterEach } from 'vitest'
import { FileCodec, appFileLimits } from './fileCodec.ts'
import { serveFileCodec, type FilePort, type FileRequest } from './fileProtocol.ts'
import type { PsdWriterInput } from './psd/PsdWriter.ts'
import type { QartWriterInput } from './qart/QartWriter.ts'
import type { WorkerLike } from '../tiles/WorkerDocumentStore.ts'
import { manifestOf, qartArchive, solidLayer, text } from './qart/testArchives.ts'
import { MAX_LAYERS, type LayerInfo } from '../../types/layer.ts'
import { maxCanvasSide } from '../../utils/deviceLimits.ts'
import { encodeLayersThumbnail } from '../persistence/thumbnail.ts'
import { sameBytes } from '../../test/bytes.ts'

function layer(id: string): LayerInfo {
  return { id, name: id, visible: true, opacity: 1, blendMode: 'normal', alphaLock: false, clippingMask: false, locked: false }
}

function psdInput(): PsdWriterInput {
  return {
    width: 64,
    height: 64,
    dpi: 72,
    layers: [{ info: layer('a'), pixels: solidLayer(64, 64, [255, 0, 0, 255]) }],
    activeLayerId: 'a',
    composite: solidLayer(64, 64, [255, 0, 0, 255]),
  }
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
vi.mock('../persistence/thumbnail.ts', () => ({
  encodeLayersThumbnail: vi.fn(async () => ({ type: 'image/webp', data: new Uint8Array([7, 7]).buffer })),
}))

type Listener = (event: never) => void

/** A worker that runs the files codec on this thread, recording what crosses, as a real one would. */
class FakeWorker implements WorkerLike {
  readonly listeners: Record<string, Listener[]> = { message: [], error: [], messageerror: [] }
  readonly sent: { message: FileRequest; transfer: Transferable[] }[] = []
  readonly replies: { message: unknown; transfer: Transferable[] }[] = []
  terminated = false
  private portListener: ((event: MessageEvent<FileRequest>) => void) | null = null

  constructor({ serve = true } = {}) {
    if (!serve) return
    const port: FilePort = {
      postMessage: (message, transfer) => {
        this.replies.push({ message, transfer })
        setTimeout(() => this.emit('message', { data: message }))
      },
      addEventListener: (_type, listener) => {
        this.portListener = listener
      },
    }
    serveFileCodec(port)
  }

  postMessage(message: unknown, transfer: Transferable[]) {
    this.sent.push({ message: message as FileRequest, transfer })
    setTimeout(() => this.portListener?.({ data: message } as MessageEvent<FileRequest>))
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

describe('FileCodec', () => {
  it('writes and reads in the worker, handing pixel buffers over without copies', async () => {
    const worker = new FakeWorker()
    const codec = new FileCodec(() => worker)
    const doc = input()
    const pixels = doc.layers[0].pixels

    const blob = await codec.writeQart(doc)
    expect(worker.sent[0].message.method).toBe('writeQart')
    expect(worker.sent[0].transfer).toHaveLength(1)
    expect(worker.sent[0].transfer[0]).toBe(pixels.buffer)

    const { document, thumbnail } = await codec.openQart(blob, { maxLayers: 20 })
    expect(worker.sent[1].message).toMatchObject({ method: 'openQart', limits: { maxLayers: 20 }, thumbnail: false })
    expect(sameBytes(document.layers[0].pixels, solidLayer(64, 64, [255, 0, 0, 255]))).toBe(true)
    expect(thumbnail).toBeNull()
    expect(worker.replies.at(-1)!.transfer).toHaveLength(1)
    expect(worker.replies.at(-1)!.transfer[0]).toBe(document.layers[0].pixels.buffer)
  })

  it("draws the Gallery's thumbnail where it reads the file, when asked to, and hands it over too", async () => {
    vi.mocked(encodeLayersThumbnail).mockClear()
    const worker = new FakeWorker()
    const codec = new FileCodec(() => worker)

    const { document, thumbnail } = await codec.openQart(await codec.writeQart(input()), {}, { thumbnail: true })

    expect(thumbnail?.type).toBe('image/webp')
    expect(new Uint8Array(thumbnail!.data)).toEqual(new Uint8Array([7, 7]))
    expect(vi.mocked(encodeLayersThumbnail).mock.calls.at(-1)!.slice(1)).toEqual([64, 64])
    expect(worker.replies.at(-1)!.transfer).toEqual([document.layers[0].pixels.buffer, thumbnail!.data])
  })

  it('opens a document as large as the app can make on this device: as many layers as it allows, at its largest canvas', async () => {
    const side = maxCanvasSide()
    expect(appFileLimits()).toEqual({ maxLayers: MAX_LAYERS, maxSide: side, maxBytes: MAX_LAYERS * side * side * 4 })
    // More than 4 GiB on a desktop: 20 layers of 8192 × 8192.
    const ids = Array.from({ length: MAX_LAYERS }, (_, i) => `l${i}`)
    const file = new Blob([qartArchive(manifestOf({ width: side, height: side, layerIds: ids }))])

    const { document } = await new FileCodec(null).openQart(file, appFileLimits())

    expect(document.layers).toHaveLength(MAX_LAYERS)
    expect(document.layers[0].pixels.length).toBe(side * side * 4)
  })

  it("passes on why a file can't be opened, as a QartError", async () => {
    const codec = new FileCodec(() => new FakeWorker())
    const refused = await codec.openQart(new Blob([text('not a qart file, but long enough to look at')])).catch((err: Error) => err)
    expect(refused).toMatchObject({ name: 'QartError', message: "it isn't a .qart file" })
  })

  it('writes and reads PSD files in the worker, handing over the layers, the composite and the thumbnail (plan M1.7)', async () => {
    vi.mocked(encodeLayersThumbnail).mockClear()
    const worker = new FakeWorker()
    const codec = new FileCodec(() => worker)
    const doc = psdInput()

    const blob = await codec.writePsd(doc)
    expect(worker.sent[0].message.method).toBe('writePsd')
    expect(worker.sent[0].transfer).toEqual([doc.layers[0].pixels.buffer, doc.composite.buffer])
    expect(blob.type).toBe('image/vnd.adobe.photoshop')

    const { document, thumbnail } = await codec.openPsd(blob, { maxLayers: 20 }, { thumbnail: true })
    expect(worker.sent[1].message).toMatchObject({ method: 'openPsd', limits: { maxLayers: 20 }, thumbnail: true })
    expect(document).toMatchObject({ width: 64, height: 64, activeLayer: 0 })
    expect(sameBytes(document.layers[0].pixels, solidLayer(64, 64, [255, 0, 0, 255]))).toBe(true)
    expect(vi.mocked(encodeLayersThumbnail).mock.calls.at(-1)!.slice(1)).toEqual([64, 64])
    expect(worker.replies.at(-1)!.transfer).toEqual([document.layers[0].pixels.buffer, thumbnail!.data])
  })

  it("passes on why a PSD file can't be opened, as a PsdError", async () => {
    const codec = new FileCodec(() => new FakeWorker())
    const refused = await codec.openPsd(new Blob([text('not a PSD file, but long enough to look at')])).catch((err: Error) => err)
    expect(refused).toMatchObject({ name: 'PsdError', message: "it isn't a PSD file, or it is damaged" })
  })

  it('works on the main thread where there are no workers', async () => {
    const codec = new FileCodec(null)
    const { document, thumbnail } = await codec.openQart(await codec.writeQart(input()), {}, { thumbnail: true })
    expect(document.name).toBe('Doc')
    expect(thumbnail?.type).toBe('image/webp')
    const psd = await codec.openPsd(await codec.writePsd(psdInput()))
    expect(psd.document.layers).toHaveLength(1)
  })

  it("works on the main thread when the worker can't start, or doesn't say it started in time", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const throwing = new FileCodec(() => {
      throw new Error('no workers here')
    })
    expect((await throwing.openQart(await throwing.writeQart(input()))).document.name).toBe('Doc')

    const silent = new FakeWorker({ serve: false })
    const slow = new FileCodec(() => silent, { startTimeoutMs: 20 })
    expect((await slow.openQart(await slow.writeQart(input()))).document.name).toBe('Doc')
    expect(silent.terminated).toBe(true)
    expect(silent.sent).toHaveLength(0)
  })

  it('fails the calls a stopped worker had, and does later ones on the main thread', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const worker = new FakeWorker({ serve: false })
    const codec = new FileCodec(() => worker)
    setTimeout(() => worker.emit('message', { data: { ready: true } }))
    const waiting = codec.writeQart(input())
    await vi.waitFor(() => expect(worker.sent).toHaveLength(1))
    worker.emit('error', { message: 'out of memory', preventDefault: () => {} })
    await expect(waiting).rejects.toThrow('the files worker stopped: out of memory')
    expect(worker.terminated).toBe(true)
    expect((await codec.openQart(await codec.writeQart(input()))).document.name).toBe('Doc')
    expect(worker.sent).toHaveLength(1)
  })
})
