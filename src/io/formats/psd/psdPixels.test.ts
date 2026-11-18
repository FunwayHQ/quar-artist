import { describe, it, expect } from 'vitest'
import { zlibSync } from 'fflate'
import { decodeChannel, decodeImagePlanes, rleFits } from './psdPixels.ts'
import { samples } from './testPsds.ts'

/** A channel's RLE data: each row's byte count, in 2 bytes, then the rows. */
function rle(rows: number[][]): Uint8Array {
  const out: number[] = []
  for (const row of rows) out.push(row.length >> 8, row.length & 0xff)
  for (const row of rows) out.push(...row)
  return new Uint8Array(out)
}

/** 32-bit samples as ZIP with prediction compresses them: each row's bytes in planes, as differences, then ZIP. */
function predicted32(values: number[], width: number): Uint8Array {
  const bytes = samples(values, 32)
  const out = new Uint8Array(bytes.length)
  for (let start = 0; start < bytes.length; start += width * 4) {
    const row = new Uint8Array(width * 4)
    for (let x = 0; x < width; x++) for (let b = 0; b < 4; b++) row[b * width + x] = bytes[start + x * 4 + b]
    for (let i = row.length - 1; i > 0; i--) row[i] -= row[i - 1]
    out.set(row, start)
  }
  return zlibSync(out)
}

const decode = (compression: number, data: Uint8Array, width: number, height: number, depth = 8, kind: 'colour' | 'alpha' = 'colour', large = false) =>
  Array.from(decodeChannel({ compression, data }, width, height, depth, large, kind))

describe('decodeChannel (plan M1.7)', () => {
  it('unpacks RLE rows of runs, literals and no-ops, each row on its own', () => {
    // A run of 3 sevens, then a literal 1, 2. Then a no-op, a literal 9 and a run of 4 fives.
    expect(decode(1, rle([[254, 7, 1, 1, 2], [128, 0, 9, 253, 5]]), 5, 2)).toEqual([7, 7, 7, 1, 2, 9, 5, 5, 5, 5])
  })

  it('pads an RLE row that unpacks short with zeros, and cuts one that unpacks long, as some apps write them', () => {
    expect(decode(1, rle([[1, 4, 5], [254, 6, 254, 8]]), 3, 2)).toEqual([4, 5, 0, 6, 6, 6])
  })

  it("reads PSB files' RLE byte counts, which take 4 bytes", () => {
    expect(decode(1, new Uint8Array([0, 0, 0, 2, 255, 3]), 2, 1, 8, 'colour', true)).toEqual([3, 3])
  })

  it('refuses RLE rows that claim more data than there is, which can be found before decoding', () => {
    const claims = rle([[254, 7]])
    claims[1] = 200
    expect(rleFits(claims, 1, false)).toBe(false)
    expect(rleFits(new Uint8Array(1), 1, false)).toBe(false)
    expect(rleFits(rle([[254, 7]]), 1, false)).toBe(true)
    expect(() => decode(1, claims, 3, 1)).toThrow()
  })

  it('takes raw samples as they are, with zeros for what a short channel lacks', () => {
    expect(decode(0, new Uint8Array([1, 2, 3]), 2, 2)).toEqual([1, 2, 3, 0])
  })

  it('unpacks ZIP data, refusing more than the channel holds', () => {
    expect(decode(2, zlibSync(new Uint8Array([1, 2, 3, 4])), 2, 2)).toEqual([1, 2, 3, 4])
    expect(() => decode(2, zlibSync(new Uint8Array(5)), 2, 2)).toThrow()
  })

  it('undoes ZIP prediction row by row: 8-bit differences wrap, 16-bit ones carry, 32-bit ones are between bytes in planes', () => {
    // Rows 250, 5, 6 and 7, 7, 9.
    expect(decode(3, zlibSync(new Uint8Array([250, 11, 1, 7, 0, 2])), 3, 2)).toEqual([250, 5, 6, 7, 7, 9])
    // 0x7fff, 0x8000 and 0x0080: 0x7fff + 1 carries into the high byte.
    expect(decode(3, zlibSync(samples([0x7fff, 0x0001, 0x8080], 16)), 3, 1, 16)).toEqual([127, 128, 0])
    expect(decode(3, predicted32([0.5, 0.25, 1, 0, 0.1, 0.5], 3), 3, 2, 32)).toEqual([188, 137, 255, 0, 89, 188])
  })

  it('brings 16-bit samples to 8 bits by scale, and 32-bit colour through the sRGB curve, but not 32-bit alpha', () => {
    expect(decode(0, samples([0, 0x8080, 0xffff, 0x00ff], 16), 4, 1, 16)).toEqual([0, 128, 255, 1])
    const floats = samples([0.5, 0.25, -1, 2, NaN], 32)
    expect(decode(0, floats, 5, 1, 32)).toEqual([188, 137, 0, 255, 0])
    expect(decode(0, floats, 5, 1, 32, 'alpha')).toEqual([128, 64, 0, 255, 0])
  })

  it("refuses compressions and depths the format doesn't have in layers", () => {
    expect(() => decode(4, new Uint8Array(4), 2, 2)).toThrow()
    expect(() => decode(0, new Uint8Array(4), 2, 2, 1)).toThrow()
  })
})

describe('decodeImagePlanes (plan M1.7)', () => {
  const size = { width: 2, height: 1, depth: 8, large: false, channels: 3 }

  it('reads the planes asked for from a raw composite', () => {
    const data = new Uint8Array([0, 0, 1, 2, 3, 4, 5, 6])
    const planes = decodeImagePlanes(data, size, [
      { index: 2, kind: 'colour' },
      { index: 0, kind: 'colour' },
    ])
    expect(planes.map((p) => Array.from(p))).toEqual([
      [5, 6],
      [1, 2],
    ])
  })

  it("reads the planes asked for from an RLE composite, whose byte counts come first, every plane's", () => {
    // Counts 2, 3 and 2; then a run of 2 ones, a literal 7, 8, and a run of 2 nines.
    const data = new Uint8Array([0, 1, 0, 2, 0, 3, 0, 2, 255, 1, 1, 7, 8, 255, 9])
    const planes = decodeImagePlanes(data, size, [
      { index: 1, kind: 'colour' },
      { index: 2, kind: 'colour' },
    ])
    expect(planes.map((p) => Array.from(p))).toEqual([
      [7, 8],
      [9, 9],
    ])
  })

  it("refuses RLE rows past the end of the file, and planes it doesn't have", () => {
    const one = { ...size, channels: 1 }
    expect(() => decodeImagePlanes(new Uint8Array([0, 1, 0, 200, 255, 1]), one, [{ index: 0, kind: 'colour' }])).toThrow()
    expect(() => decodeImagePlanes(new Uint8Array([0, 0, 1, 2]), one, [{ index: 1, kind: 'alpha' }])).toThrow()
  })
})
