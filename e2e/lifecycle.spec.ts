/**
 * Engine start-up and shutdown in the real app. The dev server runs React in
 * StrictMode, which mounts components, unmounts them and mounts them again.
 */
import { test, expect } from '@playwright/test'
import { CANVAS, STROKE_PIXELS, canvasShot, changedPixels, drawStroke, waitForEngine } from './support/app.ts'

test('a stroke drawn as soon as the canvas reports ready is painted', async ({ page }) => {
  // Slow each WebGPU adapter request down by one more second than the last.
  // If StrictMode starts an engine and then discards it, that engine finishes
  // starting well before the one that stays (F60).
  await page.addInitScript(() => {
    const gpu: GPU | undefined = navigator.gpu
    if (!gpu) return
    const requestAdapter = gpu.requestAdapter.bind(gpu)
    let calls = 0
    gpu.requestAdapter = async (options?: GPURequestAdapterOptions) => {
      const delay = ++calls * 1000
      await new Promise((resolve) => setTimeout(resolve, delay))
      return requestAdapter(options)
    }
  })
  await page.goto('/')
  test.skip(!(await page.evaluate(() => 'gpu' in navigator)), 'Delaying start-up needs WebGPU')
  await waitForEngine(page)

  const before = await canvasShot(page)
  await drawStroke(page)
  await expect.poll(async () => changedPixels(page, before, await canvasShot(page))).toBeGreaterThan(STROKE_PIXELS)
})

test('the canvas works again after a trip to the Gallery', async ({ page }) => {
  await page.goto('/')
  await waitForEngine(page)

  await page.locator('[data-testid="menu-file"]').click()
  await page.getByRole('menuitem', { name: 'Gallery' }).click()
  await expect(page.locator(CANVAS)).toHaveCount(0)
  await page.getByRole('button', { name: 'New Project' }).click()
  await page.getByRole('dialog', { name: 'New Project' }).getByRole('button', { name: 'Create' }).click()
  await waitForEngine(page)

  // Before M0.4 the engine stayed attached to the old, removed container (F02).
  await expect(page.locator(`${CANVAS} canvas`)).toHaveCount(2)
  const before = await canvasShot(page)
  await drawStroke(page)
  await expect.poll(async () => changedPixels(page, before, await canvasShot(page))).toBeGreaterThan(STROKE_PIXELS)
})

test('explains what is missing when neither WebGPU nor WebGL 2 can start', async ({ page }) => {
  await page.addInitScript(() => {
    delete (Navigator.prototype as { gpu?: unknown }).gpu
    const getContext = HTMLCanvasElement.prototype.getContext as (
      this: HTMLCanvasElement,
      type: string,
      options?: unknown,
    ) => RenderingContext | null
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl' || type === 'webgpu') return null
      return getContext.call(this, type, options)
    } as typeof HTMLCanvasElement.prototype.getContext
  })
  await page.goto('/')

  const screen = page.getByTestId('engine-error')
  await expect(screen).toBeVisible({ timeout: 30000 })
  await expect(screen).toContainText('WebGPU or WebGL 2')
  await expect(screen.getByRole('button', { name: 'Reload' })).toBeVisible()
})
