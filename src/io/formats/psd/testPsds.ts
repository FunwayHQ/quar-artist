/**
 * PSD files for tests, made byte by byte: what ag-psd doesn't write (16-
 * and 32-bit files, ZIP-compressed channels, other colour modes) and what
 * no app should (sizes that don't add up).
 */
import { zlibSync } from 'fflate'

export interface RawChannel {
  /** -1 is transparency, 0–2 red, green and blue, -2 the user mask. */
  id: number
  /** 0 raw, 1 RLE, 2 ZIP, 3 ZIP with prediction. */
  compression?: number
  data: Uint8Array
}

export interface RawLayer {
  top: number
  left: number
  bottom: number
  right: number
  channels: RawChannel[]
  name?: string
  blendKey?: string
  opacity?: number
  /** The mask record: its rectangle and colour outside it. */
  mask?: { top: number; left: number; bottom: number; right: number; defaultColor: number }
}

export interface RawPsd {
  width: number
  height: number
  depth?: number
  colorMode?: number
  version?: 1 | 2
  /** Channels in the header, and in the merged image. */
  channels?: number
  layers?: RawLayer[]
  /** The merged image's channel data, planar, raw; zeros when not given. */
  merged?: Uint8Array
}

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
  bytes(data: Uint8Array) {
    for (const b of data) this.parts.push(b)
    return this
  }
  get length() {
    return this.parts.length
  }
  done(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.parts)
  }
}

/** A channel's samples, big-endian: 8-bit as they are, 16-bit as words, 32-bit as floats. */
export function samples(values: readonly number[], depth: 8 | 16 | 32): Uint8Array {
  const out = new Uint8Array(values.length * (depth / 8))
  const view = new DataView(out.buffer)
  values.forEach((v, i) => {
    if (depth === 8) view.setUint8(i, v)
    else if (depth === 16) view.setUint16(i * 2, v)
    else view.setFloat32(i * 4, v)
  })
  return out
}

/** A channel compressed as ZIP (zlib) data. */
export function zipChannel(id: number, raw: Uint8Array): RawChannel {
  return { id, compression: 2, data: zlibSync(raw) }
}

/** A PSD file of exactly the parts given. */
export function rawPsd({ width, height, depth = 8, colorMode = 3, version = 1, channels = 3, layers, merged }: RawPsd): Uint8Array<ArrayBuffer> {
  const out = new Bytes()
  out.text('8BPS').u16(version).u32(0).u16(0).u16(channels).u32(height).u32(width).u16(depth).u16(colorMode)
  out.u32(0) // colour mode data
  out.u32(0) // image resources
  if (!layers) {
    out.u32(0)
  } else {
    const info = new Bytes()
    info.u16(layers.length)
    for (const layer of layers) {
      info.i32(layer.top).i32(layer.left).i32(layer.bottom).i32(layer.right).u16(layer.channels.length)
      for (const c of layer.channels) info.u16(c.id & 0xffff).u32(c.data.length + 2)
      info.text('8BIM').text(layer.blendKey ?? 'norm').u8(Math.round((layer.opacity ?? 1) * 255)).u8(0).u8(0).u8(0)
      const extra = new Bytes()
      if (layer.mask) {
        const m = layer.mask
        extra.u32(20).i32(m.top).i32(m.left).i32(m.bottom).i32(m.right).u8(m.defaultColor).u8(0).u16(0)
      } else {
        extra.u32(0)
      }
      extra.u32(0) // blending ranges
      const name = layer.name ?? 'Layer'
      extra.u8(name.length).text(name)
      // The name, with its length byte, takes a multiple of 4 bytes: what comes before it does already.
      while (extra.length % 4 !== 0) extra.u8(0)
      const extraBytes = extra.done()
      info.u32(extraBytes.length).bytes(extraBytes)
    }
    for (const layer of layers) for (const c of layer.channels) info.u16(c.compression ?? 0).bytes(c.data)
    if (info.length % 2) info.u8(0)
    const infoBytes = info.done()
    out.u32(infoBytes.length + 8).u32(infoBytes.length).bytes(infoBytes).u32(0)
  }
  out.u16(0).bytes(merged ?? new Uint8Array(width * height * channels * Math.max(1, depth / 8)))
  return out.done()
}
