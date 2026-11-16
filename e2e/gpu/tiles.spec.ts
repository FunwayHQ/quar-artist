/**
 * Incremental saves on the real GPU (plan M1.3): the tiles a save reads back
 * are the pixels a whole-layer read gives, edge tiles and rows of tiles read
 * at once included, and the engine records the tiles a change touched, no
 * more, so a save reads back just those.
 */
import type { RGBA } from '../harness/protocol.ts'
import { expect, test } from '../support/quar.ts'

// 3 × 2 tiles of 256 px: the last column is 88 px wide, the last row 44 px high.
const W = 600
const H = 300
const RED: RGBA = [220, 30, 30, 255]
const HALF_BLUE: RGBA = [40, 60, 220, 128]
const FAINT_GREEN: RGBA = [30, 200, 90, 40]

test('reads tiles back as a whole-layer read gives them, edge tiles and runs included', async ({ quar }) => {
  await quar.open({ width: W, height: H })
  const layer = await quar.baseLayerId()
  // Colour across tile edges, some of it translucent, some faint.
  await quar.fillRect(layer, RED, { x: 200, y: 200, width: 120, height: 80 })
  await quar.fillRect(layer, HALF_BLUE, { x: 490, y: 240, width: 110, height: 60 })
  await quar.fillRect(layer, FAINT_GREEN, { x: 0, y: 0, width: W, height: 20 })

  // A row read at once, a tile alone, and the corner tile.
  const tiles = await quar.readTiles(layer, [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 0, y: 1 },
    { x: 2, y: 1 },
  ])
  expect(tiles.map((t) => [t.x, t.y, t.read.width, t.read.height])).toEqual([
    [0, 0, 256, 256],
    [1, 0, 256, 256],
    [2, 0, 88, 256],
    [0, 1, 256, 44],
    [2, 1, 88, 44],
  ])
  for (const tile of tiles) expect(tile.read, `tile ${tile.x}_${tile.y}`).toMatchPixels(tile.whole)
  // Not just transparent: the colours made it.
  expect(tiles[4].read.at(80, 40)).toMatchColor(HALF_BLUE, 2)
  expect(tiles[0].read.at(0, 0)).toMatchColor(FAINT_GREEN, 8)
})

test('records the tiles each stroke and undo touched, stroke after stroke', async ({ quar }) => {
  await quar.open({ width: W, height: H })
  const layer = await quar.baseLayerId()
  await quar.setBrush({ size: 8, color: RED })
  await quar.takeChanges()

  await quar.stroke([{ x: 300, y: 100 }, { x: 400, y: 120 }])
  expect(await quar.takeChanges()).toEqual({ [layer]: ['1_0'] })

  // The next stroke starts from the pixels the last one left, compressed in
  // the background meanwhile: still told apart by tile, not the whole layer.
  await quar.page.waitForTimeout(300)
  await quar.stroke([{ x: 480, y: 270 }, { x: 560, y: 290 }])
  expect(await quar.takeChanges()).toEqual({ [layer]: ['1_1', '2_1'] })

  expect(await quar.undo()).toBe(true)
  expect(await quar.takeChanges()).toEqual({ [layer]: ['1_1', '2_1'] })
  expect(await quar.takeChanges()).toEqual({})
})
