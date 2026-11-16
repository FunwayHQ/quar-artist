/**
 * How documents are stored as tiles (plan D1, M1.2): every layer is cut into
 * 256 × 256 tiles of premultiplied RGBA8, padded with transparent pixels past
 * the document's edges. Empty tiles aren't stored, and a hash of each tile
 * lets a save skip the tiles that haven't changed since the last one.
 */
import { premultiplyInto, unpremultiplyInto } from '../../utils/alpha.ts'
import { TILE_SIZE, tileColumns, tileRows } from '../../utils/tiles.ts'
import { ALL_BLEND_MODES, type LayerInfo } from '../../types/layer.ts'

export { TILE_SIZE, tileColumns, tileRows }
export const TILE_BYTES = TILE_SIZE * TILE_SIZE * 4
/** The tile layout, recorded in each manifest. */
export const TILE_FORMAT = 'rgba8-premultiplied-256'

/** How a tile's bytes are compressed. */
export type TileCodec = 'deflate-raw' | 'raw'
/** Where tiles are kept: OPFS files, or IndexedDB records where OPFS isn't available. */
export type TileBackendKind = 'opfs' | 'idb'

export interface TileEntry {
  /** The tile's column and row. */
  x: number
  y: number
  /** Hash of the tile's bytes, to tell whether it changed since. */
  hash: string
  codec: TileCodec
  /** Where the backend keeps the tile. */
  ref: string
}

export interface ManifestLayer {
  info: LayerInfo
  tiles: TileEntry[]
}

/**
 * A saved document: its size, its layers bottom first, and where each of
 * their tiles is. Writing the manifest commits a save; until then, the
 * previous manifest and everything it refers to stay untouched.
 */
export interface DocumentManifest {
  projectId: string
  /** Counts the project's saves. */
  seq: number
  backend: TileBackendKind
  format: typeof TILE_FORMAT
  width: number
  height: number
  layers: ManifestLayer[]
  savedAt: Date
}

/**
 * A layer's properties as saved: only the known ones (not the panel's
 * thumbnail), with valid values whatever was stored.
 */
export function savedLayerInfo(info: LayerInfo): LayerInfo {
  const opacity = typeof info.opacity === 'number' && Number.isFinite(info.opacity) ? info.opacity : 1
  return {
    id: String(info.id),
    name: String(info.name),
    visible: info.visible !== false,
    opacity: Math.min(1, Math.max(0, opacity)),
    blendMode: ALL_BLEND_MODES.includes(info.blendMode) ? info.blendMode : 'normal',
    alphaLock: info.alphaLock === true,
    clippingMask: info.clippingMask === true,
    locked: info.locked === true,
  }
}

/** Copy the tile at column `x`, row `y` out of a straight-alpha layer, premultiplied and padded. */
export function cutTile(pixels: ArrayLike<number>, width: number, height: number, x: number, y: number): Uint8Array {
  const tile = new Uint8Array(TILE_BYTES)
  const left = x * TILE_SIZE
  const top = y * TILE_SIZE
  const w = Math.min(TILE_SIZE, width - left)
  const h = Math.min(TILE_SIZE, height - top)
  for (let row = 0; row < h; row++) {
    premultiplyInto(pixels, ((top + row) * width + left) * 4, tile, row * TILE_SIZE * 4, w)
  }
  return tile
}

/**
 * A tile from the straight-alpha pixels of its part of a layer, `width` ×
 * `height` (less than 256 at the right and bottom edges): premultiplied and padded.
 */
export function tileFromPixels(pixels: ArrayLike<number>, width: number, height: number): Uint8Array {
  const tile = new Uint8Array(TILE_BYTES)
  for (let row = 0; row < height; row++) premultiplyInto(pixels, row * width * 4, tile, row * TILE_SIZE * 4, width)
  return tile
}

/** Put a premultiplied tile back into a straight-alpha layer, dropping its padding. */
export function placeTile(tile: Uint8Array, pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number): void {
  const left = x * TILE_SIZE
  const top = y * TILE_SIZE
  const w = Math.min(TILE_SIZE, width - left)
  const h = Math.min(TILE_SIZE, height - top)
  for (let row = 0; row < h; row++) {
    unpremultiplyInto(tile, row * TILE_SIZE * 4, pixels, ((top + row) * width + left) * 4, w)
  }
}

/** Whether every pixel of a premultiplied tile is fully transparent. */
export function isEmptyTile(tile: Uint8Array): boolean {
  const words = new Uint32Array(tile.buffer, tile.byteOffset, tile.byteLength >>> 2)
  for (let i = 0; i < words.length; i++) if (words[i] !== 0) return false
  return true
}

/**
 * A hash of a tile's bytes. SHA-1 where the browser offers it (secure
 * contexts), otherwise two 32-bit MurmurHash3 lanes. The prefix names the
 * method, so a hash made the other way never counts as unchanged.
 */
export async function hashTile(tile: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const digest = new Uint8Array(await subtle.digest('SHA-1', tile as Uint8Array<ArrayBuffer>))
    return 's1:' + hex(digest.subarray(0, 16))
  }
  return 'm3:' + murmur64(tile)
}

function hex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

function murmur64(bytes: Uint8Array): string {
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >>> 2)
  return lane(words, 0x9747b28c).toString(16).padStart(8, '0') + lane(words, 0x2545f491).toString(16).padStart(8, '0')
}

/** MurmurHash3 x86_32 over 32-bit words. */
function lane(words: Uint32Array, seed: number): number {
  let h = seed
  for (let i = 0; i < words.length; i++) {
    let k = Math.imul(words[i], 0xcc9e2d51)
    k = (k << 15) | (k >>> 17)
    k = Math.imul(k, 0x1b873593)
    h ^= k
    h = (h << 13) | (h >>> 19)
    h = (Math.imul(h, 5) + 0xe6546b64) | 0
  }
  h ^= words.length * 4
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}
