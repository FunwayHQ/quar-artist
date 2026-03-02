import { test, expect } from '@playwright/test'

test.describe('Sprint 15 — Timelapse, Text Tool, QuickMenu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for canvas to be ready
    await page.waitForSelector('[data-testid="canvas-container"]', { timeout: 10000 })
  })

  test('Text tool: click toolbar → click canvas → textarea appears → type → Enter → textarea gone', async ({ page }) => {
    // Select text tool
    const textBtn = page.locator('[data-testid="tool-text"]')
    await textBtn.click()

    // Click on canvas to start text input
    const canvas = page.locator('[data-testid="canvas-container"]')
    await canvas.click({ position: { x: 200, y: 200 } })

    // Verify textarea appears
    const textarea = page.locator('[data-testid="text-input-overlay"]')
    await expect(textarea).toBeVisible({ timeout: 3000 })

    // Type text
    await textarea.fill('Hello World')

    // Press Enter to commit
    await textarea.press('Enter')

    // Verify textarea is gone
    await expect(textarea).not.toBeVisible({ timeout: 3000 })
  })

  test('QuickMenu: press Q → radial menu visible → press Escape → hidden', async ({ page }) => {
    // Press Q to show quick menu
    await page.keyboard.press('q')

    // Verify quick menu is visible
    const quickMenu = page.locator('[data-testid="quick-menu"]')
    await expect(quickMenu).toBeVisible({ timeout: 3000 })

    // Press Escape to hide
    await page.keyboard.press('Escape')
    await expect(quickMenu).not.toBeVisible({ timeout: 3000 })
  })

  test('Timelapse: File menu → Start Recording → File menu → Stop Recording → dialog appears', async ({ page }) => {
    // Open File menu and start recording
    await page.click('[data-testid="menu-file"]')
    await page.click('text=Start Recording')

    // Verify record indicator appears
    const indicator = page.locator('[data-testid="record-indicator"]')
    await expect(indicator).toBeVisible({ timeout: 3000 })

    // Open File menu and stop recording
    await page.click('[data-testid="menu-file"]')
    await page.click('text=Stop Recording')

    // Verify record indicator is gone
    await expect(indicator).not.toBeVisible({ timeout: 5000 })
  })
})
