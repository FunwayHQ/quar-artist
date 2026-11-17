import { Inflate, deflateSync } from 'fflate'
import { QartError, damaged, notQart, tooLarge } from './manifest.ts'

/**
 * ZIP archives for .qart files (plan M1.6).
 *
 * Reading comes with the checks a file made to exhaust memory needs: entries
 * are found through the central directory, each must lie in its own bytes,
 * and none is inflated past the size it declares. Only what is asked for is
 * read, a few megabytes at a time, so the archive is never held whole.
 *
 * Writing compresses each entry whole with fflate's `deflateSync`. fflate's
 * streaming Deflate, which its streaming Zip uses, writes streams that can't
 * be inflated for some inputs (0.8.3: 41 of 300 sample tiles at level 6,
 * "invalid distance"), so it isn't used.
 */

/** An entry of a ZIP archive, as its central directory describes it. */
export interface ZipEntry {
  name: string
  /** 0 for stored, 8 for DEFLATE. */
  method: number
  crc: number
  compressedSize: number
  /** Its size once inflated, as the archive declares it. */
  size: number
  /** Where its local header starts. */
  offset: number
  /** Where the next entry, or the central directory, starts: the entry's bytes end before. */
  end: number
}

/** Random access to an archive's bytes. */
export interface ZipSource {
  size: number
  read(start: number, end: number): Promise<Uint8Array>
}

export function blobSource(blob: Blob): ZipSource {
  return { size: blob.size, read: async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer()) }
}

const END_OF_DIRECTORY = 0x06054b50
const DIRECTORY_ENTRY = 0x02014b50
const LOCAL_HEADER = 0x04034b50
const END_SIZE = 22
const DIRECTORY_ENTRY_SIZE = 46
const LOCAL_HEADER_SIZE = 30
/** A local header's name and extra field are at most this long each, and a data descriptor at most 24 bytes. */
const MAX_FIELD = 0xffff
const ZIP64_LOCATOR = 0x07064b50
const ZIP64_LOCATOR_SIZE = 20
const MAX_DESCRIPTOR = 24

/** A larger central directory is refused: version 1's largest files have about 20,000 entries of 100 bytes. */
export const MAX_DIRECTORY_BYTES = 16 << 20
/** Entries are read up to this many bytes at once. */
const READ_CHUNK = 8 << 20
/** Compressed bytes inflated at a time: an entry made to inflate far past its size is caught within this many, times 1,032. */
const INFLATE_CHUNK = 16 << 10

/** An entry that inflates past the size it declares: made to exhaust memory, so the whole file is refused. */
export class OversizedEntryError extends QartError {}

function u16(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8)
}

function u32(b: Uint8Array, i: number): number {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
}

const utf8 = new TextDecoder('utf-8')

/** Names without the UTF-8 flag, byte for byte. Version 1's names are ASCII. */
function bytesToText(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i])
  return text
}

/**
 * The archive's entries, from its central directory. Refuses archives that
 * aren't ZIP files, need ZIP64, span several disks, are encrypted, or have
 * two entries with one name or entries that overlap.
 */
export async function readZipDirectory(source: ZipSource): Promise<ZipEntry[]> {
  if (source.size < END_SIZE) throw notQart()
  // The end record, its comment at its longest, and room for a ZIP64 locator before it.
  const tailStart = Math.max(0, source.size - END_SIZE - MAX_FIELD - ZIP64_LOCATOR_SIZE)
  const tail = await source.read(tailStart, source.size)
  let at = -1
  for (let i = tail.length - END_SIZE; i >= 0; i--) {
    if (u32(tail, i) === END_OF_DIRECTORY && i + END_SIZE + u16(tail, i + 20) <= tail.length) {
      at = i
      break
    }
  }
  if (at < 0) throw notQart()

  const count = u16(tail, at + 10)
  const directorySize = u32(tail, at + 12)
  const directoryOffset = u32(tail, at + 16)
  // ZIP64 archives have a locator just before the end record. Only archives past 4 GiB or 65,535 entries need
  // it, larger than any version 1 file. An entry count of 65,535 without one is just that.
  const zip64 = at >= ZIP64_LOCATOR_SIZE && u32(tail, at - ZIP64_LOCATOR_SIZE) === ZIP64_LOCATOR
  if (zip64 || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw tooLarge()
  if (u16(tail, at + 4) !== 0 || u16(tail, at + 6) !== 0 || u16(tail, at + 8) !== count) {
    throw damaged('it is split across several files')
  }
  if (directoryOffset + directorySize > tailStart + at) throw damaged('its table of contents is out of place')
  if (directorySize > MAX_DIRECTORY_BYTES) throw damaged('its table of contents is too large')
  const directory = await source.read(directoryOffset, directoryOffset + directorySize)
  if (directory.length !== directorySize) throw damaged('it is cut short')

  const entries: ZipEntry[] = []
  const names = new Set<string>()
  let p = 0
  for (let n = 0; n < count; n++) {
    if (p + DIRECTORY_ENTRY_SIZE > directory.length || u32(directory, p) !== DIRECTORY_ENTRY) {
      throw damaged('its table of contents is cut short')
    }
    const flags = u16(directory, p + 8)
    const nameLength = u16(directory, p + 28)
    const next = p + DIRECTORY_ENTRY_SIZE + nameLength + u16(directory, p + 30) + u16(directory, p + 32)
    if (next > directory.length) throw damaged('its table of contents is cut short')
    const nameBytes = directory.subarray(p + DIRECTORY_ENTRY_SIZE, p + DIRECTORY_ENTRY_SIZE + nameLength)
    const name = flags & 0x800 ? utf8.decode(nameBytes) : bytesToText(nameBytes)
    const entry: ZipEntry = {
      name,
      method: u16(directory, p + 10),
      crc: u32(directory, p + 16),
      compressedSize: u32(directory, p + 20),
      size: u32(directory, p + 24),
      offset: u32(directory, p + 42),
      end: directoryOffset,
    }
    if (entry.compressedSize === 0xffffffff || entry.size === 0xffffffff || entry.offset === 0xffffffff) throw tooLarge()
    if (u16(directory, p + 34) !== 0) throw damaged('it is split across several files')
    // Bit 0: encrypted. Bit 6: strong encryption.
    if (flags & 0x41) throw new QartError("it is encrypted, and QUAR Artist can't open encrypted files")
    if (names.has(name)) throw damaged(`two entries are named “${name}”`)
    if (entry.offset >= directoryOffset) throw damaged(`“${name}” is out of place`)
    names.add(name)
    entries.push(entry)
    p = next
  }

  // Each entry's bytes end where the next one's begin.
  const byOffset = [...entries].sort((a, b) => a.offset - b.offset)
  for (let i = 0; i + 1 < byOffset.length; i++) {
    if (byOffset[i + 1].offset === byOffset[i].offset) {
      throw damaged(`“${byOffset[i].name}” and “${byOffset[i + 1].name}” overlap`)
    }
    byOffset[i].end = byOffset[i + 1].offset
  }
  return entries
}

/** The furthest byte an entry can reach: its local header at its longest, its data and a descriptor, within its own bytes. */
function extent(entry: ZipEntry): number {
  return Math.min(entry.end, entry.offset + LOCAL_HEADER_SIZE + 2 * MAX_FIELD + entry.compressedSize + MAX_DESCRIPTOR)
}

/** Where an entry's compressed bytes are in `chunk`, read from `chunkStart`: after its local header, within its own bytes. */
function dataRange(chunk: Uint8Array, chunkStart: number, entry: ZipEntry): [number, number] {
  const p = entry.offset - chunkStart
  if (p < 0 || p + LOCAL_HEADER_SIZE > chunk.length || u32(chunk, p) !== LOCAL_HEADER) throw damaged(`“${entry.name}” is out of place`)
  if (u16(chunk, p + 8) !== entry.method) throw damaged(`“${entry.name}” doesn't match its table of contents`)
  const start = p + LOCAL_HEADER_SIZE + u16(chunk, p + 26) + u16(chunk, p + 28)
  const end = start + entry.compressedSize
  if (chunkStart + end > entry.end || end > chunk.length) throw damaged(`“${entry.name}” runs into the next entry`)
  return [start, end]
}

/**
 * The most compressed data an entry of `size` bytes may have. No encoder
 * makes more (DEFLATE adds 5 bytes per stored block of up to 64 KiB), so
 * a reader never reads much more than an entry gives it.
 */
export function maxCompressedSize(size: number): number {
  return size + Math.ceil(size / 8) + 1024
}

/**
 * Read entries' compressed bytes in the order the archive stores them, a few
 * megabytes at a time, and hand each to `take`. `take` may not keep the
 * bytes: they are part of a larger read. Refuses, before reading any, an
 * entry with more compressed data than its size can need.
 */
export async function readEntries(
  source: ZipSource,
  entries: readonly ZipEntry[],
  take: (entry: ZipEntry, compressed: Uint8Array) => void,
): Promise<void> {
  for (const entry of entries) {
    if (entry.compressedSize > maxCompressedSize(entry.size)) throw damaged(`“${entry.name}” is larger than it can be`)
  }
  const sorted = [...entries].sort((a, b) => a.offset - b.offset)
  for (let i = 0; i < sorted.length; ) {
    const start = sorted[i].offset
    let end = extent(sorted[i])
    let j = i + 1
    // Entries stored one after another are read together.
    while (j < sorted.length && sorted[j].offset <= end && extent(sorted[j]) - start <= READ_CHUNK) {
      end = Math.max(end, extent(sorted[j]))
      j++
    }
    const chunk = await source.read(start, end)
    if (chunk.length !== end - start) throw damaged('it is cut short')
    for (let k = i; k < j; k++) {
      const [from, to] = dataRange(chunk, start, sorted[k])
      take(sorted[k], chunk.subarray(from, to))
    }
    i = j
  }
}

/**
 * Inflate an entry to the size it declares, which must be at most `limit`,
 * and check it against its checksum. Throws an OversizedEntryError for an
 * entry that inflates past its size, at most a few megabytes on; a QartError
 * for one that can't be inflated, is short, or doesn't match its checksum.
 */
export function inflateEntry(entry: ZipEntry, compressed: Uint8Array, limit: number): Uint8Array {
  if (entry.size > limit) throw new OversizedEntryError(`it is damaged (“${entry.name}” is larger than it can be)`)
  let data: Uint8Array
  if (entry.method === 0) {
    if (compressed.length !== entry.size) throw damaged(`“${entry.name}” has the wrong size`)
    data = compressed.slice()
  } else if (entry.method === 8) {
    data = inflateBounded(compressed, entry)
  } else {
    throw damaged(`“${entry.name}” is compressed in a way QUAR Artist can't read`)
  }
  if (crc32(data) !== entry.crc) throw damaged(`“${entry.name}” doesn't match its checksum`)
  return data
}

function inflateBounded(compressed: Uint8Array, entry: ZipEntry): Uint8Array {
  const out = new Uint8Array(entry.size)
  let length = 0
  let over = false
  const inflater = new Inflate((chunk) => {
    if (over) return
    if (length + chunk.length > out.length) {
      over = true
      return
    }
    out.set(chunk, length)
    length += chunk.length
  })
  try {
    for (let i = 0; i < compressed.length && !over; i += INFLATE_CHUNK) {
      const end = Math.min(compressed.length, i + INFLATE_CHUNK)
      inflater.push(compressed.subarray(i, end), end === compressed.length)
    }
  } catch {
    if (!over) throw damaged(`“${entry.name}” can't be unpacked`)
  }
  if (over) throw new OversizedEntryError(`it is damaged (“${entry.name}” unpacks to more than it says)`)
  if (length !== entry.size) throw damaged(`“${entry.name}” has the wrong size`)
  return out
}

let crcTable: Int32Array | null = null

/** The CRC-32 a ZIP archive keeps of each entry. */
export function crc32(data: Uint8Array): number {
  const table = (crcTable ??= makeCrcTable())
  let c = -1
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function makeCrcTable(): Int32Array {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
}

/** The ZIP format without ZIP64, which no version 1 file needs: archives end before 4 GiB, with at most 65,535 entries. */
const MAX_ZIP_BYTES = 0xffffffff
const MAX_ZIP_ENTRIES = 0xffff
const ZIP_VERSION = 20
const UTF8_NAMES = 0x800

/** A time as ZIP archives keep it: MS-DOS time and date, local time. */
function dosTime(date: Date): { time: number; day: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()))
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/**
 * Writes a ZIP archive as a list of parts, entry by entry, so no buffer the
 * size of the archive is ever needed. Each entry is written whole, its
 * sizes and checksum in its local header.
 */
export class ZipWriter {
  private readonly parts: Uint8Array[] = []
  private readonly directory: Uint8Array[] = []
  private offset = 0
  private readonly when = dosTime(new Date())
  private readonly level: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

  constructor({ level = 6 }: { level?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 } = {}) {
    this.level = level
  }

  /**
   * Add an entry, compressed with DEFLATE unless `compress` is false, or
   * when compressing would make it larger. Throws a QartError when the
   * archive would need ZIP64.
   */
  add(name: string, data: Uint8Array, compress = true): void {
    const nameBytes = new TextEncoder().encode(name)
    const deflated = compress ? deflateSync(data, { level: this.level }) : null
    const method = deflated && deflated.length < data.length ? 8 : 0
    const body = method === 8 ? deflated! : data
    const crc = crc32(data)
    if (this.directory.length >= MAX_ZIP_ENTRIES || this.offset + LOCAL_HEADER_SIZE + nameBytes.length + body.length > MAX_ZIP_BYTES) {
      throw new QartError('the canvas is too large for a .qart file')
    }

    const local = new Uint8Array(LOCAL_HEADER_SIZE + nameBytes.length)
    const l = new DataView(local.buffer)
    l.setUint32(0, LOCAL_HEADER, true)
    l.setUint16(4, ZIP_VERSION, true)
    l.setUint16(6, UTF8_NAMES, true)
    l.setUint16(8, method, true)
    l.setUint16(10, this.when.time, true)
    l.setUint16(12, this.when.day, true)
    l.setUint32(14, crc, true)
    l.setUint32(18, body.length, true)
    l.setUint32(22, data.length, true)
    l.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, LOCAL_HEADER_SIZE)

    const central = new Uint8Array(DIRECTORY_ENTRY_SIZE + nameBytes.length)
    const c = new DataView(central.buffer)
    c.setUint32(0, DIRECTORY_ENTRY, true)
    c.setUint16(4, ZIP_VERSION, true)
    c.setUint16(6, ZIP_VERSION, true)
    c.setUint16(8, UTF8_NAMES, true)
    c.setUint16(10, method, true)
    c.setUint16(12, this.when.time, true)
    c.setUint16(14, this.when.day, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, body.length, true)
    c.setUint32(24, data.length, true)
    c.setUint16(28, nameBytes.length, true)
    c.setUint32(42, this.offset, true)
    central.set(nameBytes, DIRECTORY_ENTRY_SIZE)

    this.parts.push(local, body)
    this.directory.push(central)
    this.offset += local.length + body.length
  }

  /** The archive: its entries, then its central directory and the record that ends it. */
  finish(type: string): Blob {
    const directorySize = this.directory.reduce((n, d) => n + d.length, 0)
    if (this.offset + directorySize + END_SIZE > MAX_ZIP_BYTES) throw new QartError('the canvas is too large for a .qart file')
    const end = new Uint8Array(END_SIZE)
    const e = new DataView(end.buffer)
    e.setUint32(0, END_OF_DIRECTORY, true)
    e.setUint16(8, this.directory.length, true)
    e.setUint16(10, this.directory.length, true)
    e.setUint32(12, directorySize, true)
    e.setUint32(16, this.offset, true)
    return new Blob([...this.parts, ...this.directory, end] as BlobPart[], { type })
  }
}
