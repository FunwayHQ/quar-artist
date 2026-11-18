/**
 * Review of plan M1.7's PSD reader: memory that ag-psd sizes from a file's
 * own numbers, before decodePsd checks anything. Fails now, passes once fixed.
 */
import { describe, it, expect, vi } from 'vitest'
import { decodePsd } from './PsdReader.ts'

/** For each readPsd call: the bytes ag-psd's result holds on to that aren't the file itself. */
const parses = vi.hoisted(() => ({ heldBytes: [] as number[] }))

// ag-psd as the reader has it, measuring what each parse holds.
vi.mock('./agPsd.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./agPsd.ts')>()
  function held(value: unknown, file: ArrayBufferLike, seen: WeakSet<object>): number {
    if (typeof value !== 'object' || value === null || seen.has(value)) return 0
    seen.add(value)
    if (ArrayBuffer.isView(value)) return value.buffer === file ? 0 : value.byteLength
    let total = 0
    for (const v of Object.values(value)) total += held(v, file, seen)
    return total
  }
  return {
    ...real,
    readPsd: ((buffer: ArrayBuffer, options?: Parameters<typeof real.readPsd>[1]) => {
      const psd = real.readPsd(buffer, options)
      parses.heldBytes.push(held(psd, buffer, new WeakSet()))
      return psd
    }) as typeof real.readPsd,
  }
})

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

const MiB = 1024 * 1024

/**
 * A PSD file of one 1 × 1 px layer and `entries` filter effect masks (the
 * document's 'FEid' block), each with a channel that claims `claim` bytes, past
 * the end of the file. ag-psd gives each such read a buffer of its own, of the
 * size claimed (up to 100 MB), copies what the file has left into it, and
 * keeps it; then goes back to the entry's end for the next one.
 */
function filterEffectsMasks(entries: number, claim: number): Uint8Array<ArrayBuffer> {
  const fx = new Bytes()
  fx.u32(1) // version
  for (let i = 0; i < entries; i++) {
    const entry = new Bytes()
    entry.u8(0) // id: an empty Pascal string
    entry.u32(1) // effect version
    entry.u32(0).u32(0) // effect length, in 64 bits
    entry.i32(0).i32(0).i32(1).i32(1) // rectangle
    entry.u32(8) // depth
    entry.i32(-1) // channels: the loop runs channels + 2 times, so once
    entry.u32(1).u32(0).u32(claim + 2).u16(0) // it exists; its length, in 64 bits; raw
    while (entry.length % 4) entry.u8(0)
    const e = entry.done()
    fx.u32(0).u32(e.length).bytes(e)
  }
  const fxBytes = fx.done()
  const info = new Bytes()
  info.u16(1)
  info.i32(0).i32(0).i32(1).i32(1).u16(1)
  info.u16(0).u32(3) // red, raw, one byte
  info.text('8BIM').text('norm').u8(255).u8(0).u8(0).u8(0)
  const extra = new Bytes()
  extra.u32(0).u32(0).u8(1).text('L').u8(0).u8(0)
  const extraBytes = extra.done()
  info.u32(extraBytes.length).bytes(extraBytes)
  info.u16(0).u8(200)
  if (info.length % 2) info.u8(0)
  const infoBytes = info.done()
  const section = new Bytes()
  section.u32(infoBytes.length).bytes(infoBytes)
  section.u32(0) // no global layer mask
  section.text('8BIM').text('FEid').u32(fxBytes.length).bytes(fxBytes)
  const sectionBytes = section.done()
  const out = new Bytes()
  out.text('8BPS').u16(1).u32(0).u16(0).u16(3).u32(1).u32(1).u16(8).u16(3)
  out.u32(0).u32(0)
  out.u32(sectionBytes.length).bytes(sectionBytes)
  out.u16(0).bytes(new Uint8Array(3))
  return out.done()
}

describe('decodePsd: memory sized by the file (review of plan M1.7)', () => {
  it("doesn't let a file of a few hundred bytes make the reader hold a gigabyte before any check", async () => {
    parses.heldBytes.length = 0
    // 10 entries of 100 MB each, in 665 bytes.
    const file = filterEffectsMasks(10, 100 * MiB)
    expect(file.length).toBeLessThan(1000)

    await decodePsd(new Blob([file]), { maxLayers: 20, maxSide: 8192, maxBytes: 20 * 8192 * 8192 * 4 }).catch(() => undefined)

    // Now 1000 MiB, and it grows by 100 MB per 60 bytes of file. Here the buffers stay untouched,
    // but each one gets a copy of the rest of the file: behind a 50 MB tail, 20 entries made
    // 1 GB resident (measured), and 100 would take 5 GB, more than a tab has.
    const held = Math.max(0, ...parses.heldBytes)
    expect(held / MiB).toBeLessThanOrEqual(64)
  })
})
