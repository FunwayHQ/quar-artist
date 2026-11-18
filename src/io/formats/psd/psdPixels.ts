/**
 * PSD pixel data as the reader decodes it (plan M1.7): channels that are
 * raw, RLE (PackBits), ZIP or ZIP with prediction, at 8, 16 or 32 bits,
 * brought to 8 bits.
 *
 * ag-psd does this too, but reads 16-bit samples with their bytes swapped,
 * decodes RLE at 8 bits only, and sizes its work from the file's own numbers:
 * RLE rows that claim more bytes than the file has are walked byte by byte.
 * Here each buffer is the size of the channel's rectangle, which the reader
 * checked, and no number in the data makes the work larger than the data.
 *
 * Damaged data throws a plain Error: the reader refuses the file.
 */
import { Unzlib } from 'fflate'

export interface ChannelData {
  /** 0 raw, 1 RLE, 2 ZIP, 3 ZIP with prediction. */
  compression: number
  data: Uint8Array
}

/** Colour, which in 32-bit files is linear light, or alpha and masks, which aren't light at all. */
export type SampleKind = 'colour' | 'alpha'

/** Each RLE row's byte count takes 2 bytes, or 4 in PSB files. */
function countSize(large: boolean): number {
  return large ? 4 : 2
}

/** `rows` RLE byte counts, from `at` in `data`. */
function readCounts(data: Uint8Array, at: number, rows: number, large: boolean): Uint32Array {
  if (at + rows * countSize(large) > data.length) throw new Error('RLE byte counts past the end of the data')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const counts = new Uint32Array(rows)
  for (let y = 0; y < rows; y++) counts[y] = large ? view.getUint32(at + y * 4) : view.getUint16(at + y * 2)
  return counts
}

/** Whether an RLE channel's rows are all there: as many bytes as its counts say. Checked before anything is decoded. */
export function rleFits(data: Uint8Array, rows: number, large: boolean): boolean {
  const table = rows * countSize(large)
  if (table > data.length) return false
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let total = 0
  for (let y = 0; y < rows; y++) total += large ? view.getUint32(y * 4) : view.getUint16(y * 2)
  return total <= data.length - table
}

/**
 * Unpack PackBits rows from `data`, starting at `at`, each `counts[y]` bytes,
 * into rows of `rowBytes`. A row that unpacks to less is padded with zeros,
 * and one that unpacks to more is cut, as files from some apps have them.
 */
function unpackRows(data: Uint8Array, at: number, counts: ArrayLike<number>, rowBytes: number): Uint8Array {
  const out = new Uint8Array(counts.length * rowBytes)
  for (let y = 0; y < counts.length; y++) {
    const end = at + counts[y]
    if (end > data.length) throw new Error('RLE rows past the end of the data')
    let x = y * rowBytes
    const rowEnd = x + rowBytes
    while (at < end && x < rowEnd) {
      const header = data[at++]
      if (header > 128) {
        // A run: the next byte, 257 − header times.
        if (at >= end) break
        const stop = Math.min(rowEnd, x + 257 - header)
        out.fill(data[at++], x, stop)
        x = stop
      } else if (header < 128) {
        // A literal: the next header + 1 bytes.
        const n = Math.min(header + 1, end - at, rowEnd - x)
        out.set(data.subarray(at, at + n), x)
        at += header + 1
        x += n
      }
      // 128 does nothing.
    }
    at = end
  }
  return out
}

/** ZIP (zlib) data unpacked into `size` bytes. More than that is damage: a "zip bomb" stops within its first 16 KiB. */
function inflate(data: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size)
  let length = 0
  let over = false
  const stream = new Unzlib((chunk) => {
    if (over) return
    if (length + chunk.length > size) {
      over = true
      return
    }
    out.set(chunk, length)
    length += chunk.length
  })
  const STEP = 16 * 1024
  for (let at = 0; at < data.length && !over; at += STEP) stream.push(data.subarray(at, at + STEP), at + STEP >= data.length)
  if (over) throw new Error('ZIP data unpacks to more than its channel holds')
  return out
}

/**
 * Undo ZIP's prediction, in place: each row's samples after its first are
 * differences from the one before. 32-bit rows are differences between
 * bytes, with the rows' bytes in planes (every sample's first byte, then
 * every sample's second…), put back here in samples' order.
 */
function unpredict(bytes: Uint8Array, width: number, height: number, depth: number) {
  if (depth === 8) {
    for (let y = 0; y < height; y++) for (let i = y * width + 1, end = (y + 1) * width; i < end; i++) bytes[i] += bytes[i - 1]
    return
  }
  if (depth === 16) {
    for (let y = 0; y < height; y++) {
      let i = y * width * 2
      let previous = (bytes[i] << 8) | bytes[i + 1]
      for (let x = 1; x < width; x++) {
        i += 2
        const v = (previous + ((bytes[i] << 8) | bytes[i + 1])) & 0xffff
        bytes[i] = v >> 8
        bytes[i + 1] = v & 0xff
        previous = v
      }
    }
    return
  }
  const rowBytes = width * 4
  const row = new Uint8Array(rowBytes)
  for (let y = 0; y < height; y++) {
    const start = y * rowBytes
    for (let i = start + 1; i < start + rowBytes; i++) bytes[i] += bytes[i - 1]
    row.set(bytes.subarray(start, start + rowBytes))
    for (let x = 0; x < width; x++) {
      const i = start + x * 4
      bytes[i] = row[x]
      bytes[i + 1] = row[x + width]
      bytes[i + 2] = row[x + 2 * width]
      bytes[i + 3] = row[x + 3 * width]
    }
  }
}

const srgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

/** Big-endian samples at `depth` bits as 8-bit ones: 16-bit by scale, 32-bit colour through the sRGB curve, 32-bit alpha by scale. */
function to8Bits(bytes: Uint8Array, depth: number, kind: SampleKind): Uint8Array {
  if (depth === 8) return bytes
  const out = new Uint8Array(bytes.length / (depth / 8))
  if (depth === 16) {
    for (let i = 0; i < out.length; i++) out[i] = Math.round(((bytes[2 * i] << 8) | bytes[2 * i + 1]) / 257)
    return out
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < out.length; i++) {
    // NaN comes out as 0.
    const v = Math.min(1, Math.max(0, view.getFloat32(i * 4)))
    out[i] = Math.round((kind === 'colour' ? srgb(v) : v) * 255)
  }
  return out
}

function bytesPerSample(depth: number): number {
  if (depth !== 8 && depth !== 16 && depth !== 32) throw new Error(`${depth}-bit channels`)
  return depth / 8
}

/** Raw samples: as many as there are, then zeros. */
function rawSamples(data: Uint8Array, at: number, size: number): Uint8Array {
  if (at + size <= data.length) return data.subarray(at, at + size)
  const out = new Uint8Array(size)
  if (at < data.length) out.set(data.subarray(at))
  return out
}

/** A layer's or mask's channel, `width` × `height` samples at `depth` bits, as 8-bit samples. */
export function decodeChannel({ compression, data }: ChannelData, width: number, height: number, depth: number, large: boolean, kind: SampleKind): Uint8Array {
  const rowBytes = width * bytesPerSample(depth)
  let bytes: Uint8Array
  if (compression === 0) {
    bytes = rawSamples(data, 0, rowBytes * height)
  } else if (compression === 1) {
    bytes = unpackRows(data, height * countSize(large), readCounts(data, 0, height, large), rowBytes)
  } else if (compression === 2 || compression === 3) {
    bytes = inflate(data, rowBytes * height)
    if (compression === 3) unpredict(bytes, width, height, depth)
  } else {
    throw new Error(`compression ${compression}`)
  }
  return to8Bits(bytes, depth, kind)
}

/**
 * Planes of a file's composite image, from its image data section (`data`,
 * from the compression field on), which holds `channels` planes of `width` ×
 * `height`: the ones asked for, by index, as 8-bit samples. Raw or RLE: the
 * format has ZIP there too, but no app writes it.
 */
export function decodeImagePlanes(
  data: Uint8Array,
  { width, height, depth, large, channels }: { width: number; height: number; depth: number; large: boolean; channels: number },
  wanted: readonly { index: number; kind: SampleKind }[],
): Uint8Array[] {
  const rowBytes = width * bytesPerSample(depth)
  if (data.length < 2) throw new Error('no image data')
  if (wanted.some(({ index }) => index >= channels)) throw new Error('fewer channels than the colour mode has')
  const compression = (data[0] << 8) | data[1]
  if (compression === 0) return wanted.map(({ index, kind }) => to8Bits(rawSamples(data, 2 + index * rowBytes * height, rowBytes * height), depth, kind))
  if (compression !== 1) throw new Error(`composite compression ${compression}`)
  const counts = readCounts(data, 2, channels * height, large)
  // Each plane's rows follow the ones before it.
  const starts = [2 + channels * height * countSize(large)]
  for (let c = 0; c < channels; c++) {
    let total = 0
    for (let y = c * height; y < (c + 1) * height; y++) total += counts[y]
    starts.push(starts[c] + total)
  }
  if (starts[channels] > data.length) throw new Error('RLE rows past the end of the data')
  return wanted.map(({ index, kind }) => to8Bits(unpackRows(data, starts[index], counts.subarray(index * height, (index + 1) * height), rowBytes), depth, kind))
}
