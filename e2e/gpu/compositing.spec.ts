/**
 * Layer compositing on the real GPU, compared with the W3C reference in
 * e2e/reference/compositing.ts.
 */
import type { BlendMode } from '../../src/types/layer.ts'
import { ALL_BLEND_MODES } from '../../src/types/layer.ts'
import type { Rect, RGBA } from '../harness/protocol.ts'
import { compositePixel, compositeStack } from '../reference/compositing.ts'
import { expectKnownBug, type KnownBug } from '../support/knownBugs.ts'
import { expect, test, type Pixels } from '../support/quar.ts'

const SIZE = 32
const LEFT: Rect = { x: 0, y: 0, width: SIZE / 2, height: SIZE }
const RIGHT: Rect = { x: SIZE / 2, y: 0, width: SIZE / 2, height: SIZE }
/** Per-channel tolerance for GPU results (8-bit rounding in shaders and readback). */
const TOLERANCE = 3

const BACKDROP: RGBA = [180, 90, 60, 255]
const HALF_BACKDROP: RGBA = [180, 90, 60, 128]
const SOURCE: RGBA = [60, 160, 200, 255]

/** Every pixel of `rect` matches `expected`; reports the first that doesn't. */
function expectUniform(pixels: Pixels, rect: Rect, expected: RGBA, label: string) {
  for (const { x, y, color } of pixels.pixels(rect)) {
    expect(color, `${label} at (${x}, ${y})`).toMatchColor(expected, TOLERANCE)
  }
}

const PER_PIXEL_MODES = ALL_BLEND_MODES.filter((m) => m !== 'dissolve')

// Measured on Chromium (WebGL 2 and WebGPU), Firefox and WebKit: the same on all four.
const NO_HUE: KnownBug = { id: 'F15', fixedIn: 'M2.4', summary: 'renders as Normal because PixiJS has no Hue mode' }
const OPAQUE_BACKDROP_ASSUMED: KnownBug = {
  id: 'F16',
  fixedIn: 'M2.4',
  summary:
    'the formula assumes an opaque backdrop: it blends with black where the backdrop is transparent ' +
    'and with the premultiplied colour where it is semi-transparent',
}

const ADVANCED_MODES = [
  'darken', 'colorBurn', 'lighten', 'colorDodge', 'overlay', 'softLight', 'hardLight',
  'difference', 'exclusion', 'saturation', 'color', 'luminosity',
] as const satisfies readonly BlendMode[]
const CPU_MODES = [
  'vividLight', 'linearLight', 'pinLight', 'hardMix', 'subtract', 'divide', 'darkerColor',
] as const satisfies readonly BlendMode[]

const KNOWN_OPAQUE: Partial<Record<BlendMode, KnownBug>> = { hue: NO_HUE }
const KNOWN_TRANSPARENT: Partial<Record<BlendMode, KnownBug>> = {
  // Exclusion passes: its formula is linear in the backdrop, so blending with
  // the premultiplied colour happens to give the right result.
  ...Object.fromEntries(
    [...ADVANCED_MODES.filter((m) => m !== 'exclusion'), 'multiply', ...CPU_MODES].map((m) => [m, OPAQUE_BACKDROP_ASSUMED]),
  ),
  hue: NO_HUE,
}

test.describe('blend modes over an opaque backdrop', () => {
  for (const mode of PER_PIXEL_MODES) {
    test(mode, async ({ quar }) => {
      const info = await quar.open({ width: SIZE, height: SIZE })
      expectKnownBug(KNOWN_OPAQUE[mode], info)
      const base = await quar.baseLayerId()
      await quar.fillRect(base, BACKDROP)
      const top = await quar.addLayer('source')
      await quar.fillRect(top, SOURCE)
      await quar.setLayerProps(top, { blendMode: mode })

      const composite = await quar.readComposite()
      expectUniform(composite, { x: 0, y: 0, width: SIZE, height: SIZE }, compositePixel(BACKDROP, SOURCE, mode), mode)
    })
  }
})

test.describe('blend modes over transparent and half-transparent backdrops', () => {
  for (const mode of PER_PIXEL_MODES) {
    test(mode, async ({ quar }) => {
      const info = await quar.open({ width: SIZE, height: SIZE })
      expectKnownBug(KNOWN_TRANSPARENT[mode], info)
      const base = await quar.baseLayerId()
      // Left half stays empty; right half is 50% transparent.
      await quar.fillRect(base, HALF_BACKDROP, RIGHT)
      const top = await quar.addLayer('source')
      await quar.fillRect(top, SOURCE)
      await quar.setLayerProps(top, { blendMode: mode })

      const composite = await quar.readComposite()
      expectUniform(composite, LEFT, compositePixel([0, 0, 0, 0], SOURCE, mode), `${mode} over transparent`)
      expectUniform(composite, RIGHT, compositePixel(HALF_BACKDROP, SOURCE, mode), `${mode} over 50% backdrop`)
    })
  }
})

test.describe('layer opacity', () => {
  for (const mode of ['normal', 'multiply', 'screen'] as const) {
    test(`${mode} at 40% opacity`, async ({ quar }) => {
      await quar.open({ width: SIZE, height: SIZE })
      const base = await quar.baseLayerId()
      await quar.fillRect(base, BACKDROP)
      const top = await quar.addLayer('source')
      await quar.fillRect(top, SOURCE)
      await quar.setLayerProps(top, { blendMode: mode, opacity: 0.4 })

      const composite = await quar.readComposite()
      expectUniform(composite, LEFT, compositePixel(BACKDROP, SOURCE, mode, 0.4), `${mode} at 40%`)
    })
  }

  test('a hidden layer does not contribute', async ({ quar }) => {
    await quar.open({ width: SIZE, height: SIZE })
    const base = await quar.baseLayerId()
    await quar.fillRect(base, BACKDROP)
    const top = await quar.addLayer('hidden')
    await quar.fillRect(top, SOURCE)
    await quar.setLayerProps(top, { visible: false })

    expectUniform(await quar.readComposite(), LEFT, BACKDROP, 'hidden layer')
  })
})

test('dissolve shows either the layer or the backdrop at each pixel', async ({ quar }) => {
  const info = await quar.open({ width: SIZE, height: SIZE })
  expectKnownBug({ id: 'F15', fixedIn: 'M2.4', summary: 'Dissolve renders as Normal' }, info)
  const base = await quar.baseLayerId()
  await quar.fillRect(base, BACKDROP)
  const top = await quar.addLayer('source')
  await quar.fillRect(top, SOURCE)
  await quar.setLayerProps(top, { blendMode: 'dissolve', opacity: 0.5 })

  const composite = await quar.readComposite()
  let fromSource = 0
  for (const { x, y, color } of composite.pixels()) {
    const isSource = color.every((v, i) => Math.abs(v - SOURCE[i]) <= TOLERANCE)
    const isBackdrop = color.every((v, i) => Math.abs(v - BACKDROP[i]) <= TOLERANCE)
    expect(isSource || isBackdrop, `pixel (${x}, ${y}) = ${color.join('/')} is a mix`).toBe(true)
    if (isSource) fromSource++
  }
  const share = fromSource / (SIZE * SIZE)
  expect(share, 'share of pixels taken from the layer at 50% opacity').toBeGreaterThan(0.3)
  expect(share).toBeLessThan(0.7)
})

test.describe('clipping masks', () => {
  const SQUARE: Rect = { x: 8, y: 8, width: 16, height: 16 }
  const CLIPPED: RGBA = [40, 200, 90, 255]

  async function clipOver(quar: import('../support/quar.ts').Quar, baseColor: RGBA) {
    const base = await quar.baseLayerId()
    await quar.fillRect(base, baseColor, SQUARE)
    const top = await quar.addLayer('clipped')
    await quar.fillRect(top, CLIPPED)
    await quar.setLayerProps(top, { clippingMask: true })
    return quar.readComposite()
  }

  // Pure red is the one colour the red-channel mask (F20) gets right, so this
  // checks the clipping geometry while F20 is open.
  test('clip to pure red content', async ({ quar }) => {
    await quar.open({ width: SIZE, height: SIZE })
    const composite = await clipOver(quar, [255, 0, 0, 255])
    const inside = compositeStack([{ color: [255, 0, 0, 255] }, { color: CLIPPED, clippingMask: true }])
    expectUniform(composite, SQUARE, inside, 'inside the base')
    expect(composite.maxAlpha({ x: 0, y: 0, width: SIZE, height: 8 }), 'outside the base').toBe(0)
  })

  test('clip to content of any colour', async ({ quar }) => {
    const info = await quar.open({ width: SIZE, height: SIZE })
    expectKnownBug({ id: 'F20', fixedIn: 'M2.4', summary: 'clipping uses the red channel of the base layer as the mask' }, info)
    const composite = await clipOver(quar, [40, 60, 220, 255])
    const inside = compositeStack([{ color: [40, 60, 220, 255] }, { color: CLIPPED, clippingMask: true }])
    expectUniform(composite, SQUARE, inside, 'inside the base')
    expect(composite.maxAlpha({ x: 0, y: 0, width: SIZE, height: 8 }), 'outside the base').toBe(0)
  })
})
