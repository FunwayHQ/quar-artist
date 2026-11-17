import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createManifest, parseManifest, MAX_FILE_LAYERS, type ManifestInput } from './manifest.ts'
import { manifestOf } from './testArchives.ts'
import type { LayerInfo } from '../../../types/layer.ts'

function layer(id: string, overrides: Partial<LayerInfo> = {}): LayerInfo {
  return { id, name: `Layer ${id}`, visible: true, opacity: 1, blendMode: 'normal', alphaLock: false, clippingMask: false, locked: false, ...overrides }
}

const input: ManifestInput = {
  name: 'Sunset',
  width: 1920,
  height: 1080,
  dpi: 144,
  colorSpace: 'display-p3',
  layers: [layer('bg', { thumbnail: 'data:image/png;base64,' }), layer('ink', { blendMode: 'multiply', opacity: 0.5, clippingMask: true })],
  activeLayerId: 'ink',
  guides: { gridEnabled: true },
  createdAt: '2026-11-17T10:00:00.000Z',
  updatedAt: '2026-11-17T12:30:00.000Z',
  thumbnail: true,
}

function refused(data: unknown): string {
  try {
    parseManifest(data)
  } catch (err) {
    expect((err as Error).name).toBe('QartError')
    return (err as Error).message
  }
  throw new Error('the manifest was accepted')
}

const doc = { width: 600, height: 300, layerIds: ['a', 'b'] }

describe('createManifest', () => {
  it('writes version 1 as docs/qart-format.md describes it', () => {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
    expect(createManifest(input)).toEqual({
      format: 'qart',
      formatVersion: 1,
      app: { name: 'QUAR Artist', version },
      name: 'Sunset',
      createdAt: '2026-11-17T10:00:00.000Z',
      updatedAt: '2026-11-17T12:30:00.000Z',
      canvas: { width: 1920, height: 1080, dpi: 144, colorSpace: 'display-p3' },
      tiles: { size: 256, format: 'rgba8', alpha: 'premultiplied', codec: 'raw' },
      layers: [
        { type: 'layer', id: 'bg', name: 'Layer bg', blendMode: 'normal', opacity: 1, visible: true, locked: false, alphaLock: false, clippingMask: false },
        { type: 'layer', id: 'ink', name: 'Layer ink', blendMode: 'multiply', opacity: 0.5, visible: true, locked: false, alphaLock: false, clippingMask: true },
      ],
      activeLayerId: 'ink',
      guides: { gridEnabled: true },
      thumbnail: 'thumbnail.png',
      timelapse: null,
    })
  })

  it('stamps the time when not given one, and says when there are no guides or thumbnail', () => {
    const m = createManifest({ ...input, createdAt: undefined, updatedAt: undefined, guides: undefined, thumbnail: false })
    expect(m).not.toHaveProperty('createdAt')
    expect(Date.parse(m.updatedAt!)).toBeGreaterThan(Date.now() - 60_000)
    expect(m.guides).toBeNull()
    expect(m.thumbnail).toBeNull()
  })

  it('reads back as it was written', () => {
    expect(parseManifest(JSON.parse(JSON.stringify(createManifest(input))))).toEqual({
      formatVersion: 1,
      name: 'Sunset',
      width: 1920,
      height: 1080,
      dpi: 144,
      colorSpace: 'display-p3',
      layers: [{ info: layer('bg') }, { info: layer('ink', { blendMode: 'multiply', opacity: 0.5, clippingMask: true }) }],
      activeLayerId: 'ink',
      guides: { gridEnabled: true },
      createdAt: '2026-11-17T10:00:00.000Z',
      updatedAt: '2026-11-17T12:30:00.000Z',
    })
  })
})

describe('parseManifest, version 1', () => {
  it('refuses a newer format version, saying so', () => {
    expect(refused(manifestOf(doc, { formatVersion: 2 }))).toBe('it was saved by a newer version of QUAR Artist (format version 2)')
    expect(refused(manifestOf(doc, { formatVersion: '1' }))).toBe('it is damaged (its manifest has an unknown format version)')
    expect(refused(manifestOf(doc, { format: 'zip' }))).toBe('it is damaged (its manifest has an unknown format version)')
    expect(refused({ canvas: {} })).toBe('it is damaged (its manifest has no format version)')
    expect(refused([])).toBe("it is damaged (its manifest isn't an object)")
  })

  it('refuses a canvas size, resolution or colour space out of range', () => {
    for (const canvas of [
      { width: 0, height: 300, dpi: 144, colorSpace: 'srgb' },
      { width: 16385, height: 300, dpi: 144, colorSpace: 'srgb' },
      { width: 600.5, height: 300, dpi: 144, colorSpace: 'srgb' },
      { width: '600', height: 300, dpi: 144, colorSpace: 'srgb' },
      { width: 600, height: 1e9, dpi: 144, colorSpace: 'srgb' },
    ]) {
      expect(refused(manifestOf(doc, { canvas }))).toBe("it is damaged (its canvas size isn't whole numbers from 1 to 16384 px)")
    }
    for (const dpi of [0, 10001, Number.NaN, null]) {
      expect(refused(manifestOf(doc, { canvas: { width: 600, height: 300, dpi, colorSpace: 'srgb' } }))).toBe(
        "it is damaged (its resolution isn't from 1 to 10000 dpi)",
      )
    }
    expect(refused(manifestOf(doc, { canvas: { width: 600, height: 300, dpi: 72, colorSpace: 'cmyk' } }))).toBe(
      'it is damaged (its colour space is unknown)',
    )
    expect(refused(manifestOf(doc, { canvas: null }))).toBe('it is damaged (its manifest has no canvas)')
  })

  it('refuses tiles stored in a way it cannot read', () => {
    for (const tiles of [{ size: 512, format: 'rgba8', alpha: 'premultiplied', codec: 'raw' }, { size: 256, format: 'rgba8', alpha: 'straight', codec: 'raw' }, { size: 256, format: 'rgba8', alpha: 'premultiplied', codec: 'lz4' }, null]) {
      expect(refused(manifestOf(doc, { tiles }))).toBe("it is damaged (its tiles are stored in a way QUAR Artist can't read)")
    }
  })

  it('refuses no layers, too many, and layers that are not layers', () => {
    expect(refused(manifestOf(doc, { layers: [] }))).toBe('it has no layers')
    expect(refused(manifestOf(doc, { layers: 'a, b' }))).toBe('it is damaged (its manifest has no layers)')
    const many = manifestOf({ ...doc, layerIds: Array.from({ length: MAX_FILE_LAYERS + 1 }, (_, i) => `l${i}`) })
    expect(refused(many)).toBe('it is damaged (it has more than 1000 layers)')
    const group = manifestOf(doc)
    ;(group.layers as Record<string, unknown>[])[1].type = 'group'
    expect(refused(group)).toBe("it is damaged (layer 2 isn't a layer)")
  })

  it('refuses ids that would name no folder, or two layers with one id', () => {
    for (const id of ['', '../a', 'a/b', 'x'.repeat(65), 'é', 7]) {
      const m = manifestOf(doc)
      ;(m.layers as Record<string, unknown>[])[0].id = id
      expect(refused(m)).toBe('it is damaged (layer 1 has no valid id)')
    }
    expect(refused(manifestOf({ ...doc, layerIds: ['a', 'a'] }))).toBe('it is damaged (two layers have the id “a”)')
  })

  it("refuses a layer's properties out of range", () => {
    const broken = (field: string, value: unknown) => {
      const m = manifestOf(doc)
      ;(m.layers as Record<string, unknown>[])[0][field] = value
      return refused(m)
    }
    expect(broken('blendMode', 'glow')).toBe('it is damaged (layer 1 has an unknown blend mode)')
    expect(broken('opacity', 1.5)).toBe("it is damaged (layer 1's opacity isn't from 0 to 1)")
    expect(broken('opacity', '1')).toBe("it is damaged (layer 1's opacity isn't from 0 to 1)")
    expect(broken('name', null)).toBe('it is damaged (layer 1 has no name)')
    expect(broken('visible', 'yes')).toBe('it is damaged (layer 1 has no valid “visible”)')
    expect(broken('locked', undefined)).toBe('it is damaged (layer 1 has no valid “locked”)')
  })

  it('refuses a selected layer that is none of its layers', () => {
    expect(refused(manifestOf(doc, { activeLayerId: 'c' }))).toBe('it is damaged (its selected layer is none of its layers)')
    expect(refused(manifestOf(doc, { activeLayerId: null }))).toBe('it is damaged (its selected layer is none of its layers)')
  })

  it('cuts long names, and keeps guides only as an object', () => {
    const m = manifestOf(doc, { name: 'n'.repeat(1000), guides: 'grid' })
    ;(m.layers as Record<string, unknown>[])[0].name = 'l'.repeat(300)
    const parsed = parseManifest(m)
    expect(parsed.name).toHaveLength(256)
    expect(parsed.layers[0].info.name).toHaveLength(256)
    expect(parsed.guides).toBeNull()
    expect(parseManifest(manifestOf(doc, { guides: { symmetryEnabled: true } })).guides).toEqual({ symmetryEnabled: true })
    expect(parseManifest(manifestOf(doc, { name: 7 })).name).toBeNull()
    // A character of two UTF-16 units across the cut is left out whole.
    expect(parseManifest(manifestOf(doc, { name: `${'a'.repeat(255)}😀` })).name).toBe('a'.repeat(255))
  })
})

describe('parseManifest, the draft layout before version 1', () => {
  function draft(layers: Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
    return { version: '1.0', app: 'quar-artist', canvas: { width: 64, height: 32, dpi: 300, colorSpace: 'srgb' }, layers, activeLayerId: 'top', ...overrides }
  }
  const draftLayer = (id: string, order: number, more: Record<string, unknown> = {}) => ({
    id,
    name: id,
    blendMode: 'normal',
    opacity: 1,
    visible: true,
    order,
    dataFile: `layers/${id}.bin`,
    ...more,
  })

  it('reads its layers in their order, with the entries that hold their pixels', () => {
    const parsed = parseManifest(draft([draftLayer('top', 1, { locked: true }), draftLayer('bottom', 0)]))
    expect(parsed).toMatchObject({ formatVersion: 0, name: null, width: 64, height: 32, dpi: 300, colorSpace: 'srgb', activeLayerId: 'top', guides: null })
    expect(parsed.layers.map((l) => [l.info.id, l.dataFile, l.info.locked, l.info.alphaLock])).toEqual([
      ['bottom', 'layers/bottom.bin', false, false],
      ['top', 'layers/top.bin', true, false],
    ])
  })

  it('opens on its top layer when the one it names is none of them', () => {
    expect(parseManifest(draft([draftLayer('a', 0), draftLayer('b', 1)], { activeLayerId: 'gone' })).activeLayerId).toBe('b')
  })

  it('refuses two layers in one entry, a layer without one, or without a usable order', () => {
    expect(refused(draft([draftLayer('a', 0), draftLayer('b', 1, { dataFile: 'layers/a.bin' })]))).toBe(
      'it is damaged (two layers keep their pixels in “layers/a.bin”)',
    )
    expect(refused(draft([draftLayer('a', 0, { dataFile: '' })]))).toBe('it is damaged (layer 1 names no entry for its pixels)')
    expect(refused(draft([draftLayer('a', Number.POSITIVE_INFINITY)]))).toBe('it is damaged (layer 1 has no valid order)')
    expect(refused(draft([draftLayer('a', 0), draftLayer('a', 1, { dataFile: 'x' })]))).toBe('it is damaged (two layers have the id “a”)')
  })
})
