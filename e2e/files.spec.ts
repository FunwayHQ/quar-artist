/**
 * Files on disk in the real app (plan M1.5): Save as .qart… keeps every
 * layer, File › Open… opens the file again, Ctrl+S writes the file a project
 * was saved as, and files dropped anywhere never take the app away.
 *
 * Chromium has the File System Access API. Its pickers show the system's
 * dialogs, which a test can't use, so stand-ins hand out real handles to
 * files in the origin-private file system instead. Firefox and WebKit
 * download the file, and open one through a file input, as their users do.
 */
import { test, expect, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { CANVAS, STROKE_PIXELS, canvasShot, changedPixels, drawStroke, waitForEngine } from './support/app.ts'
import { decodePng } from './support/png.ts'

/** Canvas screenshots of the same document differ by less than this (antialiasing, cursor). */
const SAME = 40
/** How long opening a file may take: the open project is saved and closed first. */
const OPENING = 30000
/** The origin-private folder the stand-in pickers keep files in. */
const FILES = 'e2e-files'

interface DiskFile {
  name: string
  bytes: Buffer
}

/** Chromium's pickers, stood in for (see above). The open picker hands out the file named by `window.__openFile`. */
async function standInPickers(page: Page) {
  await page.addInitScript((folder) => {
    const dir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(folder, { create: true })
    Object.assign(window, {
      showSaveFilePicker: async ({ suggestedName }: { suggestedName: string }) =>
        (await dir()).getFileHandle(suggestedName, { create: true }),
      showOpenFilePicker: async () => [await (await dir()).getFileHandle((window as unknown as { __openFile: string }).__openFile)],
    })
  }, FILES)
}

/** A file the stand-in pickers keep. */
async function fileOnDisk(page: Page, name: string): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ([folder, fileName]) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder)
      const bytes = new Uint8Array(await (await (await dir.getFileHandle(fileName)).getFile()).arrayBuffer())
      let text = ''
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return btoa(text)
    },
    [FILES, name] as const,
  )
  return Buffer.from(base64, 'base64')
}

async function menu(page: Page, name: RegExp) {
  await page.locator('[data-testid="menu-file"]').click()
  await page.getByRole('menuitem', { name }).click()
}

/** File › Save as .qart…, and the file it made: written where it was picked (Chromium) or downloaded. */
async function saveAs(page: Page, browserName: string): Promise<DiskFile> {
  if (browserName === 'chromium') {
    await menu(page, /^Save as \.qart/)
    await expect(page.getByText('Saved “Untitled Project” to “Untitled Project.qart”').first()).toBeVisible()
    return { name: 'Untitled Project.qart', bytes: await fileOnDisk(page, 'Untitled Project.qart') }
  }
  const [download] = await Promise.all([page.waitForEvent('download'), menu(page, /^Save as \.qart/)])
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) }
}

/** File › Open… a file: picked (Chromium) or given to the file input. */
async function open(page: Page, browserName: string, file: DiskFile) {
  if (browserName === 'chromium') {
    await page.evaluate(
      async ([folder, name, base64]) => {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder, { create: true })
        const writable = await (await dir.getFileHandle(name, { create: true })).createWritable()
        await writable.write(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)))
        await writable.close()
        ;(window as unknown as { __openFile: string }).__openFile = name
      },
      [FILES, file.name, file.bytes.toString('base64')] as const,
    )
    await menu(page, /^Open\.\.\./)
    return
  }
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), menu(page, /^Open\.\.\./)])
  await chooser.setFiles({ name: file.name, mimeType: 'application/octet-stream', buffer: file.bytes })
}

/** Paint a stroke and wait until it shows. */
async function paint(page: Page, at?: { x: number; y: number }) {
  const before = await canvasShot(page)
  await drawStroke(page, at)
  await expect.poll(async () => changedPixels(page, before, await canvasShot(page))).toBeGreaterThan(STROKE_PIXELS)
}

/** Pixels with any alpha in a .qart file's layers. */
async function paintedPixels(bytes: Buffer): Promise<number> {
  const zip = await JSZip.loadAsync(bytes)
  let n = 0
  for (const entry of Object.values(zip.files)) {
    if (!entry.name.startsWith('layers/')) continue
    const data = await entry.async('uint8array')
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++
  }
  return n
}

function storedProjectCount(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('QuarArtistDB')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const all = request.result.transaction('projects').objectStore('projects').getAll()
          all.onerror = () => reject(all.error)
          all.onsuccess = () => {
            request.result.close()
            resolve(all.result.filter((p) => !p.deletedAt).length)
          }
        }
      }),
  )
}

/**
 * Drop files on an element, as the browser does: drag over it, then drop.
 * Images are drawn in the page (32 × 32, blue). True when the page took the
 * drop, so the browser didn't open the file in its place.
 */
function drop(page: Page, selector: string, files: { name: string; type?: string; base64?: string; image?: true }[]) {
  return page.evaluate(
    async ([target, list]) => {
      const transfer = new DataTransfer()
      for (const f of list) {
        let data: Blob
        if (f.image) {
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = 32
          const ctx = canvas.getContext('2d')!
          ctx.fillStyle = '#0000ff'
          ctx.fillRect(0, 0, 32, 32)
          data = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
        } else {
          data = new Blob([Uint8Array.from(atob(f.base64 ?? ''), (c) => c.charCodeAt(0))])
        }
        transfer.items.add(new File([data], f.name, { type: f.type ?? '' }))
      }
      const el = document.querySelector(target)!
      const fire = (type: string) => {
        const event = new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true })
        el.dispatchEvent(event)
        return event.defaultPrevented
      }
      fire('dragenter')
      return fire('dragover') && fire('drop')
    },
    [selector, files] as const,
  )
}

/** A .qart file made outside the app: a 64 × 64 document whose one layer, "Red", is opaque red. */
async function redSquare(): Promise<string> {
  const zip = new JSZip()
  const pixels = new Uint8Array(64 * 64 * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set([255, 0, 0, 255], i)
  zip.file('layers/red.bin', pixels)
  const now = new Date().toISOString()
  zip.file(
    'manifest.json',
    JSON.stringify({
      version: '1.0',
      app: 'quar-artist',
      canvas: { width: 64, height: 64, dpi: 144, colorSpace: 'srgb' },
      layers: [
        {
          id: 'red',
          name: 'Red',
          blendMode: 'normal',
          opacity: 1,
          visible: true,
          locked: false,
          alphaLock: false,
          clippingMask: false,
          order: 0,
          dataFile: 'layers/red.bin',
        },
      ],
      activeLayerId: 'red',
      createdAt: now,
      updatedAt: now,
    }),
  )
  return zip.generateAsync({ type: 'base64', compression: 'DEFLATE' })
}

test('a project saved as a .qart file opens again from it, with every layer, pixel for pixel', async ({ page, browserName }) => {
  test.slow()
  if (browserName === 'chromium') await standInPickers(page)
  await page.goto('/')
  await waitForEngine(page)
  await paint(page, { x: 0.35, y: 0.4 })
  await page.locator('[data-testid="add-layer-btn"]').click()
  await paint(page, { x: 0.6, y: 0.65 })
  const painted = await canvasShot(page)

  const file = await saveAs(page, browserName)

  expect(file.name).toBe('Untitled Project.qart')
  const zip = await JSZip.loadAsync(file.bytes)
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('text'))
  expect(manifest.canvas).toMatchObject({ width: 1920, height: 1080 })
  expect(manifest.layers.map((l: { name: string }) => l.name)).toEqual(['Layer 1', 'Layer 2'])
  // Compressed: far smaller than the two layers' 16 MB of pixels.
  expect(file.bytes.length).toBeLessThan(1_000_000)

  // Changed since, so the canvas can only match the file once the file is open.
  await paint(page, { x: 0.5, y: 0.25 })
  expect(await changedPixels(page, painted, await canvasShot(page))).toBeGreaterThan(STROKE_PIXELS)
  const before = await page.locator(CANVAS).elementHandle()

  await open(page, browserName, file)

  // A project of its own, next to the one it was saved from, on a canvas of its own.
  await expect.poll(() => storedProjectCount(page), { timeout: OPENING }).toBe(2)
  await page.waitForFunction((canvas) => !canvas?.isConnected, before, { timeout: OPENING })
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('Untitled Project', { timeout: OPENING })
  await waitForEngine(page)
  await expect.poll(async () => changedPixels(page, painted, await canvasShot(page)), { timeout: 20000 }).toBeLessThan(SAME)
  await expect(page.locator('[data-testid="layer-row"]')).toHaveCount(2)
})

test('Ctrl+S writes the file a project was saved as, also after a reload, and leaves it once another program wrote it', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Only Chromium can write a file again: the File System Access API')
  test.slow()
  await standInPickers(page)
  await page.goto('/')
  await waitForEngine(page)
  await paint(page)
  const saved = await saveAs(page, browserName)
  const first = await paintedPixels(saved.bytes)
  expect(first).toBeGreaterThan(0)

  await paint(page, { x: 0.3, y: 0.7 })
  await page.keyboard.press('Control+s')
  await expect.poll(async () => paintedPixels(await fileOnDisk(page, saved.name)), { timeout: 15000 }).toBeGreaterThan(first)
  const second = await paintedPixels(await fileOnDisk(page, saved.name))

  // The project keeps its file: after a reload, Ctrl+S writes it again.
  await page.reload()
  await page.getByRole('button', { name: 'Continue Untitled Project' }).click()
  await waitForEngine(page)
  await paint(page, { x: 0.7, y: 0.3 })
  await page.keyboard.press('Control+s')
  await expect.poll(async () => paintedPixels(await fileOnDisk(page, saved.name)), { timeout: 15000 }).toBeGreaterThan(second)
  await expect(page.getByText('Saved “Untitled Project” to “Untitled Project.qart”').first()).toBeVisible()

  // Another program writes the file: it may have work the project doesn't, so Ctrl+S leaves it.
  const elsewhere = await page.evaluate(async ([folder, name]) => {
    const handle = await (await (await navigator.storage.getDirectory()).getDirectoryHandle(folder)).getFileHandle(name)
    const writable = await handle.createWritable()
    await writable.write('written by another program')
    await writable.close()
    return (await handle.getFile()).size
  }, [FILES, saved.name] as const)
  await paint(page, { x: 0.5, y: 0.5 })
  await page.keyboard.press('Control+s')
  await expect(page.getByText(/^Saved “Untitled Project” in the browser, but not to “Untitled Project.qart”: it may have changed/)).toBeVisible()
  expect((await fileOnDisk(page, saved.name)).toString()).toBe('written by another program')
  expect(elsewhere).toBe('written by another program'.length)
})

test('files dropped anywhere never take the app away: images become layers, a .qart file opens, others are refused', async ({ page }) => {
  test.slow()
  await page.goto('/')
  await waitForEngine(page)
  const url = page.url()
  const rows = page.locator('[data-testid="layer-row"]')
  await expect(rows).toHaveCount(1)

  // Dropped on the title bar: refused, and kept from opening in the tab.
  expect(await drop(page, '[data-testid="title-bar"]', [{ name: 'notes.txt', type: 'text/plain', base64: btoa('hi') }])).toBe(true)
  await expect(page.getByText("“notes.txt” isn't a .qart file or an image")).toBeVisible()

  // An image dropped on the Layers panel: a layer of its own.
  expect(await drop(page, '[data-testid="layers-panel"]', [{ name: 'dot.png', type: 'image/png', image: true }])).toBe(true)
  await expect(rows).toHaveCount(2)
  await expect(page.getByText('Imported "dot.png" (32×32)')).toBeVisible()

  // A .qart file dropped on the canvas: it opens as a project, once the open one is saved.
  expect(await drop(page, CANVAS, [{ name: 'Square.qart', base64: await redSquare() }])).toBe(true)
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('Square', { timeout: OPENING })
  await expect(rows).toHaveCount(1)
  await expect(rows.first().getByRole('textbox', { name: /^Layer name/ })).toHaveValue('Red')
  await waitForEngine(page)
  // Shown at 100%: the middle of the canvas is the red square.
  await expect
    .poll(async () => {
      const shot = decodePng(await canvasShot(page))
      const [r, g, b] = shot.at(Math.floor(shot.width / 2), Math.floor(shot.height / 2))
      return r > 200 && g < 40 && b < 40
    }, { timeout: 20000 })
    .toBe(true)
  expect(await storedProjectCount(page)).toBe(2)
  expect(page.url()).toBe(url)
})
