import { test, expect } from '@playwright/test'
import { CANVAS, STROKE_PIXELS, canvasShot, changedPixels, drawStroke, waitForEngine } from './support/app.ts'

test.describe('QUAR Artist — Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForEngine(page)
  })

  test('app loads with canvas and title bar', async ({ page }) => {
    await expect(page.locator(CANVAS)).toBeVisible()
    await expect(page.locator('[data-testid="title-bar"]')).toBeVisible()
  })

  test('tool switching via toolbar buttons', async ({ page }) => {
    // Click eraser tool
    const eraserBtn = page.locator('[data-testid="tool-eraser"]')
    await eraserBtn.click()
    await expect(eraserBtn).toHaveAttribute('data-active', 'true')

    // Click brush tool
    const brushBtn = page.locator('[data-testid="tool-brush"]')
    await brushBtn.click()
    await expect(brushBtn).toHaveAttribute('data-active', 'true')
    await expect(eraserBtn).not.toHaveAttribute('data-active', 'true')
  })

  test('a stroke paints on the canvas without errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    const before = await canvasShot(page)
    await drawStroke(page)
    await expect.poll(async () => changedPixels(page, before, await canvasShot(page))).toBeGreaterThan(STROKE_PIXELS)
    expect(errors).toHaveLength(0)
  })

  test('add layer increases layer count', async ({ page }) => {
    const layersBefore = await page.locator('[data-testid="layer-row"]').count()
    await page.locator('[data-testid="add-layer-btn"]').click()
    const layersAfter = await page.locator('[data-testid="layer-row"]').count()
    expect(layersAfter).toBe(layersBefore + 1)
  })

  test('undo removes a stroke', async ({ page }) => {
    const before = await canvasShot(page)
    await drawStroke(page)
    await expect.poll(async () => changedPixels(page, before, await canvasShot(page))).toBeGreaterThan(STROKE_PIXELS)

    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(async () => changedPixels(page, before, await canvasShot(page)), { message: 'canvas after undo' })
      .toBe(0)
  })

  test('redo brings a stroke back exactly', async ({ page }) => {
    const before = await canvasShot(page)
    await drawStroke(page)
    await expect.poll(async () => changedPixels(page, before, await canvasShot(page))).toBeGreaterThan(STROKE_PIXELS)
    const painted = await canvasShot(page)

    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(async () => changedPixels(page, before, await canvasShot(page)), { message: 'canvas after undo' })
      .toBe(0)
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect.poll(async () => changedPixels(page, painted, await canvasShot(page)), { message: 'canvas after redo' })
      .toBe(0)
  })

  test('menu navigation — File menu opens and closes', async ({ page }) => {
    const fileMenu = page.locator('[data-testid="menu-file"]')
    await fileMenu.click()

    // A dropdown should appear with menu items
    const dropdown = page.locator('[role="menu"]')
    await expect(dropdown).toBeVisible()

    // Press Escape to close
    await page.keyboard.press('Escape')
    await expect(dropdown).not.toBeVisible()
  })

  test('keyboard shortcuts switch tools', async ({ page }) => {
    // Press 'E' for eraser
    await page.keyboard.press('e')
    await expect(page.locator('[data-testid="tool-eraser"]')).toHaveAttribute('data-active', 'true')

    // Press 'B' for brush
    await page.keyboard.press('b')
    await expect(page.locator('[data-testid="tool-brush"]')).toHaveAttribute('data-active', 'true')

    // Press 'G' for fill
    await page.keyboard.press('g')
    await expect(page.locator('[data-testid="tool-fill"]')).toHaveAttribute('data-active', 'true')

    // Press 'I' for eyedropper
    await page.keyboard.press('i')
    await expect(page.locator('[data-testid="tool-eyedropper"]')).toHaveAttribute('data-active', 'true')
  })
})
