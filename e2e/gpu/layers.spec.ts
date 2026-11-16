/**
 * Layer operations on the real GPU.
 */
import type { Rect, RGBA } from '../harness/protocol.ts'
import { compositePixel } from '../reference/compositing.ts'
import { expectKnownBug } from '../support/knownBugs.ts'
import { expect, test } from '../support/quar.ts'

const SIZE = 32
const LEFT: Rect = { x: 0, y: 0, width: 16, height: SIZE }
const RIGHT: Rect = { x: 16, y: 0, width: 16, height: SIZE }
const RED: RGBA = [220, 30, 30, 255]
const BLUE: RGBA = [40, 60, 220, 255]

test.describe('merge down', () => {
  test('combines the layer with the one below', async ({ quar }) => {
    await quar.open({ width: SIZE, height: SIZE })
    const bottom = await quar.baseLayerId()
    await quar.fillRect(bottom, RED, LEFT)
    const top = await quar.addLayer('top')
    await quar.fillRect(top, BLUE, RIGHT)
    await quar.mergeDown(top)

    const layers = await quar.layers()
    expect(layers.map((l) => l.id)).toEqual([bottom])
    const merged = await quar.readLayer(bottom)
    expect(merged.at(4, 4)).toMatchColor(RED)
    expect(merged.at(28, 28)).toMatchColor(BLUE)
  })

  test("applies the merged layer's blend mode", async ({ quar }) => {
    const info = await quar.open({ width: SIZE, height: SIZE })
    expectKnownBug({ id: 'F27', fixedIn: 'M2.4', summary: 'Merge Down ignores blend mode, clipping and visibility' }, info)
    const bottom = await quar.baseLayerId()
    await quar.fillRect(bottom, [180, 90, 60, 255])
    const top = await quar.addLayer('top')
    await quar.fillRect(top, [60, 160, 200, 255])
    await quar.setLayerProps(top, { blendMode: 'multiply' })
    await quar.mergeDown(top)

    const merged = await quar.readLayer(bottom)
    expect(merged.at(8, 8)).toMatchColor(compositePixel([180, 90, 60, 255], [60, 160, 200, 255], 'multiply'), 3)
  })

  test('undo brings back both layers', async ({ quar }) => {
    const info = await quar.open({ width: SIZE, height: SIZE })
    expectKnownBug({ id: 'F26', fixedIn: 'M2.5', summary: 'Merge Down cannot be undone' }, info)
    const bottom = await quar.baseLayerId()
    // Paint with the tools so the history has real entries before the merge.
    await quar.setTool('fill')
    await quar.setBrush({ color: RED })
    await quar.tap(4, 4)
    const top = await quar.addLayer('top')
    await quar.setBrush({ color: BLUE })
    await quar.tap(4, 4)
    const bottomBefore = await quar.readLayer(bottom)
    const topBefore = await quar.readLayer(top)

    await quar.mergeDown(top)
    await quar.undo()

    const layers = await quar.layers()
    expect(layers.map((l) => l.id), 'layers after undo').toEqual([bottom, top])
    expect(await quar.readLayer(bottom)).toMatchPixels(bottomBefore)
    expect(await quar.readLayer(top)).toMatchPixels(topBefore)
  })
})
