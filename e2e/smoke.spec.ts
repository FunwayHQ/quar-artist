import { test, expect } from '@playwright/test'

test.describe('QUAR Artist — Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for loading overlay to disappear (engine init)
    await page.waitForSelector('[data-testid="canvas-container"]', { timeout: 15000 })
  })

  test('app loads with canvas and title bar', async ({ page }) => {
    await expect(page.locator('[data-testid="canvas-container"]')).toBeVisible()
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

  test('draw stroke on canvas without errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    const canvas = page.locator('[data-testid="canvas-container"]')
    const box = await canvas.boundingBox()
    if (!box) throw new Error('Canvas not found')

    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    // Simulate a stroke: pointerdown → pointermove → pointerup
    await page.mouse.move(cx - 50, cy)
    await page.mouse.down()
    for (let i = -50; i <= 50; i += 10) {
      await page.mouse.move(cx + i, cy + Math.sin(i / 10) * 20)
    }
    await page.mouse.up()

    expect(errors).toHaveLength(0)
  })

  test('add layer increases layer count', async ({ page }) => {
    const layersBefore = await page.locator('[data-testid="layer-row"]').count()
    await page.locator('[data-testid="add-layer-btn"]').click()
    const layersAfter = await page.locator('[data-testid="layer-row"]').count()
    expect(layersAfter).toBe(layersBefore + 1)
  })

  test('undo and redo with keyboard shortcuts', async ({ page }) => {
    const canvas = page.locator('[data-testid="canvas-container"]')
    const box = await canvas.boundingBox()
    if (!box) throw new Error('Canvas not found')

    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    // Draw a stroke
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 30, cy + 30)
    await page.mouse.up()

    // Wait for stroke to complete
    await page.waitForTimeout(200)

    // Undo
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(200)

    // Redo
    await page.keyboard.press('Control+Shift+z')
    await page.waitForTimeout(200)

    // No crashes — success
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
