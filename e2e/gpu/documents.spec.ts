/**
 * Saving and opening documents on the real GPU (plan M1.1): the pixels a
 * project is saved with are the pixels it opens with.
 */
import type { Rect, RGBA } from '../harness/protocol.ts'
import { expect, test } from '../support/quar.ts'

const SIZE = 32
const LEFT: Rect = { x: 0, y: 0, width: 16, height: SIZE }
const RIGHT: Rect = { x: 16, y: 0, width: 16, height: SIZE }
const MIDDLE: Rect = { x: 8, y: 8, width: 16, height: 16 }
const RED: RGBA = [220, 30, 30, 255]
const HALF_BLUE: RGBA = [40, 60, 220, 128]
const FAINT_GREEN: RGBA = [30, 200, 90, 40]

test('a reopened document has the same layers, pixel for pixel', async ({ quar }) => {
  await quar.open({ width: SIZE, height: SIZE })
  const bottom = await quar.baseLayerId()
  await quar.fillRect(bottom, RED, LEFT)
  const middle = await quar.addLayer('Glaze')
  await quar.fillRect(middle, HALF_BLUE, RIGHT)
  await quar.setLayerProps(middle, { opacity: 0.6, blendMode: 'multiply' })
  const top = await quar.addLayer('Mist')
  await quar.fillRect(top, FAINT_GREEN, MIDDLE)
  await quar.setLayerProps(top, { visible: false })
  await quar.selectLayer(middle)

  const layers = await quar.layers()
  const pixels = await Promise.all([bottom, middle, top].map((id) => quar.readLayer(id)))
  const composite = await quar.readComposite()

  await quar.reopen()

  expect(await quar.layers()).toEqual(layers)
  expect(await quar.activeLayerId()).toBe(middle)
  const reopened = await Promise.all([bottom, middle, top].map((id) => quar.readLayer(id)))
  // Straight-alpha readback rounds faint colours a little on WebGL (see readback.ts).
  reopened.forEach((layer, i) => expect(layer).toMatchPixels(pixels[i], 2))
  expect(await quar.readComposite()).toMatchPixels(composite, 2)
})

test('a reopened document starts with an empty history', async ({ quar }) => {
  await quar.open({ width: SIZE, height: SIZE })
  await quar.setBrush({ size: 6, color: RED })
  await quar.stroke([{ x: 4, y: 16 }, { x: 28, y: 16 }])
  const painted = await quar.readLayer(await quar.baseLayerId())

  await quar.reopen()

  expect(await quar.undo()).toBe(false)
  expect(await quar.readLayer(await quar.baseLayerId())).toMatchPixels(painted, 2)
})

test('painting on a reopened document works and can be undone', async ({ quar }) => {
  await quar.open({ width: SIZE, height: SIZE })
  const bottom = await quar.baseLayerId()
  await quar.fillRect(bottom, HALF_BLUE, LEFT)
  await quar.reopen()
  const reopened = await quar.readLayer(bottom)

  await quar.setBrush({ size: 6, color: RED })
  await quar.stroke([{ x: 4, y: 16 }, { x: 28, y: 16 }])
  expect((await quar.readLayer(bottom)).at(24, 16)).toMatchColor(RED)

  expect(await quar.undo()).toBe(true)
  expect(await quar.readLayer(bottom)).toMatchPixels(reopened, 2)
})
