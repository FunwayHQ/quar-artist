/**
 * Archives for the .qart tests, built byte by byte so that they can say
 * anything: sizes, checksums, names and offsets that lie included. Only
 * tests import this.
 */
import { deflateSync } from 'fflate'
import { TILE_BYTES, cutTile } from '../../tiles/tileFormat.ts'
import { crc32 } from './zip.ts'

/** An entry as the archive will hold it. */
export interface RawEntry {
  name: string
  /** The bytes stored: compressed when `method` is 8. */
  data: Uint8Array
  /** 8 (DEFLATE) unless said. */
  method?: number
  crc?: number
  /** The size declared for it once inflated. */
  size?: number
  /** The compressed size declared, when not the data's. */
  compressedSize?: number
  /** General purpose flags: UTF-8 names unless said. */
  flags?: number
  /** Where the directory says it starts, when not where it is. */
  offset?: number
}

/** An entry of `content`, deflated or stored, declaring its real size and checksum unless `overrides` say otherwise. */
export function entry(name: string, content: Uint8Array, overrides: Partial<RawEntry> & { stored?: boolean } = {}): RawEntry {
  const { stored, ...rest } = overrides
  return {
    name,
    data: stored ? content : deflateSync(content),
    method: stored ? 0 : 8,
    crc: crc32(content),
    size: content.length,
    ...rest,
  }
}

export function text(value: string): Uint8Array<ArrayBuffer> {
  // A plain Uint8Array: TextEncoder's may come from another realm in tests.
  return new Uint8Array(new TextEncoder().encode(value))
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/**
 * A ZIP archive of `entries` exactly as given, with a central directory and
 * its end record, and before that a ZIP64 locator when `zip64Locator` says.
 */
export function rawZip(entries: readonly RawEntry[], { entryCount = entries.length, zip64Locator = false } = {}): Uint8Array<ArrayBuffer> {
  const names = entries.map((e) => text(e.name))
  const parts: Uint8Array[] = []
  const directory: Uint8Array[] = []
  let offset = 0
  entries.forEach((e, i) => {
    const name = names[i]
    const method = e.method ?? 8
    const flags = e.flags ?? 0x800
    const compressedSize = e.compressedSize ?? e.data.length
    const local = new Uint8Array(30 + name.length)
    const l = new DataView(local.buffer)
    l.setUint32(0, 0x04034b50, true)
    l.setUint16(4, 20, true)
    l.setUint16(6, flags, true)
    l.setUint16(8, method, true)
    l.setUint32(14, e.crc ?? 0, true)
    l.setUint32(18, compressedSize, true)
    l.setUint32(22, e.size ?? 0, true)
    l.setUint16(26, name.length, true)
    local.set(name, 30)

    const central = new Uint8Array(46 + name.length)
    const c = new DataView(central.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, flags, true)
    c.setUint16(10, method, true)
    c.setUint32(16, e.crc ?? 0, true)
    c.setUint32(20, compressedSize, true)
    c.setUint32(24, e.size ?? 0, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, e.offset ?? offset, true)
    central.set(name, 46)

    parts.push(local, e.data)
    directory.push(central)
    offset += local.length + e.data.length
  })
  const directorySize = directory.reduce((n, d) => n + d.length, 0)
  const end = new Uint8Array(22)
  const v = new DataView(end.buffer)
  v.setUint32(0, 0x06054b50, true)
  v.setUint16(8, entryCount, true)
  v.setUint16(10, entryCount, true)
  v.setUint32(12, directorySize, true)
  v.setUint32(16, offset, true)
  // A ZIP64 end of central directory locator: its signature, the disk, where the ZIP64 record is, and the disk count.
  const locator = new Uint8Array(zip64Locator ? 20 : 0)
  if (zip64Locator) {
    const z = new DataView(locator.buffer)
    z.setUint32(0, 0x07064b50, true)
    z.setUint32(16, 1, true)
  }
  return concat([...parts, ...directory, locator, end]) as Uint8Array<ArrayBuffer>
}

/** A version 1 manifest of a document, `layerIds` bottom first, as the writer would make it, with `overrides` on top. */
export function manifestOf(
  { width, height, layerIds }: { width: number; height: number; layerIds: readonly string[] },
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    format: 'qart',
    formatVersion: 1,
    app: { name: 'QUAR Artist', version: '0.0.0' },
    name: 'Test',
    canvas: { width, height, dpi: 144, colorSpace: 'srgb' },
    tiles: { size: 256, format: 'rgba8', alpha: 'premultiplied', codec: 'raw' },
    layers: layerIds.map((id) => ({
      type: 'layer',
      id,
      name: `Layer ${id}`,
      blendMode: 'normal',
      opacity: 1,
      visible: true,
      locked: false,
      alphaLock: false,
      clippingMask: false,
    })),
    activeLayerId: layerIds[layerIds.length - 1],
    guides: null,
    thumbnail: null,
    timelapse: null,
    ...overrides,
  }
}

/** A tile entry of a straight-alpha layer, as the writer stores it. */
export function tileEntry(layerId: string, pixels: Uint8Array, width: number, height: number, x: number, y: number, overrides: Partial<RawEntry> = {}) {
  return entry(`tiles/${layerId}/${x}_${y}.raw`, cutTile(pixels, width, height, x, y), overrides)
}

/** A tile entry whose bytes are all `value`. */
export function solidTile(layerId: string, x: number, y: number, value = 255, overrides: Partial<RawEntry> = {}) {
  return entry(`tiles/${layerId}/${x}_${y}.raw`, new Uint8Array(TILE_BYTES).fill(value), overrides)
}

/** A .qart archive: its manifest first, then `entries`. */
export function qartArchive(manifest: unknown, entries: readonly RawEntry[] = []): Uint8Array<ArrayBuffer> {
  return rawZip([entry('manifest.json', text(JSON.stringify(manifest))), ...entries])
}

/** Straight RGBA8 of a `width` × `height` layer, every pixel `rgba`. */
export function solidLayer(width: number, height: number, rgba: readonly number[]): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set(rgba, i)
  return pixels
}
