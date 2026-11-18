/**
 * PSD files saved by Photoshop (e2e/fixtures/psd), opened as the app opens
 * them and drawn on the real GPU, compared with the composite Photoshop drew
 * for each (plan M1.7). The PRD's target is that 95% of pixels match (10.1).
 */
import { readFileSync } from 'node:fs'
import { readPsd, type Layer, type LayerEffectSolidFill } from '../../src/io/formats/psd/agPsd.ts'
import { quarBlendModeOf } from '../../src/io/formats/psd/blendModeMap.ts'
import type { PsdNotes } from '../../src/io/formats/psd/PsdReader.ts'
import type { BlendMode } from '../../src/types/layer.ts'
import type { RGBA } from '../harness/protocol.ts'
import { expectKnownBug, type KnownBug } from '../support/knownBugs.ts'
import { expect, test, type Pixels } from '../support/quar.ts'

const FIXTURES = new URL('../fixtures/psd/', import.meta.url)
/** The PRD's target: the share of pixels drawn as Photoshop drew them. */
const TARGET = 0.95
/** Levels a pixel may be off by and still match: 8-bit rounding in shaders and readback. */
const TOLERANCE = 3

function fixture(name: string): Uint8Array {
  return readFileSync(new URL(`${name}.psd`, FIXTURES))
}

/** The composite image Photoshop saved in a file, straight alpha. */
function photoshopComposite(bytes: Uint8Array) {
  const psd = readPsd(bytes, { useImageData: true, skipLayerImageData: true, skipThumbnail: true, skipLinkedFilesData: true })
  if (!psd.imageData) throw new Error('the file has no composite image')
  return { width: psd.width, height: psd.height, data: psd.imageData.data }
}

/**
 * The share of pixels within TOLERANCE of Photoshop's, in alpha and in
 * colour times alpha: the less a pixel covers, the less its colour shows.
 */
function fidelity(drawn: Pixels, photoshop: ArrayLike<number>): number {
  let matching = 0
  for (let i = 0; i < photoshop.length; i += 4) {
    const a = drawn.data[i + 3]
    const b = photoshop[i + 3]
    let worst = Math.abs(a - b)
    for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(drawn.data[i + c] * a - photoshop[i + c] * b) / 255)
    if (worst <= TOLERANCE) matching++
  }
  return matching / (photoshop.length / 4)
}

const NO_NOTES: PsdNotes = { groups: 0, adjustments: 0, effects: 0, vectorMasks: 0, groupMasks: 0, blendModes: [] }

/** Each file, with the layers it opens as, bottom to top, and what is noted as left out. */
const FILES: { name: string; layers: string[]; notes?: Partial<PsdNotes> }[] = [
  { name: 'layers', layers: ['Layer 0', 'Layer 3', 'Layer 1'] },
  { name: 'groups', layers: ['Layer 0', 'Layer 3', 'Layer 1'], notes: { groups: 2 } },
  { name: 'background', layers: ['Background', 'Layer 1'] },
  { name: 'layer-mask', layers: ['Layer 1'] },
  { name: 'layer-larger-than-drawing', layers: ['bg'] },
  { name: 'just-bg', layers: ['Background'] },
  { name: 'grayscale', layers: ['Background', 'Layer 1'] },
  { name: 'text-layer', layers: ['Background', 'Test text'] },
  { name: 'nested', layers: ['Layer1 (#ff)', 'Layer10 (#00)'], notes: { groups: 10 } },
]

test.describe('PSD files from Photoshop, drawn as Photoshop drew them (plan M1.7)', () => {
  for (const { name, layers, notes } of FILES) {
    test(name, async ({ quar }) => {
      const bytes = fixture(name)
      const photoshop = photoshopComposite(bytes)
      await quar.open({ width: photoshop.width, height: photoshop.height })

      const opened = await quar.openPsd(bytes)

      expect(opened.layers.map((l) => l.name)).toEqual(layers)
      expect(opened.notes).toEqual({ ...NO_NOTES, ...notes })
      const score = fidelity(await quar.readComposite(), photoshop.data)
      test.info().annotations.push({ type: 'match', description: `${(score * 100).toFixed(2)}% of pixels` })
      expect(score, 'the share of pixels drawn as Photoshop drew them').toBeGreaterThanOrEqual(TARGET)
    })
  }
})

// Measured on Chromium (WebGL 2 and WebGPU), Firefox and WebKit: the same on all four.
const NO_HUE: KnownBug = { id: 'F15', fixedIn: 'M2.4', summary: 'renders as Normal because PixiJS has no Hue mode' }
const VIVID_LIGHT: KnownBug = {
  id: 'F107',
  fixedIn: 'M2.4',
  summary: "differs from Photoshop's by up to 7 levels: rgba(218, 251, 255) where Photoshop draws rgba(211, 248, 255)",
}
const KNOWN: Partial<Record<BlendMode, KnownBug>> = { hue: NO_HUE, vividLight: VIVID_LIGHT }

function rgb(color: LayerEffectSolidFill['color']): RGBA {
  if (!color || !('r' in color)) throw new Error(`not an RGB colour: ${JSON.stringify(color)}`)
  return [Math.round(color.r), Math.round(color.g), Math.round(color.b), 255]
}

/** A layer's colour: each square in the file is one colour throughout. */
function colorOf(layer: Layer): RGBA {
  const data = layer.imageData?.data
  if (!data) throw new Error(`${layer.name} has no pixels`)
  return [data[0], data[1], data[2], data[3]]
}

test.describe('blend modes as Photoshop draws them (plan M1.7)', () => {
  // A square in each of Photoshop's blend modes over grey, each with a Color Overlay in its own mode.
  const bytes = fixture('2026-blend-modes')
  const psd = readPsd(bytes, { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true })
  const [, base, ...squares] = psd.children!
  const composite = psd.imageData!

  for (const square of squares) {
    const mode = quarBlendModeOf(square.blendMode!)
    // Linear Burn isn't in the app; Dissolve is random, so no two renderings agree.
    if (!mode || mode === 'dissolve') continue
    test(square.name!, async ({ quar }) => {
      const info = await quar.open({ width: 4, height: 4 })
      expectKnownBug(KNOWN[mode], info)
      const overlay = square.effects!.solidFill![0]
      expect(overlay.blendMode).toBe(square.blendMode)

      // Photoshop draws a Color Overlay over what is under it, the layer itself
      // included, in the overlay's mode: as a layer clipped to this one would be.
      const bottom = await quar.baseLayerId()
      await quar.fillRect(bottom, colorOf(base))
      const layer = await quar.addLayer('square')
      await quar.fillRect(layer, colorOf(square))
      await quar.setLayerProps(layer, { blendMode: mode })
      const over = await quar.addLayer('overlay')
      await quar.fillRect(over, rgb(overlay.color))
      await quar.setLayerProps(over, { blendMode: mode, opacity: overlay.opacity ?? 1 })

      const x = (square.left! + square.right!) >> 1
      const y = (square.top! + square.bottom!) >> 1
      const i = (y * psd.width + x) * 4
      const photoshop: RGBA = [composite.data[i], composite.data[i + 1], composite.data[i + 2], composite.data[i + 3]]
      expect((await quar.readComposite()).at(2, 2)).toMatchColor(photoshop, TOLERANCE)
    })
  }
})
