/**
 * Projects and the Gallery in the real app (plan M1.1): work is saved and
 * opens again, and the Gallery's actions change what is stored.
 */
import { test, expect, type Page } from '@playwright/test'
import { STROKE_PIXELS, canvasShot, changedPixels, drawStroke, waitForEngine } from './support/app.ts'

/** Canvas screenshots of the same document differ by less than this (antialiasing, cursor). */
const SAME = 40

async function openFileMenuItem(page: Page, name: string) {
  await page.locator('[data-testid="menu-file"]').click()
  await page.getByRole('menuitem', { name }).click()
}

async function goToGallery(page: Page) {
  await openFileMenuItem(page, 'Gallery')
  await expect(page.getByText('Your Projects')).toBeVisible()
}

/** The project records in IndexedDB, as the app stored them. */
function storedProjects(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ name: string; updatedAt: number; hasThumbnail: boolean; stacked: boolean }[]>((resolve, reject) => {
        const open = indexedDB.open('QuarArtistDB')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const request = db.transaction('projects').objectStore('projects').getAll()
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            db.close()
            resolve(
              request.result
                .filter((p) => !p.deletedAt)
                .map((p) => ({
                  name: p.name,
                  updatedAt: p.updatedAt.getTime(),
                  hasThumbnail: p.thumbnail?.data instanceof ArrayBuffer && p.thumbnail.data.byteLength > 0,
                  stacked: Boolean(p.stackId),
                })),
            )
          }
        }
      }),
  )
}

async function storedNames(page: Page) {
  return (await storedProjects(page)).map((p) => p.name).sort()
}

/** Paint a stroke and return the canvas as it looks afterwards. */
async function paint(page: Page) {
  const before = await canvasShot(page)
  await drawStroke(page)
  await expect.poll(async () => changedPixels(page, before, await canvasShot(page))).toBeGreaterThan(STROKE_PIXELS)
  return canvasShot(page)
}

async function expectCanvas(page: Page, expected: Buffer) {
  await waitForEngine(page)
  await expect.poll(async () => changedPixels(page, expected, await canvasShot(page))).toBeLessThan(SAME)
}

test('work is saved, and opens again from the Gallery and after a reload', async ({ page }) => {
  await page.goto('/')
  await waitForEngine(page)
  const painted = await paint(page)

  await goToGallery(page)
  const card = page.getByRole('article', { name: 'Untitled Project' })
  await expect(card.locator('img')).toHaveAttribute('src', /^blob:/)

  await page.getByRole('button', { name: 'Open Untitled Project' }).click()
  await expectCanvas(page, painted)

  await page.reload()
  await page.getByRole('button', { name: 'Continue Untitled Project' }).click()
  await expectCanvas(page, painted)
})

test('changes are saved a moment after the last one, without leaving the canvas', async ({ page }) => {
  await page.goto('/')
  await waitForEngine(page)
  const [created] = await storedProjects(page)
  const painted = await paint(page)

  await expect.poll(async () => (await storedProjects(page))[0].updatedAt, { timeout: 15000 }).toBeGreaterThan(created.updatedAt)
  expect((await storedProjects(page))[0].hasThumbnail).toBe(true)

  await page.reload()
  await page.getByRole('button', { name: 'Continue Untitled Project' }).click()
  await expectCanvas(page, painted)
})

test('the title bar says when changes wait to be saved, and when they are (plan M1.3)', async ({ page }) => {
  await page.goto('/')
  await waitForEngine(page)
  const status = page.getByTestId('save-status')
  // Every status it shows, in order.
  await page.evaluate(() => {
    const seen: string[] = []
    Object.assign(window, { __saveStatuses: seen })
    new MutationObserver(() => {
      const shown = document.querySelector<HTMLElement>('[data-testid="save-status"]')?.dataset.status
      if (shown && seen.at(-1) !== shown) seen.push(shown)
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-status'] })
  })
  await expect(status).toHaveCount(0)

  await paint(page)
  await expect(status).toHaveText('Saved', { timeout: 15000 })
  const seen = await page.evaluate(() => (window as unknown as { __saveStatuses: string[] }).__saveStatuses)
  expect(seen[0]).toBe('pending')
  expect(seen.at(-1)).toBe('saved')
  expect(seen).not.toContain('error')
})

test('leaving with changes not saved yet asks first, and saves them at once (plan M1.3)', async ({ page }) => {
  await page.goto('/')
  await waitForEngine(page)
  /** Fire beforeunload as leaving the page does: whether the app asks to stay, and when. */
  const leave = () =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return { asks: event.defaultPrevented, at: performance.now() }
    })
  expect((await leave()).asks).toBe(false)
  await page.evaluate(() => {
    new MutationObserver((_, observer) => {
      if (document.querySelector<HTMLElement>('[data-testid="save-status"]')?.dataset.status !== 'saved') return
      Object.assign(window, { __savedAt: performance.now() })
      observer.disconnect()
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-status'] })
  })

  await page.locator('[data-testid="add-layer-btn"]').click()
  const left = await leave()
  expect(left.asks).toBe(true)
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 15000 })
  // Well before the two seconds a save otherwise waits after the last change.
  const savedAt = await page.evaluate(() => (window as unknown as { __savedAt: number }).__savedAt)
  expect(savedAt - left.at).toBeLessThan(1500)
  expect((await leave()).asks).toBe(false)
})

test('opening a project and leaving it unchanged keeps its modified date', async ({ page }) => {
  await page.goto('/')
  await waitForEngine(page)
  await paint(page)
  await goToGallery(page)
  const [saved] = await storedProjects(page)

  await page.getByRole('button', { name: 'Open Untitled Project' }).click()
  await waitForEngine(page)
  await goToGallery(page)

  expect((await storedProjects(page))[0].updatedAt).toBe(saved.updatedAt)
})

test('New Project starts empty, and the last project keeps its work', async ({ page }) => {
  await page.goto('/')
  await waitForEngine(page)
  const blank = await canvasShot(page)
  const painted = await paint(page)

  await openFileMenuItem(page, 'New')
  const dialog = page.getByRole('dialog', { name: 'New Project' })
  await dialog.getByLabel('Project name').fill('Second')
  await dialog.getByRole('button', { name: 'Create' }).click()
  // The old canvas stays, still ready, while the old project saves. The name
  // changes in the same render that swaps in the new canvas.
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('Second')
  await expectCanvas(page, blank)

  await goToGallery(page)
  expect(await storedNames(page)).toEqual(['Second', 'Untitled Project'])
  await page.getByRole('button', { name: 'Open Untitled Project' }).click()
  await expectCanvas(page, painted)
})

test('New Project refuses a canvas larger than the device supports', async ({ page }) => {
  await page.goto('/')
  await waitForEngine(page)
  await openFileMenuItem(page, 'New')
  const dialog = page.getByRole('dialog', { name: 'New Project' })

  await dialog.getByLabel('Canvas width').fill('9000')

  await expect(dialog.getByRole('alert')).toHaveText('This device supports canvases up to 8192 × 8192 px')
  await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled()
})

test('Ctrl+S saves and says so', async ({ page }) => {
  await page.goto('/')
  await waitForEngine(page)
  await paint(page)
  await page.keyboard.press('Control+s')
  await expect(page.getByText('Saved “Untitled Project”')).toBeVisible()
})

test('a project renamed in the title bar keeps its name', async ({ page }) => {
  await page.goto('/')
  await waitForEngine(page)
  const name = page.getByRole('textbox', { name: 'Project name' })
  await name.fill('Lighthouse')
  await name.press('Enter')

  await goToGallery(page)
  await expect(page.getByRole('article', { name: 'Lighthouse' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('article', { name: 'Lighthouse' })).toBeVisible()
})

test('the Gallery renames, duplicates and deletes projects, with an Undo', async ({ page }) => {
  await page.goto('/')
  await waitForEngine(page)
  await goToGallery(page)

  await page.getByRole('button', { name: 'Actions for Untitled Project' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const input = page.getByRole('textbox', { name: 'Project name' })
  await input.fill('Harbour')
  await input.press('Enter')
  await expect(page.getByRole('article', { name: 'Harbour' })).toBeVisible()

  await page.getByRole('button', { name: 'Actions for Harbour' }).click()
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(page.getByRole('article', { name: 'Harbour copy' })).toBeVisible()
  await expect.poll(() => storedNames(page)).toEqual(['Harbour', 'Harbour copy'])

  // Delete, then Undo.
  await page.getByRole('button', { name: 'Actions for Harbour copy' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(page.getByRole('article', { name: 'Harbour copy' })).toHaveCount(0)
  const toast = page.getByRole('status').filter({ hasText: 'Deleted “Harbour copy”' })
  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByRole('article', { name: 'Harbour copy' })).toBeVisible()

  // Delete for good: the data goes when the toast does.
  await page.getByRole('button', { name: 'Actions for Harbour copy' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await toast.getByRole('button', { name: 'Dismiss' }).click()
  await expect.poll(() => storedNames(page)).toEqual(['Harbour'])

  await page.reload()
  await expect(page.getByRole('article', { name: 'Harbour' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Harbour copy' })).toHaveCount(0)
})

test('a project deleted just before the tab closes is gone next time', async ({ page }) => {
  await page.goto('/')
  await waitForEngine(page)
  await goToGallery(page)
  await page.getByRole('button', { name: 'Actions for Untitled Project' }).click()
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await page.getByRole('button', { name: 'Actions for Untitled Project copy' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()

  await page.reload()
  await expect(page.getByRole('article', { name: 'Untitled Project' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Untitled Project copy' })).toHaveCount(0)
  expect(await storedNames(page)).toEqual(['Untitled Project'])
})

test('projects go into stacks and back out', async ({ page }) => {
  await page.goto('/')
  await waitForEngine(page)
  await goToGallery(page)
  await page.getByRole('button', { name: 'Actions for Untitled Project' }).click()
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(page.getByRole('article', { name: 'Untitled Project copy' })).toBeVisible()

  await page.getByRole('button', { name: 'Actions for Untitled Project copy' }).click()
  await page.getByRole('menuitem', { name: 'Move to Stack…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Move to Stack' })
  await dialog.getByRole('textbox', { name: 'New stack name' }).fill('Studies')
  await dialog.getByRole('button', { name: 'New Stack' }).click()

  const stack = page.getByRole('article', { name: 'Stack Studies' })
  await expect(stack).toContainText('1 project')
  await expect(page.getByRole('article', { name: 'Untitled Project copy' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Open stack Studies' }).click()
  await expect(page.getByRole('navigation', { name: 'Gallery location' })).toContainText('Studies')
  await expect(page.getByRole('article', { name: 'Untitled Project copy' })).toBeVisible()
  await expect(page.getByRole('article', { name: 'Untitled Project', exact: true })).toHaveCount(0)

  // The stack keeps its projects after a reload.
  await page.reload()
  await expect(page.getByRole('article', { name: 'Stack Studies' })).toBeVisible()
  await page.getByRole('button', { name: 'Open stack Studies' }).click()

  // Taking out its only project removes the stack.
  await page.getByRole('button', { name: 'Actions for Untitled Project copy' }).click()
  await page.getByRole('menuitem', { name: 'Remove from Stack' }).click()
  await expect(page.getByRole('article', { name: 'Stack Studies' })).toHaveCount(0)
  await expect(page.getByRole('article', { name: 'Untitled Project copy' })).toBeVisible()
  expect((await storedProjects(page)).some((p) => p.stacked)).toBe(false)
})

test('the Gallery shows how much storage the projects use (plan M1.3)', async ({ page }) => {
  await page.goto('/')
  await waitForEngine(page)
  await paint(page)
  await goToGallery(page)
  await expect(page.getByTestId('storage-usage')).toHaveText(/^\d+(\.\d)? [KMGT]?B of \d+(\.\d)? [KMGT]?B$/)
})

test('the Gallery sorts by name and remembers it', async ({ page }) => {
  await page.goto('/')
  await waitForEngine(page)
  await goToGallery(page)
  await page.getByRole('button', { name: 'Actions for Untitled Project' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.getByRole('textbox', { name: 'Project name' }).fill('Zebra')
  await page.getByRole('textbox', { name: 'Project name' }).press('Enter')
  await page.getByRole('button', { name: 'Actions for Zebra' }).click()
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await page.getByRole('button', { name: 'Actions for Zebra copy' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.getByRole('textbox', { name: 'Project name' }).fill('Aardvark')
  await page.getByRole('textbox', { name: 'Project name' }).press('Enter')

  const names = () => page.getByRole('article').evaluateAll((cards) => cards.map((c) => c.getAttribute('aria-label')))
  await page.getByLabel('Sort projects').selectOption('name')
  await expect.poll(names).toEqual(['Aardvark', 'Zebra'])

  await page.reload()
  await expect(page.getByLabel('Sort projects')).toHaveValue('name')
  await expect.poll(names).toEqual(['Aardvark', 'Zebra'])
})

test('files dropped on the Gallery become projects', async ({ page }) => {
  await page.goto('/')
  await waitForEngine(page)
  await goToGallery(page)

  const dataTransfer = await page.evaluateHandle(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 48
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#c0392b'
    ctx.fillRect(0, 0, 64, 48)
    const png = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
    const transfer = new DataTransfer()
    transfer.items.add(new File([png], 'Swatch.png', { type: 'image/png' }))
    transfer.items.add(new File(['8BPS'], 'scan.psd'))
    return transfer
  })
  const gallery = page.getByText('Your Projects').locator('xpath=ancestor::div[1]')
  await gallery.dispatchEvent('dragover', { dataTransfer })
  await gallery.dispatchEvent('drop', { dataTransfer })

  await expect(page.getByRole('article', { name: 'Swatch' })).toContainText('64×48')
  await expect(page.getByText('Imported “Swatch”')).toBeVisible()
  await expect(page.getByText("“scan.psd”: PSD files can't be opened yet")).toBeVisible()

  await page.getByRole('button', { name: 'Open Swatch' }).click()
  await waitForEngine(page)
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('Swatch')
})
