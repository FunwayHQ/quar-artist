/**
 * Brush strokes, undo/redo, flood fill, selection and alpha lock on the real
 * GPU, driven through the canvas's pointer events.
 */
import type { Rect, RGBA } from '../harness/protocol.ts'
import { paintAlphaLocked } from '../reference/compositing.ts'
import { distanceToPath, line, randomStroke, seededRandom } from '../reference/strokes.ts'
import { expectKnownBug } from '../support/knownBugs.ts'
import { expect, test } from '../support/quar.ts'

const SIZE = 64
const RED: RGBA = [255, 0, 0, 255]
const BLUE: RGBA = [40, 60, 220, 255]

test.describe('strokes', () => {
  for (const seed of [1, 2, 3]) {
    test(`a random stroke (seed ${seed}) paints through its points and nowhere far from them`, async ({ quar }) => {
      await quar.open({ width: SIZE, height: SIZE })
      const layer = await quar.baseLayerId()
      const points = randomStroke(seededRandom(seed), { width: SIZE, height: SIZE, count: 12, margin: 8 })
      await quar.setBrush({ size: 6, color: RED })
      await quar.setTool('brush')
      await quar.stroke(points)

      const pixels = await quar.readLayer(layer)
      for (const p of points) {
        expect(pixels.at(Math.floor(p.x), Math.floor(p.y)), `input point (${p.x}, ${p.y})`).toMatchColor(RED, 2)
      }
      // The spline can bulge a little past the polyline; 12 px is well clear of a 3 px radius.
      for (const { x, y, color } of pixels.pixels()) {
        if (distanceToPath(x, y, points) > 12) expect(color[3], `stray paint at (${x}, ${y})`).toBe(0)
      }
    })
  }

  test('a stroke reaches the point where the pen lifts', async ({ quar }) => {
    const info = await quar.open({ width: SIZE, height: SIZE })
    expectKnownBug({ id: 'F101', fixedIn: 'M3.3', summary: 'no stamp is placed at the pen-up point, so strokes end early' }, info)
    const layer = await quar.baseLayerId()
    // Wide spacing makes the gap obvious: stamps land every 5 px, so the last
    // one before the pen lifts at x = 40 is at x = 38.
    await quar.setBrush({ size: 10, spacing: 0.5, color: RED })
    await quar.setTool('brush')
    await quar.stroke(line({ x: 8, y: 32 }, { x: 40, y: 32 }))

    const pixels = await quar.readLayer(layer)
    expect(pixels.at(43, 32), '3.5 px past the last point, inside the 5 px radius').toMatchColor(RED, 2)
  })

  test('stroke opacity caps the alpha of a single stroke', async ({ quar }) => {
    const info = await quar.open({ width: SIZE, height: SIZE })
    expectKnownBug({ id: 'F22', fixedIn: 'M3.4', summary: 'opacity behaves like flow; overlapping stamps build up' }, info)
    const layer = await quar.baseLayerId()
    await quar.setBrush({ size: 10, opacity: 0.5, color: RED })
    await quar.setTool('brush')
    const path = line({ x: 8, y: 32 }, { x: 56, y: 32 })
    await quar.stroke(path)

    const pixels = await quar.readLayer(layer)
    expect(pixels.maxAlpha(), 'highest alpha anywhere in a 50% stroke').toBeLessThanOrEqual(128 + 3)
    expect(pixels.at(32, 32), 'core of the stroke').toMatchColor([255, 0, 0, 128], 3)
  })
})

test.describe('undo and redo', () => {
  test('undo removes a stroke completely', async ({ quar }) => {
    await quar.open({ width: SIZE, height: SIZE })
    const layer = await quar.baseLayerId()
    const before = await quar.readLayer(layer)
    await quar.setBrush({ size: 6, color: RED })
    await quar.setTool('brush')
    await quar.stroke(randomStroke(seededRandom(7), { width: SIZE, height: SIZE, count: 10, margin: 8 }))
    expect(await quar.readLayer(layer)).not.toMatchPixels(before)

    expect(await quar.undo()).toBe(true)
    expect(await quar.readLayer(layer)).toMatchPixels(before)
  })

  test('redo restores a stroke exactly', async ({ quar }) => {
    const info = await quar.open({ width: SIZE, height: SIZE })
    expectKnownBug(
      {
        id: 'F07',
        fixedIn: 'M0.5',
        summary: 'premultiplied WebGL snapshots are re-uploaded as straight alpha, darkening anti-aliased edges',
        backends: ['webgl2'],
      },
      info,
    )
    const layer = await quar.baseLayerId()
    await quar.setBrush({ size: 6, color: RED })
    await quar.setTool('brush')
    await quar.stroke(randomStroke(seededRandom(7), { width: SIZE, height: SIZE, count: 10, margin: 8 }))
    const painted = await quar.readLayer(layer)

    await quar.undo()
    expect(await quar.redo()).toBe(true)
    expect(await quar.readLayer(layer)).toMatchPixels(painted, 1)
  })

  test('undo restores semi-transparent pixels exactly', async ({ quar }) => {
    const info = await quar.open({ width: SIZE, height: SIZE })
    expectKnownBug(
      {
        id: 'F07',
        fixedIn: 'M0.5',
        summary: 'premultiplied WebGL snapshots are re-uploaded as straight alpha, darkening semi-transparent pixels',
        backends: ['webgl2'],
      },
      info,
    )
    const layer = await quar.baseLayerId()
    await quar.fillRect(layer, [40, 60, 220, 128], { x: 0, y: 0, width: SIZE, height: 16 })
    const before = await quar.readLayer(layer)
    await quar.setBrush({ size: 6, color: RED })
    await quar.setTool('brush')
    await quar.stroke(line({ x: 8, y: 40 }, { x: 56, y: 40 }))

    await quar.undo()
    expect(await quar.readLayer(layer)).toMatchPixels(before, 1)
  })
})

test.describe('flood fill', () => {
  test('fills the enclosed area with the brush colour, and undo removes the fill', async ({ quar }) => {
    await quar.open({ width: SIZE, height: SIZE })
    const layer = await quar.baseLayerId()
    // A closed 2 px blue frame from (16, 16) to (48, 48)
    for (const r of [
      { x: 16, y: 16, width: 32, height: 2 },
      { x: 16, y: 46, width: 32, height: 2 },
      { x: 16, y: 16, width: 2, height: 32 },
      { x: 46, y: 16, width: 2, height: 32 },
    ]) {
      await quar.fillRect(layer, BLUE, r)
    }
    const before = await quar.readLayer(layer)
    await quar.setBrush({ color: [20, 180, 60, 255] })
    await quar.setTool('fill')
    await quar.tap(32, 32)

    const filled = await quar.readLayer(layer)
    expect(filled.at(32, 32), 'inside').toMatchColor([20, 180, 60, 255])
    expect(filled.at(19, 19), 'inside corner').toMatchColor([20, 180, 60, 255])
    expect(filled.at(16, 30), 'frame').toMatchColor(BLUE)
    expect(filled.at(8, 8)[3], 'outside').toBe(0)

    expect(await quar.undo()).toBe(true)
    expect(await quar.readLayer(layer)).toMatchPixels(before)
  })
})

test.describe('selection', () => {
  const AREA: Rect = { x: 8, y: 12, width: 24, height: 20 }

  test('a rectangle selection covers the dragged rectangle', async ({ quar }) => {
    await quar.open({ width: SIZE, height: SIZE })
    await quar.selectRect(AREA)
    const selection = await quar.selection()
    expect(selection.active).toBe(true)
    expect(selection.bounds).not.toBeNull()
    const b = selection.bounds!
    expect(Math.abs(b.x - AREA.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(b.y - AREA.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(b.width - AREA.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(b.height - AREA.height)).toBeLessThanOrEqual(1)
  })

  test('brush strokes stay inside the selection', async ({ quar }) => {
    const info = await quar.open({ width: SIZE, height: SIZE })
    expectKnownBug({ id: 'F30', fixedIn: 'M4.2', summary: 'brush strokes ignore the selection' }, info)
    const layer = await quar.baseLayerId()
    await quar.selectRect({ x: 0, y: 0, width: 32, height: SIZE })
    await quar.setBrush({ size: 6, color: RED })
    await quar.setTool('brush')
    await quar.stroke(line({ x: 8, y: 32 }, { x: 56, y: 32 }))

    const pixels = await quar.readLayer(layer)
    expect(pixels.at(16, 32), 'inside the selection').toMatchColor(RED, 2)
    expect(pixels.maxAlpha({ x: 34, y: 0, width: 30, height: SIZE }), 'outside the selection').toBe(0)
  })
})

test.describe('alpha lock', () => {
  const PAINT: RGBA = [250, 220, 0, 255]

  /** Fill the left half of the middle band with `content`, lock alpha, and paint across the band. */
  async function paintLocked(quar: import('../support/quar.ts').Quar, content: RGBA) {
    const layer = await quar.baseLayerId()
    await quar.fillRect(layer, content, { x: 0, y: 16, width: 32, height: 32 })
    await quar.setLayerProps(layer, { alphaLock: true })
    await quar.setBrush({ size: 12, color: PAINT })
    await quar.setTool('brush')
    await quar.stroke(line({ x: 4, y: 32 }, { x: 60, y: 32 }))
    return quar.readLayer(layer)
  }

  test('repaints opaque red pixels and leaves empty ones empty', async ({ quar }) => {
    await quar.open({ width: SIZE, height: SIZE })
    const pixels = await paintLocked(quar, RED)
    expect(pixels.at(16, 32), 'painted content').toMatchColor(paintAlphaLocked(RED, PAINT, 1), 3)
    expect(pixels.at(48, 32)[3], 'empty area').toBe(0)
  })

  test('repaints pixels of any colour', async ({ quar }) => {
    const info = await quar.open({ width: SIZE, height: SIZE })
    expectKnownBug({ id: 'F20', fixedIn: 'M3.4', summary: 'alpha lock uses the red channel of the layer as the mask' }, info)
    const pixels = await paintLocked(quar, [0, 0, 255, 255])
    expect(pixels.at(16, 32), 'painted content').toMatchColor(paintAlphaLocked([0, 0, 255, 255], PAINT, 1), 3)
    expect(pixels.at(48, 32)[3], 'empty area').toBe(0)
  })

  test('keeps the alpha of semi-transparent pixels', async ({ quar }) => {
    const info = await quar.open({ width: SIZE, height: SIZE })
    expectKnownBug(
      { id: 'F100', fixedIn: 'M3.4', summary: 'alpha lock draws masked stamps source-over, so partial alpha grows' },
      info,
    )
    // White keeps the red-channel mask (F20) at full strength, isolating this bug.
    const pixels = await paintLocked(quar, [255, 255, 255, 128])
    expect(pixels.at(16, 32), 'painted content').toMatchColor(paintAlphaLocked([255, 255, 255, 128], PAINT, 1), 3)
  })
})
