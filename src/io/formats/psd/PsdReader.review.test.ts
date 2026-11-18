/**
 * Review of plan M1.7's PSD reader: each test fails now and passes once the
 * bug it names is fixed.
 */
import { describe, it, expect, vi } from 'vitest'
import { zlibSync } from 'fflate'
import { decodePsd, type PsdLimits } from './PsdReader.ts'
import { writePsdUint8Array, type Psd } from './agPsd.ts'
import { rawPsd, samples, zipChannel, type RawChannel } from './testPsds.ts'
import { psdNotice } from '../../persistence/ProjectService.ts'

class Bytes {
  private readonly parts: number[] = []
  u8(v: number) {
    this.parts.push(v & 0xff)
    return this
  }
  u16(v: number) {
    return this.u8(v >> 8).u8(v)
  }
  u32(v: number) {
    return this.u16(v >>> 16).u16(v & 0xffff)
  }
  i32(v: number) {
    return this.u32(v >>> 0)
  }
  text(s: string) {
    for (const c of s) this.u8(c.charCodeAt(0))
    return this
  }
  bytes(data: ArrayLike<number>) {
    for (let i = 0; i < data.length; i++) this.parts.push(data[i])
    return this
  }
  get length() {
    return this.parts.length
  }
  done(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.parts)
  }
}

const APP_LIMITS: PsdLimits = { maxLayers: 20, maxSide: 8192, maxBytes: 20 * 8192 * 8192 * 4 }

function image(width: number, height: number, rgba: number[]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i)
  return { width, height, data }
}

function psdFile(psd: Psd): Blob {
  return new Blob([writePsdUint8Array(psd, { noBackground: true }) as Uint8Array<ArrayBuffer>])
}

/** A layer record without channels whose only extra data is a section divider: 1 opens a group, 3 ends one. */
function dividerRecord(out: Bytes, type: number) {
  out.i32(0).i32(0).i32(0).i32(0).u16(0)
  out.text('8BIM').text('norm').u8(255).u8(0).u8(0).u8(0)
  const extra = new Bytes()
  extra.u32(0).u32(0) // no mask, no blending ranges
  extra.u8(0).u8(0).u8(0).u8(0) // an empty name, padded to 4
  extra.text('8BIM').text('lsct').u32(4).u32(type)
  const bytes = extra.done()
  out.u32(bytes.length).bytes(bytes)
}

/** A 1 × 1 px PSD file of `depth` empty groups, each inside the one before. */
function nestedGroups(depth: number): Uint8Array<ArrayBuffer> {
  const info = new Bytes()
  info.u16(depth * 2)
  // Bottom first: the groups' ends, then their openings, as Photoshop writes them.
  for (let i = 0; i < depth; i++) dividerRecord(info, 3)
  for (let i = 0; i < depth; i++) dividerRecord(info, 1)
  if (info.length % 2) info.u8(0)
  const infoBytes = info.done()
  const out = new Bytes()
  out.text('8BPS').u16(1).u32(0).u16(0).u16(3).u32(1).u32(1).u16(8).u16(3)
  out.u32(0).u32(0)
  out.u32(infoBytes.length + 8).u32(infoBytes.length).bytes(infoBytes).u32(0)
  out.u16(0).bytes(new Uint8Array(3))
  return out.done()
}

/**
 * A PSB file without layers, `rows` px tall and 1 px wide, whose composite is
 * RLE data: the row byte counts are there, each `claim` bytes, the rows aren't.
 */
function psbClaimingRows(rows: number, claim: number): Uint8Array<ArrayBuffer> {
  const out = new Bytes()
  out.text('8BPS').u16(2).u32(0).u16(0).u16(3).u32(rows).u32(1).u16(8).u16(3)
  out.u32(0).u32(0)
  out.u32(0).u32(0) // layer and mask information: 8 bytes of length in a PSB file
  out.u16(1) // RLE
  for (let i = 0; i < rows * 3; i++) out.u32(claim) // PSB files count each row's bytes in 4 bytes
  return out.done()
}

/** A 16-bit channel as Photoshop compresses one: each row's words after its first as differences from the word before, then ZIP. */
function predictedChannel(id: number, words: readonly number[], width: number): RawChannel {
  const deltas = words.map((w, i) => (i % width === 0 ? w : (w - words[i - 1]) & 0xffff))
  return { id, compression: 3, data: zlibSync(samples(deltas, 16)) }
}

/** A channel of one row as RLE (PackBits) data: the row's byte count, then the row as one literal run. */
function rleChannel(id: number, row: Uint8Array): RawChannel {
  const data = new Uint8Array(3 + row.length)
  data[1] = row.length + 1
  data[2] = row.length - 1
  data.set(row, 3)
  return { id, compression: 1, data }
}

/** A 1 × 1 px RGB file without layers, at 16 bits, whose image is RLE data: one literal run a row. */
function flatRle16(red: number, green: number, blue: number): Uint8Array<ArrayBuffer> {
  const rows = [red, green, blue].map((v) => samples([v], 16))
  const out = new Bytes()
  out.text('8BPS').u16(1).u32(0).u16(0).u16(3).u32(1).u32(1).u16(16).u16(3)
  out.u32(0).u32(0).u32(0) // colour mode data, image resources, layer and mask information
  out.u16(1) // RLE
  for (const row of rows) out.u16(row.length + 1)
  for (const row of rows) out.u8(row.length - 1).bytes(row)
  return out.done()
}

/**
 * Pixels, with each value within one level of the one expected taken as it:
 * 16 bits come to 8 by rounding (v / 257) or by cutting (v >> 8), and either is right.
 */
function within1(actual: ArrayLike<number>, expected: readonly number[]): number[] {
  return Array.from(actual, (v, i) => (Math.abs(v - expected[i]) <= 1 ? expected[i] : v))
}

/** Time a call, in ms, whether it resolves or rejects. */
async function timed(run: () => Promise<unknown>): Promise<{ ms: number; outcome: unknown }> {
  const start = performance.now()
  const outcome = await run().then(
    () => 'opened',
    (err: Error) => err,
  )
  return { ms: performance.now() - start, outcome }
}

describe('decodePsd: 16-bit files (review of plan M1.7)', () => {
  // Red 0xFF00, green 0x1234, blue 0x00FF, alpha 0x8000 (50%): no value reads the same with its bytes swapped.
  const words: Record<number, number> = { [-1]: 0x8000, 0: 0xff00, 1: 0x1234, 2: 0x00ff }
  // Each 16-bit value scaled to 8 bits: Math.round(v / 257), as to8Bit does.
  const expected = [254, 18, 1, 128]

  it('reads 16-bit channels as the big-endian words they are, not with their bytes swapped (raw)', async () => {
    const file = rawPsd({
      width: 1,
      height: 1,
      depth: 16,
      layers: [{ top: 0, left: 0, bottom: 1, right: 1, channels: [-1, 0, 1, 2].map((id) => ({ id, data: samples([words[id]], 16) })) }],
    })
    // Now [1, 52, 254, 0]: the colour comes out as its low bytes, and a half-transparent pixel as transparent.
    expect(within1((await decodePsd(new Blob([file]))).layers[0].pixels, expected)).toEqual(expected)
  })

  it('reads 16-bit channels as the big-endian words they are, not with their bytes swapped (ZIP)', async () => {
    const file = rawPsd({
      width: 1,
      height: 1,
      depth: 16,
      layers: [{ top: 0, left: 0, bottom: 1, right: 1, channels: [-1, 0, 1, 2].map((id) => zipChannel(id, samples([words[id]], 16))) }],
    })
    expect(within1((await decodePsd(new Blob([file]))).layers[0].pixels, expected)).toEqual(expected)
  })

  it('reads 16-bit channels compressed as Photoshop compresses them, ZIP with prediction', async () => {
    // A row of 16 px, in gradients. ag-psd adds up the differences as little-endian words, so
    // besides the swapped bytes, carries go the wrong way: swapping each word afterwards isn't enough.
    const width = 16
    const ramp = (start: number, step: number) => Array.from({ length: width }, (_, k) => (start + k * step) & 0xffff)
    const rows: Record<number, number[]> = { [-1]: ramp(0xffff, 0), 0: ramp(0x0040, 0x1080), 1: ramp(0xfff0, -0x0f0f), 2: ramp(0x00ff, 0x0101) }
    const file = rawPsd({
      width,
      height: 1,
      depth: 16,
      layers: [{ top: 0, left: 0, bottom: 1, right: width, channels: [-1, 0, 1, 2].map((id) => predictedChannel(id, rows[id], width)) }],
    })
    const expectedRow = Array.from({ length: width }, (_, k) => [...[0, 1, 2].map((id) => Math.round(rows[id][k] / 257)), 255]).flat()
    expect(within1((await decodePsd(new Blob([file]))).layers[0].pixels, expectedRow)).toEqual(expectedRow)
  })

  it("reads a 16-bit file's composite as the big-endian words it is", async () => {
    const merged = samples([words[0], words[1], words[2]], 16)
    const doc = await decodePsd(new Blob([rawPsd({ width: 1, height: 1, depth: 16, merged })]))
    expect(within1(doc.layers[0].pixels, [254, 18, 1, 255])).toEqual([254, 18, 1, 255])
  })

  // ag-psd decodes RLE data at 1 and 8 bits only, and throws "Invalid bit depth (16)" otherwise
  // (psdReader.js readDataRLE): the reader then refuses the file as damaged. The format has RLE at
  // every depth, and it is what a flat file's image is usually in.
  it('opens a flat 16-bit file whose image is RLE data, rather than calling it damaged', async () => {
    const doc = await decodePsd(new Blob([flatRle16(words[0], words[1], words[2])]))
    expect(within1(doc.layers[0].pixels, [254, 18, 1, 255])).toEqual([254, 18, 1, 255])
  })

  it("opens a 16-bit file whose layers' channels are RLE data, rather than calling it damaged", async () => {
    const file = rawPsd({
      width: 1,
      height: 1,
      depth: 16,
      layers: [{ top: 0, left: 0, bottom: 1, right: 1, channels: [-1, 0, 1, 2].map((id) => rleChannel(id, samples([words[id]], 16))) }],
    })
    expect(within1((await decodePsd(new Blob([file]))).layers[0].pixels, expected)).toEqual(expected)
  })
})

describe('decodePsd: hostile files (review of plan M1.7)', () => {
  it('opens or refuses with a PsdError a file of deeply nested groups, never overflowing the stack', async () => {
    // 8,000 groups, one in another: a 1 MB file. Now a RangeError (Maximum call stack size exceeded) from flatten().
    const err = await decodePsd(new Blob([nestedGroups(8000)]), APP_LIMITS).then(
      () => null,
      (e: Error) => e,
    )
    if (err) expect(`${err.name}: ${err.message}`).toMatch(/^PsdError: /)
  }, 30_000)

  it('takes no longer than its size warrants over RLE rows that claim more bytes than the file has (PSB composite)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    // 140 bytes: 24 row counts of 100 MB each. Every row is read and walked byte by byte: now about 6 s,
    // and a file of 8192 rows (100 kB) takes over an hour, holding up every file the worker reads or writes after it.
    const file = psbClaimingRows(8, 100 * 1024 * 1024)
    expect(file.length).toBeLessThan(200)
    const { ms, outcome } = await timed(() => decodePsd(new Blob([file]), APP_LIMITS))
    if (outcome !== 'opened') expect((outcome as Error).name).toBe('PsdError')
    expect(ms).toBeLessThan(1000)
  }, 120_000)

  it("takes no longer than its size warrants over RLE rows that claim more bytes than a row holds (a layer's channel)", async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    // A layer 1 px wide and 30,000 px tall, one RLE channel whose rows each claim 65,535 bytes:
    // 60 kB of row counts, walked as 2 GB of rows. Now about 4 s per channel.
    const rows = 30_000
    const counts = new Bytes()
    for (let i = 0; i < rows; i++) counts.u16(0xffff)
    const file = rawPsd({ width: 1, height: 1, layers: [{ top: 0, left: 0, bottom: rows, right: 1, channels: [{ id: 0, compression: 1, data: counts.done() }] }] })
    const { ms, outcome } = await timed(() => decodePsd(new Blob([file]), APP_LIMITS))
    if (outcome !== 'opened') expect((outcome as Error).name).toBe('PsdError')
    expect(ms).toBeLessThan(1000)
  }, 120_000)
})

describe('decodePsd: what a file says (review of plan M1.7)', () => {
  it('reads the resolution in pixels per inch, which is how PSD files keep it, whatever unit Photoshop shows it in', async () => {
    // 300 ppi, shown in Photoshop as 118.11 px/cm: the file keeps 300 with the display unit PPCM
    // (Photoshop SDK, PIGeneral.h ResolutionInfo; GIMP and ImageMagick read and write it so).
    const file = psdFile({
      width: 1,
      height: 1,
      imageResources: {
        resolutionInfo: {
          horizontalResolution: 300,
          horizontalResolutionUnit: 'PPCM',
          widthUnit: 'Centimeters',
          verticalResolution: 300,
          verticalResolutionUnit: 'PPCM',
          heightUnit: 'Centimeters',
        },
      },
      children: [{ name: 'a', left: 0, top: 0, right: 1, bottom: 1, imageData: image(1, 1, [1, 2, 3, 255]) }],
    })
    // Now 762: 300 × 2.54.
    expect((await decodePsd(file)).dpi).toBe(300)
  })

  it("hides a group's layers where the group's mask hides them, or says the mask was left out", async () => {
    // The group's mask is black over the left pixel and white over the right one.
    const mask = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) }
    const file = psdFile({
      width: 2,
      height: 1,
      children: [
        {
          name: 'Masked group',
          opened: true,
          mask: { left: 0, top: 0, right: 2, bottom: 1, defaultColor: 255, imageData: mask },
          children: [{ name: 'inside', left: 0, top: 0, right: 2, bottom: 1, imageData: image(2, 1, [9, 9, 9, 255]) }],
        },
      ],
    })
    const doc = await decodePsd(file)
    const alphas = [doc.layers[0].pixels[3], doc.layers[0].pixels[7]]
    // Now [255, 255], and the toast says only that the group became plain layers: what the
    // group's mask hid shows, and nothing says so.
    if (alphas[0] !== 0 || alphas[1] !== 255) expect(psdNotice('art.psd', doc.notes)).toMatch(/mask/i)
  })

  it("says a group's layer effects were left out, as it does a layer's", async () => {
    const file = psdFile({
      width: 1,
      height: 1,
      children: [
        {
          name: 'Shadowed group',
          opened: true,
          effects: { dropShadow: [{ enabled: true, color: { r: 0, g: 0, b: 0 }, opacity: 0.5, blendMode: 'multiply' }] },
          children: [{ name: 'inside', left: 0, top: 0, right: 1, bottom: 1, imageData: image(1, 1, [9, 9, 9, 255]) }],
        },
      ],
    })
    // Now notes.effects is 0, and the toast says only that the group became plain layers.
    expect(psdNotice('art.psd', (await decodePsd(file)).notes)).toMatch(/effect/i)
  })
})
