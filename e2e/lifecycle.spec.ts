/**
 * Engine start-up in the real app. The dev server runs React in StrictMode,
 * which mounts the engine, unmounts it and mounts it again.
 */
import { test, expect } from '@playwright/test'
import { STROKE_PIXELS, canvasShot, changedPixels, drawStroke, waitForEngine } from './support/app.ts'
import { expectKnownBug } from './support/knownBugs.ts'

test('a stroke drawn as soon as the canvas reports ready is painted', async ({ page }) => {
  // Slow each WebGPU adapter request down by one more second than the last.
  // The engine that StrictMode discards then finishes starting about two
  // seconds before the one that stays.
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
  const backend = await waitForEngine(page)
  expectKnownBug(
    {
      id: 'F60',
      fixedIn: 'M0.4',
      summary: 'the engine that StrictMode discards reports ready while the one that stays is still starting, so input is lost',
    },
    { backend },
  )

  const before = await canvasShot(page)
  await drawStroke(page)
  await expect.poll(async () => changedPixels(page, before, await canvasShot(page))).toBeGreaterThan(STROKE_PIXELS)
})
