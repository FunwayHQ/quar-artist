import type { StoredImage } from '../../types/project.ts'
import { encodeLayersThumbnail } from '../persistence/thumbnail.ts'
import { buffersOf, toWireError, type WireError } from '../tiles/storeProtocol.ts'
import type { PsdDocument, PsdLimits } from './psd/PsdReader.ts'
import type { PsdWriterInput } from './psd/PsdWriter.ts'
import { decodeQart, type QartDocument, type QartLimits } from './qart/QartReader.ts'
import { encodeQart, type QartWriterInput } from './qart/QartWriter.ts'

/** A file read to open: its document, and the thumbnail the Gallery shows, when one was asked for. */
export interface Opened<D> {
  document: D
  /** Null when none was asked for, or none could be drawn where the file was read. */
  thumbnail: StoredImage | null
}

export type OpenedQart = Opened<QartDocument>
export type OpenedPsd = Opened<PsdDocument>

/**
 * How the app talks to the files worker: writing a document as a .qart
 * (plan M1.6) or PSD file (plan M1.7), or reading one to open.
 */
export type FileCall =
  | { method: 'writeQart'; input: QartWriterInput }
  | { method: 'openQart'; file: Blob; limits: QartLimits; thumbnail: boolean }
  | { method: 'writePsd'; input: PsdWriterInput }
  | { method: 'openPsd'; file: Blob; limits: PsdLimits; thumbnail: boolean }

export type FileRequest = FileCall & { id: number }

export type FileReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: WireError }

/** The worker's first message: it started. */
export interface FileReady {
  ready: true
}

/** The worker's side of its messages. */
export interface FilePort {
  postMessage(message: FileReply | FileReady, transfer: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<FileRequest>) => void): void
}

/** The pixel buffers a call hands over to the worker. */
export function callBuffers(call: FileCall): ArrayBuffer[] {
  if (call.method === 'writeQart') return buffersOf(call.input.layers.map((l) => l.pixels))
  if (call.method === 'writePsd') return buffersOf([...call.input.layers.map((l) => l.pixels), call.input.composite])
  return []
}

/** The buffers opening a file hands back: the layers' pixels, and the thumbnail. */
export function openedBuffers({ document, thumbnail }: Opened<{ layers: readonly { pixels: Uint8Array }[] }>): ArrayBuffer[] {
  return [...buffersOf(document.layers.map((l) => l.pixels)), ...(thumbnail ? [thumbnail.data] : [])]
}

/** The thumbnail the Gallery shows of a document's layers, or null when none can be drawn here. */
function thumbnailOf(
  layers: readonly { pixels: Uint8Array; opacity: number; visible: boolean; blendMode: QartDocument['layers'][number]['info']['blendMode'] }[],
  width: number,
  height: number,
): Promise<StoredImage | null> {
  return encodeLayersThumbnail(layers, width, height).catch(() => null)
}

/**
 * Read a .qart file to open, and draw the thumbnail the Gallery shows from
 * its layers when asked to: in the files worker, off the main thread, or on
 * it where there is no worker.
 */
export async function openQartFile(file: Blob, limits: QartLimits, thumbnail: boolean): Promise<OpenedQart> {
  const document = await decodeQart(file, limits)
  const layers = document.layers.map(({ info, pixels }) => ({ pixels, opacity: info.opacity, visible: info.visible, blendMode: info.blendMode }))
  return { document, thumbnail: thumbnail ? await thumbnailOf(layers, document.width, document.height) : null }
}

/** Read a PSD file to open, with the Gallery's thumbnail when asked for. ag-psd loads with the first PSD file. */
export async function openPsdFile(file: Blob, limits: PsdLimits, thumbnail: boolean): Promise<OpenedPsd> {
  const { decodePsd } = await import('./psd/PsdReader.ts')
  const document = await decodePsd(file, limits)
  return { document, thumbnail: thumbnail ? await thumbnailOf(document.layers, document.width, document.height) : null }
}

/** Write a document as a PSD file. ag-psd loads with the first PSD file. */
export async function writePsdFile(input: PsdWriterInput): Promise<Blob> {
  const { encodePsd } = await import('./psd/PsdWriter.ts')
  return encodePsd(input)
}

/** Answer a call: its value, and the buffers to hand back with it. */
export async function runFileCall(call: FileCall): Promise<{ value: unknown; transfer: ArrayBuffer[] }> {
  switch (call.method) {
    case 'writeQart':
      return { value: await encodeQart(call.input), transfer: [] }
    case 'openQart': {
      const opened = await openQartFile(call.file, call.limits, call.thumbnail)
      return { value: opened, transfer: openedBuffers(opened) }
    }
    case 'writePsd':
      return { value: await writePsdFile(call.input), transfer: [] }
    case 'openPsd': {
      const opened = await openPsdFile(call.file, call.limits, call.thumbnail)
      return { value: opened, transfer: openedBuffers(opened) }
    }
  }
}

/** Answer requests on `port`: what the files worker does. */
export function serveFileCodec(port: FilePort) {
  port.addEventListener('message', (event) => {
    const { id, ...call } = event.data
    void (async () => {
      try {
        const { value, transfer } = await runFileCall(call)
        port.postMessage({ id, ok: true, value }, transfer)
      } catch (err) {
        port.postMessage({ id, ok: false, error: toWireError(err) }, [])
      }
    })()
  })
  port.postMessage({ ready: true }, [])
}
