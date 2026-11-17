import type { LayerInfo } from '../../../types/layer.ts'
import type { ColorSpace } from '../../../types/project.ts'
import { TILE_BYTES, placeTile } from '../../tiles/tileFormat.ts'
import { tileColumns, tileRows } from '../../../utils/tiles.ts'
import {
  MANIFEST_ENTRY,
  MAX_MANIFEST_BYTES,
  QartError,
  damaged,
  notQart,
  parseManifest,
  tooLarge,
  type ParsedManifest,
} from './manifest.ts'
import { OversizedEntryError, blobSource, inflateEntry, readEntries, readZipDirectory, type ZipEntry, type ZipSource } from './zip.ts'

/** The app's limits on what it opens, checked before any pixels are read. */
export interface QartLimits {
  /** A file with more layers is refused. */
  maxLayers?: number
  /** A file whose width or height is larger is refused. */
  maxSide?: number
  /** A file whose layers would take more memory (layers × width × height × 4 bytes) is refused. MAX_DOCUMENT_BYTES unless said. */
  maxBytes?: number
}

/** A layer as read: its properties, and its pixels, straight RGBA8 at the document's size. */
export interface QartLayer {
  info: LayerInfo
  pixels: Uint8Array
}

/** A .qart file's document, as read. */
export interface QartDocument {
  /** The format version it was written in: 1, or 0 for the draft layout written before version 1. */
  formatVersion: number
  /** The project's name when the file was written, or null when the file doesn't say. */
  name: string | null
  width: number
  height: number
  dpi: number
  colorSpace: ColorSpace
  /** Bottom first. */
  layers: QartLayer[]
  /** One of the layers' ids. */
  activeLayerId: string
  /** The guides as the file has them, for `savedGuides` to check, or null. */
  guides: unknown
  createdAt?: string
  updatedAt?: string
  /**
   * Tiles of 256 × 256 px whose data was damaged: they are transparent.
   * The file may still have them, for another program to recover.
   */
  unreadableTiles: number
}

/** The most memory an opened document's layers may take, unless the caller allows more: more doesn't open reliably in a browser. */
export const MAX_DOCUMENT_BYTES = 2 ** 32

/** A tile's entry: `tiles/<layer id>/<column>_<row>.raw`, numbers without leading zeros. */
const TILE_NAME = /^tiles\/([A-Za-z0-9_-]{1,64})\/(0|[1-9][0-9]{0,4})_(0|[1-9][0-9]{0,4})\.raw$/
const TILES_FOLDER = 'tiles/'

/**
 * Read a .qart file (docs/qart-format.md): version 1, or the draft layout
 * written before it. Everything is checked before any pixels are read:
 * the manifest, the app's `limits`, and every entry the document needs.
 * Throws a QartError saying why a file can't be opened.
 */
export async function decodeQart(file: Blob, limits: QartLimits = {}): Promise<QartDocument> {
  const source = blobSource(file)
  const entries = await readZipDirectory(source)
  const manifestEntry = entries.find((e) => e.name === MANIFEST_ENTRY)
  if (!manifestEntry) throw notQart()
  const manifest = parseManifest(await readManifest(source, manifestEntry))
  checkLimits(manifest, limits)

  const { layers, unreadableTiles } =
    manifest.formatVersion === 0 ? await readDraftLayers(source, entries, manifest) : await readTiles(source, entries, manifest)
  return {
    formatVersion: manifest.formatVersion,
    name: manifest.name,
    width: manifest.width,
    height: manifest.height,
    dpi: manifest.dpi,
    colorSpace: manifest.colorSpace,
    layers,
    activeLayerId: manifest.activeLayerId,
    guides: manifest.guides,
    ...(manifest.createdAt ? { createdAt: manifest.createdAt } : {}),
    ...(manifest.updatedAt ? { updatedAt: manifest.updatedAt } : {}),
    unreadableTiles,
  }
}

async function readManifest(source: ZipSource, entry: ZipEntry): Promise<unknown> {
  if (entry.size > MAX_MANIFEST_BYTES) throw damaged('its manifest is too large')
  const read: Uint8Array[] = []
  await readEntries(source, [entry], (e, compressed) => read.push(inflateEntry(e, compressed, MAX_MANIFEST_BYTES)))
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read[0]))
  } catch {
    throw damaged("its manifest isn't valid JSON")
  }
}

function checkLimits(manifest: ParsedManifest, { maxLayers, maxSide, maxBytes = MAX_DOCUMENT_BYTES }: QartLimits) {
  const { width, height, layers } = manifest
  if (maxSide !== undefined && (width > maxSide || height > maxSide)) {
    throw new QartError(`it is ${width} × ${height} px. This device supports canvases up to ${maxSide} × ${maxSide} px`)
  }
  if (maxLayers !== undefined && layers.length > maxLayers) {
    throw new QartError(`it has ${layers.length} layers, and QUAR Artist opens up to ${maxLayers}`)
  }
  if (layers.length * width * height * 4 > maxBytes) throw tooLarge()
}

function allocate(bytes: number): Uint8Array {
  try {
    return new Uint8Array(bytes)
  } catch {
    throw tooLarge()
  }
}

/** Damaged data in an entry, which leaves its part transparent. An entry made to exhaust memory refuses the whole file. */
function isDamagedData(err: unknown): boolean {
  return err instanceof QartError && !(err instanceof OversizedEntryError)
}

/** Version 1: each layer's tiles, put together into whole layers. */
async function readTiles(source: ZipSource, entries: readonly ZipEntry[], manifest: ParsedManifest) {
  const { width, height } = manifest
  const columns = tileColumns(width)
  const rows = tileRows(height)
  const index = new Map(manifest.layers.map((l, i) => [l.info.id, i]))

  // Every tile is checked before any is read.
  const tiles = new Map<ZipEntry, { layer: number; x: number; y: number }>()
  for (const entry of entries) {
    // Other entries, such as the thumbnail, aren't needed. Folders are skipped.
    if (!entry.name.startsWith(TILES_FOLDER) || entry.name.endsWith('/')) continue
    const match = TILE_NAME.exec(entry.name)
    if (!match) throw damaged(`“${entry.name}” isn't a tile`)
    const layer = index.get(match[1])
    if (layer === undefined) throw damaged(`“${entry.name}” belongs to none of its layers`)
    const x = Number(match[2])
    const y = Number(match[3])
    if (x >= columns || y >= rows) throw damaged(`“${entry.name}” is outside the canvas`)
    if (entry.size !== TILE_BYTES) throw damaged(`“${entry.name}” has the wrong size`)
    tiles.set(entry, { layer, x, y })
  }

  const layers = manifest.layers.map(({ info }) => ({ info, pixels: allocate(width * height * 4) }))
  const targets = layers.map(({ pixels }) => new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength))
  let unreadableTiles = 0
  await readEntries(source, [...tiles.keys()], (entry, compressed) => {
    const { layer, x, y } = tiles.get(entry)!
    let tile: Uint8Array
    try {
      tile = inflateEntry(entry, compressed, TILE_BYTES)
    } catch (err) {
      if (!isDamagedData(err)) throw err
      unreadableTiles++
      return
    }
    placeTile(tile, targets[layer], width, height, x, y)
  })
  return { layers, unreadableTiles }
}

/** The draft layout: each layer whole, straight RGBA8, in the entry the manifest names. */
async function readDraftLayers(source: ZipSource, entries: readonly ZipEntry[], manifest: ParsedManifest) {
  const { width, height } = manifest
  const size = width * height * 4
  const byName = new Map(entries.map((e) => [e.name, e]))
  const needed = new Map<ZipEntry, number>()
  manifest.layers.forEach(({ info, dataFile }, i) => {
    const entry = byName.get(dataFile!)
    if (!entry) throw damaged(`the layer “${info.name}” has no pixels`)
    if (entry.size !== size) throw damaged(`the layer “${info.name}” has the wrong size`)
    needed.set(entry, i)
  })

  const pixels: (Uint8Array | null)[] = manifest.layers.map(() => null)
  let unreadableTiles = 0
  await readEntries(source, [...needed.keys()], (entry, compressed) => {
    try {
      pixels[needed.get(entry)!] = inflateEntry(entry, compressed, size)
    } catch (err) {
      if (!isDamagedData(err)) throw err
      unreadableTiles += tileColumns(width) * tileRows(height)
    }
  })
  const layers = manifest.layers.map(({ info }, i) => ({ info, pixels: pixels[i] ?? allocate(size) }))
  return { layers, unreadableTiles }
}
