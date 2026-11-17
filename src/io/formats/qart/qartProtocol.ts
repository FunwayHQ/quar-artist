import type { StoredImage } from '../../../types/project.ts'
import { encodeLayersThumbnail } from '../../persistence/thumbnail.ts'
import { buffersOf, toWireError, type WireError } from '../../tiles/storeProtocol.ts'
import { decodeQart, type QartDocument, type QartLimits } from './QartReader.ts'
import { encodeQart, type QartWriterInput } from './QartWriter.ts'

/** A .qart file read to open: its document, and the thumbnail the Gallery shows, when one was asked for. */
export interface OpenedQart {
  document: QartDocument
  /** Null when none was asked for, or none could be drawn where the file was read. */
  thumbnail: StoredImage | null
}

/** How the app talks to the .qart worker (plan M1.6): writing a document as a file, or reading one to open. */
export type QartCall =
  | { method: 'write'; input: QartWriterInput }
  | { method: 'open'; file: Blob; limits: QartLimits; thumbnail: boolean }

export type QartRequest = QartCall & { id: number }

export type QartReply = { id: number; ok: true; value: Blob | OpenedQart } | { id: number; ok: false; error: WireError }

/** The worker's first message: it started. */
export interface QartReady {
  ready: true
}

/** The worker's side of its messages. */
export interface QartPort {
  postMessage(message: QartReply | QartReady, transfer: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent<QartRequest>) => void): void
}

/** The pixel buffers a write hands over to the worker. */
export function inputBuffers(input: QartWriterInput): ArrayBuffer[] {
  return buffersOf(input.layers.map((l) => l.pixels))
}

/** The buffers opening a file hands back: the layers' pixels, and the thumbnail. */
export function openedBuffers({ document, thumbnail }: OpenedQart): ArrayBuffer[] {
  return [...buffersOf(document.layers.map((l) => l.pixels)), ...(thumbnail ? [thumbnail.data] : [])]
}

/**
 * Read a .qart file to open, and draw the thumbnail the Gallery shows from
 * its layers when asked to: in the .qart worker, off the main thread, or on
 * it where there is no worker.
 */
export async function openQartFile(file: Blob, limits: QartLimits, thumbnail: boolean): Promise<OpenedQart> {
  const document = await decodeQart(file, limits)
  const image = thumbnail
    ? await encodeLayersThumbnail(
        document.layers.map(({ info, pixels }) => ({ pixels, opacity: info.opacity, visible: info.visible, blendMode: info.blendMode })),
        document.width,
        document.height,
      ).catch(() => null)
    : null
  return { document, thumbnail: image }
}

/** Answer requests on `port`: what the .qart worker does. */
export function serveQartCodec(port: QartPort) {
  port.addEventListener('message', (event) => {
    const request = event.data
    void (async () => {
      try {
        if (request.method === 'write') {
          port.postMessage({ id: request.id, ok: true, value: await encodeQart(request.input) }, [])
        } else {
          const opened = await openQartFile(request.file, request.limits, request.thumbnail)
          port.postMessage({ id: request.id, ok: true, value: opened }, openedBuffers(opened))
        }
      } catch (err) {
        port.postMessage({ id: request.id, ok: false, error: toWireError(err) }, [])
      }
    })()
  })
  port.postMessage({ ready: true }, [])
}
