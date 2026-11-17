import type { DocumentGuides } from '../../../types/guides.ts'
import { ALL_BLEND_MODES, type LayerInfo } from '../../../types/layer.ts'
import type { ColorSpace } from '../../../types/project.ts'
import { TILE_SIZE, tileColumns, tileRows } from '../../../utils/tiles.ts'
import { encodeLayersThumbnail } from '../../persistence/thumbnail.ts'
import { cutTile } from '../../tiles/tileFormat.ts'
import {
  LAYER_ID,
  MANIFEST_ENTRY,
  MAX_DPI,
  MAX_FILE_LAYERS,
  MAX_FILE_SIDE,
  QART_MIME,
  QartError,
  THUMBNAIL_ENTRY,
  createManifest,
} from './manifest.ts'
import { ZipWriter } from './zip.ts'

/** A document to write as a .qart file. */
export interface QartWriterInput {
  /** The project's name. */
  name: string
  width: number
  height: number
  dpi: number
  colorSpace?: ColorSpace
  /** Bottom first. */
  layers: QartWriterLayer[]
  activeLayerId: string
  guides?: DocumentGuides | null
  createdAt?: string
  updatedAt?: string
}

/** A layer to write: its properties, and its pixels, straight RGBA8 at the document's size. */
export interface QartWriterLayer {
  info: LayerInfo
  pixels: Uint8Array
}

/** Makes a file's thumbnail: PNG bytes, or null for none. */
export type ThumbnailMaker = (layers: readonly QartWriterLayer[], width: number, height: number) => Promise<Uint8Array | null>

const BLEND_MODES: ReadonlySet<string> = new Set(ALL_BLEND_MODES)

/** The layers composited and scaled down as a PNG, where the browser can draw it here. */
export async function pngThumbnail(layers: readonly QartWriterLayer[], width: number, height: number): Promise<Uint8Array | null> {
  const image = await encodeLayersThumbnail(
    layers.map(({ info, pixels }) => ({ pixels, opacity: info.opacity, visible: info.visible, blendMode: info.blendMode })),
    width,
    height,
    'image/png',
  )
  return image?.type === 'image/png' ? new Uint8Array(image.data) : null
}

/** Whether a tile's part of a straight-alpha layer is fully transparent: its premultiplied tile is all zeros. */
function emptyTile(pixels: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  const left = x * TILE_SIZE
  const top = y * TILE_SIZE
  const right = Math.min(width, left + TILE_SIZE)
  const bottom = Math.min(height, top + TILE_SIZE)
  for (let row = top; row < bottom; row++) {
    for (let i = (row * width + left) * 4 + 3, end = (row * width + right) * 4; i < end; i += 4) if (pixels[i] !== 0) return false
  }
  return true
}

/**
 * Write a document as a .qart file, version 1 (docs/qart-format.md): its
 * manifest, a thumbnail, and each layer's tiles that have any paint,
 * premultiplied and compressed. The archive is made entry by entry, as a
 * list of parts, so no buffer the size of the file is ever needed. What the
 * reader would refuse is put right instead: ids that repeat or that it
 * doesn't allow get fresh ones, names are cut to 256 characters, and
 * numbers are brought into range.
 */
export async function encodeQart(input: QartWriterInput, makeThumbnail: ThumbnailMaker = pngThumbnail): Promise<Blob> {
  const { width, height } = input
  if (![width, height].every((side) => Number.isInteger(side) && side >= 1 && side <= MAX_FILE_SIDE)) {
    throw new QartError(`a canvas of ${width} × ${height} px can't be saved as a .qart file`)
  }
  if (input.layers.length === 0) throw new QartError('there are no layers to save')
  if (input.layers.length > MAX_FILE_LAYERS) throw new QartError(`a .qart file holds at most ${MAX_FILE_LAYERS} layers`)
  for (const { info, pixels } of input.layers) {
    if (pixels.length !== width * height * 4) throw new QartError(`the layer “${info.name}” isn't the canvas's size`)
  }

  // Every layer under an id of its own: it names the layer's tile folder.
  const given = new Set(input.layers.map((l) => l.info.id))
  const used = new Set<string>()
  let fresh = 0
  const layers = input.layers.map(({ info }): LayerInfo => {
    let id = info.id
    if (!LAYER_ID.test(id) || used.has(id)) {
      do id = `layer-${++fresh}`
      while (used.has(id) || given.has(id))
    }
    used.add(id)
    const opacity = Number.isFinite(info.opacity) ? Math.min(1, Math.max(0, info.opacity)) : 1
    const blendMode = BLEND_MODES.has(info.blendMode) ? info.blendMode : 'normal'
    return { ...info, id, opacity, blendMode, name: String(info.name) }
  })
  const active = input.layers.findIndex((l) => l.info.id === input.activeLayerId)
  const activeLayerId = layers[active >= 0 ? active : layers.length - 1].id
  const dpi = Number.isFinite(input.dpi) ? Math.min(MAX_DPI, Math.max(1, input.dpi)) : 72

  // Without one when it can't be made. Encoding one gives up after a while (THUMBNAIL_ENCODE_MS).
  const thumbnail = await Promise.resolve()
    .then(() => makeThumbnail(input.layers, width, height))
    .catch(() => null)
  const manifest = createManifest({
    name: String(input.name),
    width,
    height,
    dpi,
    colorSpace: input.colorSpace === 'display-p3' ? 'display-p3' : 'srgb',
    layers,
    activeLayerId,
    guides: input.guides ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    thumbnail: thumbnail !== null,
  })

  const zip = new ZipWriter({ level: 6 })
  zip.add(MANIFEST_ENTRY, new TextEncoder().encode(JSON.stringify(manifest)))
  // A PNG is compressed already.
  if (thumbnail) zip.add(THUMBNAIL_ENTRY, thumbnail, false)
  const columns = tileColumns(width)
  const rows = tileRows(height)
  input.layers.forEach(({ pixels }, i) => {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        if (!emptyTile(pixels, width, height, x, y)) zip.add(`tiles/${layers[i].id}/${x}_${y}.raw`, cutTile(pixels, width, height, x, y))
      }
    }
  })
  return zip.finish(QART_MIME)
}
