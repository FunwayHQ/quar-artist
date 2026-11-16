/**
 * PNG export through the app's export path. The test decodes the file itself,
 * so these checks see exactly what the file holds.
 */
import type { RGBA } from '../harness/protocol.ts'
import { expectKnownBug } from '../support/knownBugs.ts'
import { expect, test } from '../support/quar.ts'

const SIZE = 32

test('PNG export keeps opaque colours', async ({ quar }) => {
  await quar.open({ width: SIZE, height: SIZE })
  const layer = await quar.baseLayerId()
  const colors: RGBA[] = [
    [255, 0, 0, 255],
    [20, 180, 60, 255],
    [40, 60, 220, 255],
    [250, 220, 0, 255],
  ]
  for (const [i, color] of colors.entries()) {
    await quar.fillRect(layer, color, { x: (i % 2) * 16, y: Math.floor(i / 2) * 16, width: 16, height: 16 })
  }

  const png = await quar.exportPng()
  expect([png.width, png.height]).toEqual([SIZE, SIZE])
  expect(png.at(4, 4)).toMatchColor(colors[0])
  expect(png.at(20, 4)).toMatchColor(colors[1])
  expect(png.at(4, 20)).toMatchColor(colors[2])
  expect(png.at(20, 20)).toMatchColor(colors[3])
})

test('PNG export keeps semi-transparent colours', async ({ quar }) => {
  const info = await quar.open({ width: SIZE, height: SIZE })
  expectKnownBug(
    {
      id: 'F103',
      fixedIn: 'M1.8',
      summary: "the PNG is encoded from Firefox's 2D canvas, which rounds premultiplied colour up",
      browsers: ['firefox'],
    },
    info,
  )
  const layer = await quar.baseLayerId()
  await quar.fillRect(layer, [255, 0, 0, 128], { x: 0, y: 0, width: 16, height: SIZE })
  await quar.fillRect(layer, [40, 60, 220, 64], { x: 16, y: 0, width: 16, height: SIZE })

  const png = await quar.exportPng()
  // Within 1: the GPU and the encoder's 2D canvas both keep premultiplied
  // 8-bit colour, which rounds 220 at alpha 64 to 219 on the way out.
  expect(png.at(4, 4)).toMatchColor([255, 0, 0, 128], 1)
  expect(png.at(20, 4)).toMatchColor([40, 60, 220, 64], 1)
})
