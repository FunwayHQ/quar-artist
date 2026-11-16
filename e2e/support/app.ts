/**
 * Helpers for tests that drive the real app (as opposed to the engine harness).
 */
import { expect, type Page } from '@playwright/test'
import type { RenderBackend } from '../../src/types/engine.ts'

export const CANVAS = '[data-testid="canvas-container"]'

/** Long enough for a cold browser's first WebGPU adapter request (see playwright.config.ts). */
const ENGINE_READY_TIMEOUT = 45000

/** Wait until the engine reports ready, and return the backend it renders with. */
export async function waitForEngine(page: Page): Promise<RenderBackend> {
  const canvas = page.locator(CANVAS)
  await expect(canvas).toHaveAttribute('data-engine-ready', 'true', { timeout: ENGINE_READY_TIMEOUT })
  const renderer = await canvas.getAttribute('data-renderer')
  if (renderer !== 'webgl2' && renderer !== 'webgpu') throw new Error(`Unexpected data-renderer: ${renderer}`)
  return renderer
}

/** Screenshot of the canvas area, taken with the pointer off the canvas. */
export async function canvasShot(page: Page): Promise<Buffer> {
  await page.mouse.move(0, 0)
  return page.locator(CANVAS).screenshot({ animations: 'disabled' })
}

/** Pixels that differ by more than `threshold` on any colour channel (-1 if the sizes differ). */
export async function changedPixels(page: Page, a: Buffer, b: Buffer, threshold = 24): Promise<number> {
  return page.evaluate(
    async ([a64, b64, t]) => {
      const decode = async (base64: string) => {
        const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob()
        const bitmap = await createImageBitmap(blob)
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
      }
      const [da, db] = await Promise.all([decode(a64), decode(b64)])
      if (da.length !== db.length) return -1
      let changed = 0
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]))
        if (d > t) changed++
      }
      return changed
    },
    [a.toString('base64'), b.toString('base64'), threshold] as const,
  )
}

/** Drag a wavy mouse stroke across the canvas, centred on `at` (fractions of its width and height; the middle by default). */
export async function drawStroke(page: Page, at = { x: 0.5, y: 0.5 }) {
  const box = await page.locator(CANVAS).boundingBox()
  if (!box) throw new Error('Canvas not found')
  const cx = box.x + box.width * at.x
  const cy = box.y + box.height * at.y
  await page.mouse.move(cx - 80, cy)
  await page.mouse.down()
  for (let i = -80; i <= 80; i += 8) {
    await page.mouse.move(cx + i, cy + Math.sin(i / 12) * 24)
  }
  await page.mouse.up()
}

/** A stroke changes at least this many pixels of the canvas screenshot. */
export const STROKE_PIXELS = 300
