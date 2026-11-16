/**
 * Exact PNG decoding for tests. Browsers decode PNGs into premultiplied 2D
 * canvases, which rounds semi-transparent colours; this reads the bytes the
 * file actually holds.
 */
import { inflateSync } from 'node:zlib'
import { Pixels } from './pixels.ts'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const RGB = 2
const RGBA = 6

/**
 * Decode an 8-bit RGB or RGBA, non-interlaced PNG, the kind browsers write
 * for `canvas.toBlob`. Colour chunks (gAMA, sRGB, iCCP) are ignored, and fully
 * transparent pixels come back as 0, 0, 0, 0, like the harness readbacks.
 */
export function decodePng(file: Buffer): Pixels {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file')

  let width = 0
  let height = 0
  let colorType = -1
  const compressed: Buffer[] = []
  for (let pos = 8; pos + 8 <= file.length; ) {
    const length = file.readUInt32BE(pos)
    const type = file.toString('latin1', pos + 4, pos + 8)
    const body = file.subarray(pos + 8, pos + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const [bitDepth, ct, , , interlace] = body.subarray(8, 13)
      if (bitDepth !== 8 || (ct !== RGB && ct !== RGBA) || interlace !== 0) {
        throw new Error(`unsupported PNG: bit depth ${bitDepth}, colour type ${ct}, interlace ${interlace}`)
      }
      colorType = ct
    } else if (type === 'IDAT') {
      compressed.push(body)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + length // length, type, body, CRC
  }
  if (colorType < 0) throw new Error('PNG has no IHDR chunk')

  const channels = colorType === RGBA ? 4 : 3
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(compressed))
  if (raw.length !== height * (stride + 1)) throw new Error(`PNG data is ${raw.length} bytes, expected ${height * (stride + 1)}`)

  const data = new Uint8Array(width * height * 4)
  let previous = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1)
    const filter = raw[start]
    const row = new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? row[i - channels] : 0
      const up = previous[i]
      const upLeft = i >= channels ? previous[i - channels] : 0
      row[i] = raw[start + 1 + i] + predict(filter, left, up, upLeft, y)
    }
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4
      const alpha = channels === 4 ? row[x * 4 + 3] : 255
      if (alpha === 0) continue // stays 0, 0, 0, 0
      data[out] = row[x * channels]
      data[out + 1] = row[x * channels + 1]
      data[out + 2] = row[x * channels + 2]
      data[out + 3] = alpha
    }
    previous = row
  }
  return new Pixels(width, height, data)
}

/** The value a PNG row filter adds back (PNG spec, section 9). */
function predict(filter: number, left: number, up: number, upLeft: number, y: number): number {
  switch (filter) {
    case 0:
      return 0
    case 1:
      return left
    case 2:
      return up
    case 3:
      return (left + up) >> 1
    case 4: {
      const p = left + up - upLeft
      const toLeft = Math.abs(p - left)
      const toUp = Math.abs(p - up)
      const toUpLeft = Math.abs(p - upLeft)
      if (toLeft <= toUp && toLeft <= toUpLeft) return left
      return toUp <= toUpLeft ? up : upLeft
    }
    default:
      throw new Error(`unknown PNG filter ${filter} on row ${y}`)
  }
}
