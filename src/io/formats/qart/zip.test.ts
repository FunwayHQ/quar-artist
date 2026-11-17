import { describe, it, expect, vi } from 'vitest'
import { Zip, ZipDeflate, deflateSync, unzipSync, zipSync } from 'fflate'
import { OversizedEntryError, ZipWriter, blobSource, crc32, inflateEntry, readEntries, readZipDirectory, type ZipEntry, type ZipSource } from './zip.ts'
import { entry, rawZip, text } from './testArchives.ts'
import { sameBytes } from '../../../test/bytes.ts'

const source = (bytes: Uint8Array) => blobSource(new Blob([bytes as Uint8Array<ArrayBuffer>]))

/** A source that counts what is read from it. */
function counted(bytes: Uint8Array): ZipSource & { reads: [number, number][] } {
  const inner = source(bytes)
  const reads: [number, number][] = []
  return { size: inner.size, reads, read: (start, end) => (reads.push([start, end]), inner.read(start, end)) }
}

/** Every entry of an archive, inflated. */
async function contents(bytes: Uint8Array): Promise<Record<string, string>> {
  const src = source(bytes)
  const entries = await readZipDirectory(src)
  const out: Record<string, string> = {}
  await readEntries(src, entries, (e, compressed) => {
    out[e.name] = new TextDecoder().decode(inflateEntry(e, compressed, 1 << 20))
  })
  return out
}

async function refusal(bytes: Uint8Array): Promise<string> {
  try {
    await contents(bytes)
  } catch (err) {
    expect((err as Error).name).toBe('QartError')
    return (err as Error).message
  }
  throw new Error('the archive was read')
}

/** An entry as the directory gives it, for `inflateEntry`. */
function described(content: Uint8Array, overrides: Partial<ZipEntry> = {}): ZipEntry {
  return { name: 'x.raw', method: 8, crc: crc32(content), compressedSize: 0, size: content.length, offset: 0, end: 0, ...overrides }
}

describe('crc32', () => {
  it('is the CRC-32 ZIP archives keep', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array(0))).toBe(0)
    expect(crc32(new Uint8Array(1000).fill(255))).toBe(crc32(new Uint8Array(1000).fill(255)))
  })
})

describe('readZipDirectory and readEntries', () => {
  it('reads archives other programs write, stored and compressed', async () => {
    const bytes = zipSync({ 'a.txt': text('alpha'), 'b/c.txt': [text('gamma gamma gamma'), { level: 9 }], 'd.txt': [text('delta'), { level: 0 }] })
    expect(await contents(bytes)).toEqual({ 'a.txt': 'alpha', 'b/c.txt': 'gamma gamma gamma', 'd.txt': 'delta' })
  })

  it('reads streamed archives, whose sizes follow each entry', async () => {
    const parts: Uint8Array[] = []
    const zip = new Zip((err, chunk) => {
      if (err) throw err
      parts.push(chunk)
    })
    for (const [name, value] of [['one', 'first'], ['two', 'second']]) {
      const file = new ZipDeflate(name)
      zip.add(file)
      file.push(text(value), true)
    }
    zip.end()
    const bytes = new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer())
    expect(await contents(bytes)).toEqual({ one: 'first', two: 'second' })
  })

  it('reads only the entries asked for, those next to each other in one read', async () => {
    const big = new Uint8Array(3 << 20).map((_, i) => (i * 7919) % 251)
    const bytes = rawZip([entry('a', text('A')), entry('b', text('B')), entry('skipped', big, { stored: true }), entry('c', text('C'))])
    const src = counted(bytes)
    const entries = await readZipDirectory(src)
    src.reads.length = 0
    const got: string[] = []
    await readEntries(src, entries.filter((e) => e.name !== 'skipped'), (e, compressed) => {
      got.push(new TextDecoder().decode(inflateEntry(e, compressed, 10)))
    })
    expect(got).toEqual(['A', 'B', 'C'])
    expect(src.reads).toHaveLength(2)
    expect(src.reads.reduce((n, [a, b]) => n + b - a, 0)).toBeLessThan(1000)
  })

  it("refuses what isn't a ZIP archive", async () => {
    expect(await refusal(text('just some text, and more than twenty-two bytes of it'))).toBe("it isn't a .qart file")
    expect(await refusal(new Uint8Array(4))).toBe("it isn't a .qart file")
  })

  it('refuses two entries with the same name', async () => {
    expect(await refusal(rawZip([entry('a', text('1')), entry('a', text('2'))]))).toBe('it is damaged (two entries are named “a”)')
  })

  it('refuses entries that overlap, or run into the next', async () => {
    expect(await refusal(rawZip([entry('a', text('one')), entry('b', text('two'), { offset: 0 })]))).toBe(
      'it is damaged (“a” and “b” overlap)',
    )
    const runsOn = rawZip([entry('a', text('one'), { compressedSize: 500 }), entry('b', text('two'))])
    expect(await refusal(runsOn)).toBe('it is damaged (“a” runs into the next entry)')
  })

  it('refuses an entry the directory places past it, or not at a local header', async () => {
    expect(await refusal(rawZip([entry('a', text('one'), { offset: 10_000 })]))).toBe('it is damaged (“a” is out of place)')
    expect(await refusal(rawZip([entry('a', text('one'), { offset: 3 })]))).toBe('it is damaged (“a” is out of place)')
  })

  it('refuses archives that need ZIP64, are encrypted, or whose directory is cut short', async () => {
    expect(await refusal(rawZip([entry('a', text('one'), { size: 0xffffffff })]))).toBe('it is too large to open on this device')
    expect(await refusal(rawZip([entry('a', text('one'))], { zip64Locator: true }))).toBe('it is too large to open on this device')
    expect(await refusal(rawZip([entry('a', text('one'), { flags: 0x801 })]))).toBe(
      "it is encrypted, and QUAR Artist can't open encrypted files",
    )
    expect(await refusal(rawZip([entry('a', text('one'))], { entryCount: 2 }))).toBe('it is damaged (its table of contents is cut short)')
  })
})

describe('readZipDirectory, at the most entries a ZIP archive holds without ZIP64', () => {
  it('reads all 65,535 (review of M1.6)', async () => {
    const entries = Array.from({ length: 0xffff }, (_, i) => entry(`e/${i}`, new Uint8Array(0), { stored: true }))
    const read = await readZipDirectory(source(rawZip(entries)))
    expect(read).toHaveLength(0xffff)
    expect(read.at(-1)!.name).toBe('e/65534')
  }, 60_000)
})

describe('inflateEntry', () => {
  it('gives the entry back, stored or deflated', () => {
    const content = text('hello hello hello')
    expect(inflateEntry(described(content, { method: 0 }), content, 100)).toEqual(content)
    expect(inflateEntry(described(content), deflateSync(content), 100)).toEqual(content)
  })

  it('stops an entry that unpacks to more than it says at its first 16 KiB, and refuses it', () => {
    /** Compressed bytes that count the pieces taken from them. */
    class Counted extends Uint8Array {
      static pieces = 0
      override subarray(start?: number, end?: number) {
        Counted.pieces++
        return super.subarray(start, end)
      }
    }
    // 64 MiB of zeros in 64 KiB: the bomb a reader that trusts sizes would unpack whole.
    const bomb = deflateSync(new Uint8Array(64 << 20))
    expect(bomb.length).toBeGreaterThan(48 << 10)
    expect(() => inflateEntry(described(new Uint8Array(1000), { crc: 0 }), new Counted(bomb), 1 << 20)).toThrow(OversizedEntryError)
    // Reading it all takes three pieces of 16 KiB or more, and fflate takes one of each piece pushed: this took one.
    expect(Counted.pieces).toBeLessThanOrEqual(2)
    // Making a 64 MiB bomb takes a while on a busy machine.
  }, 30_000)

  it('refuses an entry that says it is larger than it may be, before unpacking it', () => {
    expect(() => inflateEntry(described(new Uint8Array(2000)), deflateSync(new Uint8Array(2000)), 1000)).toThrow(
      'it is damaged (“x.raw” is larger than it can be)',
    )
  })

  it('refuses what is short, damaged, unknown or not as its checksum says', () => {
    const content = new Uint8Array(1000).map((_, i) => i % 256)
    expect(() => inflateEntry(described(content, { size: 2000 }), deflateSync(content), 4000)).toThrow('it is damaged (“x.raw” has the wrong size)')
    expect(() => inflateEntry(described(content), deflateSync(content).subarray(0, 50), 4000)).toThrow(
      'it is damaged (“x.raw” can\'t be unpacked)',
    )
    expect(() => inflateEntry(described(content, { crc: 1 }), deflateSync(content), 4000)).toThrow(
      'it is damaged (“x.raw” doesn\'t match its checksum)',
    )
    expect(() => inflateEntry(described(content, { method: 12 }), content, 4000)).toThrow(
      'it is damaged (“x.raw” is compressed in a way QUAR Artist can\'t read)',
    )
    expect(() => inflateEntry(described(content, { method: 0 }), content.subarray(1), 4000)).toThrow('it is damaged (“x.raw” has the wrong size)')
  })
})

describe('readEntries, against entries larger than their size can need', () => {
  it('refuses one before reading anything', async () => {
    // Valid DEFLATE, but padded: empty stored blocks, then the data. 1 MiB of it for 4 bytes.
    const padding = new Uint8Array(5 * 210_000)
    for (let i = 0; i + 5 <= padding.length; i += 5) padding.set([0, 0, 0, 0xff, 0xff], i)
    const data = new Uint8Array(padding.length + 10)
    data.set(padding)
    data.set([1, 4, 0, 0xfb, 0xff, 1, 2, 3, 4], padding.length)
    const bytes = rawZip([{ name: 'padded', data: data.subarray(0, padding.length + 9), method: 8, crc: crc32(new Uint8Array([1, 2, 3, 4])), size: 4 }])
    const read = vi.fn(source(bytes).read)
    const entries = await readZipDirectory({ size: bytes.length, read })
    read.mockClear()
    await expect(readEntries({ size: bytes.length, read }, entries, () => {})).rejects.toThrow('it is damaged (“padded” is larger than it can be)')
    expect(read).not.toHaveBeenCalled()
  })

  it('reads one as large as any encoder makes', async () => {
    let x = 99
    const noise = new Uint8Array(70_000).map(() => {
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      return x >>> 24
    })
    const stored = deflateSync(noise, { level: 0 })
    expect(stored.length).toBeGreaterThan(noise.length)
    const bytes = rawZip([entry('noise', noise, { data: stored })])
    const got: Uint8Array[] = []
    await readEntries(source(bytes), await readZipDirectory(source(bytes)), (e, compressed) => got.push(inflateEntry(e, compressed, 1 << 20)))
    expect(sameBytes(got[0], noise)).toBe(true)
  })
})

describe('ZipWriter', () => {
  it('writes archives that other programs and the reader read back', async () => {
    const zip = new ZipWriter()
    const repeating = new Uint8Array(300_000).map((_, i) => i % 7)
    zip.add('a.txt', text('alpha alpha alpha alpha'))
    zip.add('b/é.raw', repeating)
    zip.add('c.png', text('stored as it is'), false)
    const bytes = new Uint8Array(await zip.finish('application/zip').arrayBuffer())

    const unzipped = unzipSync(bytes)
    expect(new TextDecoder().decode(unzipped['a.txt'])).toBe('alpha alpha alpha alpha')
    expect(sameBytes(unzipped['b/é.raw'], repeating)).toBe(true)
    expect(new TextDecoder().decode(unzipped['c.png'])).toBe('stored as it is')

    const entries = await readZipDirectory(source(bytes))
    expect(entries.map((e) => [e.name, e.method, e.size])).toEqual([
      ['a.txt', 8, 23],
      ['b/é.raw', 8, 300_000],
      ['c.png', 0, 15],
    ])
    expect(entries[1].compressedSize).toBeLessThan(2000)
  })

  it('stores what DEFLATE would make larger', async () => {
    let x = 2463534242
    const noise = new Uint8Array(5000).map(() => {
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      return x >>> 24
    })
    const zip = new ZipWriter()
    zip.add('noise', noise)
    const [e] = await readZipDirectory(source(new Uint8Array(await zip.finish('application/zip').arrayBuffer())))
    expect([e.method, e.compressedSize, e.size]).toEqual([0, 5000, 5000])
  })
})

