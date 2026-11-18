/**
 * Files on disk in the real app (plans M1.5 to M1.7): Save as .qart… keeps
 * every layer, File › Open… opens the file again, Ctrl+S writes the file a
 * project was saved as, files dropped anywhere never take the app away, a
 * file with damaged tiles opens with them transparent, and PSD files export
 * with every layer and open with theirs.
 *
 * Chromium has the File System Access API. Its pickers show the system's
 * dialogs, which a test can't use, so stand-ins hand out real handles to
 * files in the origin-private file system instead. Firefox and WebKit
 * download the file, and open one through a file input, as their users do.
 */
import { test, expect, type Page } from '@playwright/test'
import { unzipSync, zipSync, strToU8 } from 'fflate'
import { readFile } from 'node:fs/promises'
import { CANVAS, STROKE_PIXELS, canvasShot, changedPixels, drawStroke, waitForEngine } from './support/app.ts'
import { decodePng } from './support/png.ts'
import { readPsd } from '../src/io/formats/psd/agPsd.ts'

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

/** A file the stand-in pickers keep, as it is once any write to it is done. */
async function fileOnDisk(page: Page, name: string): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ([folder, fileName]) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder)
      let bytes: Uint8Array | null = null
      // A File is a snapshot: one the app writes over while it is read can't be read, and is read again.
      for (let tries = 0; !bytes; tries++) {
        try {
          bytes = new Uint8Array(await (await (await dir.getFileHandle(fileName)).getFile()).arrayBuffer())
        } catch (err) {
          if ((err as DOMException).name !== 'NotReadableError' || tries >= 50) throw err
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }
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

/** A .qart file's entries, unpacked. */
function entries(bytes: Buffer): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(bytes))
}

/** Pixels with any alpha in a .qart file's tiles. */
async function paintedPixels(bytes: Buffer): Promise<number> {
  let n = 0
  for (const [name, data] of Object.entries(entries(bytes))) {
    if (!name.startsWith('tiles/')) continue
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++
  }
  return n
}

/** A tile of a .qart file (docs/qart-format.md): 256 × 256 px, premultiplied, the top left `width` × `height` of it `rgba`. */
function tile(width: number, height: number, rgba: readonly number[]): Uint8Array {
  const data = new Uint8Array(256 * 256 * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(rgba, (y * 256 + x) * 4)
  return data
}

/** A version 1 manifest of a document of one layer per id, bottom first, the last selected. */
function manifest(width: number, height: number, layers: { id: string; name: string }[]) {
  return {
    format: 'qart',
    formatVersion: 1,
    app: { name: 'A test', version: '1' },
    name: 'Made elsewhere',
    canvas: { width, height, dpi: 144, colorSpace: 'srgb' },
    tiles: { size: 256, format: 'rgba8', alpha: 'premultiplied', codec: 'raw' },
    layers: layers.map(({ id, name }) => ({
      type: 'layer',
      id,
      name,
      blendMode: 'normal',
      opacity: 1,
      visible: true,
      locked: false,
      alphaLock: false,
      clippingMask: false,
    })),
    activeLayerId: layers[layers.length - 1].id,
    guides: null,
    thumbnail: null,
    timelapse: null,
  }
}

/** Give an entry of a ZIP archive a checksum its data doesn't have, in the central directory, which readers go by. */
function breakChecksum(zip: Uint8Array, name: string): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  for (let at = 0; at + 46 <= zip.length; at++) {
    if (view.getUint32(at, true) !== 0x02014b50) continue
    const length = view.getUint16(at + 28, true)
    if (new TextDecoder().decode(zip.subarray(at + 46, at + 46 + length)) === name) {
      view.setUint32(at + 16, view.getUint32(at + 16, true) ^ 0xffffffff, true)
      return zip
    }
  }
  throw new Error(`no entry ${name}`)
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

/** One of the PSD files Photoshop saved (e2e/fixtures/psd), base64-encoded. */
async function psdFixture(name: string): Promise<string> {
  return base64(await readFile(new URL(`./fixtures/psd/${name}.psd`, import.meta.url)))
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
function redSquare(): string {
  return base64(
    zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest(64, 64, [{ id: 'red', name: 'Red' }]))),
      'tiles/red/0_0.raw': tile(64, 64, [255, 0, 0, 255]),
    }),
  )
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
  // Version 1 of the format (docs/qart-format.md), as other programs can read it.
  const unpacked = entries(file.bytes)
  const written = JSON.parse(new TextDecoder().decode(unpacked['manifest.json']))
  expect(written).toMatchObject({
    format: 'qart',
    formatVersion: 1,
    name: 'Untitled Project',
    canvas: { width: 1920, height: 1080 },
    tiles: { size: 256, alpha: 'premultiplied', codec: 'raw' },
    thumbnail: 'thumbnail.png',
  })
  expect(written.layers.map((l: { name: string }) => l.name)).toEqual(['Layer 1', 'Layer 2'])
  expect([...unpacked['thumbnail.png'].subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  // Only tiles with paint in them: a stroke is in a few of the 8 × 5 of each layer.
  const tiles = Object.keys(unpacked).filter((name) => name.startsWith('tiles/'))
  expect(tiles.length).toBeGreaterThan(1)
  expect(tiles.length).toBeLessThan(20)
  for (const name of tiles) expect(unpacked[name].length).toBe(256 * 256 * 4)
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
  await expect(page.getByText("“notes.txt” isn't a .qart or PSD file, or an image")).toBeVisible()

  // An image dropped on the Layers panel: a layer of its own.
  expect(await drop(page, '[data-testid="layers-panel"]', [{ name: 'dot.png', type: 'image/png', image: true }])).toBe(true)
  await expect(rows).toHaveCount(2)
  await expect(page.getByText('Imported "dot.png" (32×32)')).toBeVisible()

  // A .qart file dropped on the canvas: it opens as a project, once the open one is saved.
  expect(await drop(page, CANVAS, [{ name: 'Square.qart', base64: redSquare() }])).toBe(true)
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

test('a .qart file with a damaged tile opens with it transparent, and says so (plan M1.6)', async ({ page }) => {
  test.slow()
  await page.goto('/')
  await waitForEngine(page)
  // 512 × 256: a red tile, then one whose checksum is wrong.
  const zip = zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest(512, 256, [{ id: 'paint', name: 'Paint' }]))),
    'tiles/paint/0_0.raw': tile(256, 256, [255, 0, 0, 255]),
    'tiles/paint/1_0.raw': tile(256, 256, [0, 0, 255, 255]),
  })

  expect(await drop(page, CANVAS, [{ name: 'Damaged.qart', base64: base64(breakChecksum(zip, 'tiles/paint/1_0.raw')) }])).toBe(true)

  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('Damaged', { timeout: OPENING })
  await expect(page.getByText("Part of “Damaged.qart” couldn't be read and shows as transparent (1 tile of 256 × 256 px)")).toBeVisible()
  await waitForEngine(page)
  // At 100%, the canvas's middle is where the two tiles meet: red on the left, nothing blue on the right.
  await expect
    .poll(async () => {
      const shot = decodePng(await canvasShot(page))
      const [lr, lg, lb] = shot.at(Math.floor(shot.width / 2) - 40, Math.floor(shot.height / 2))
      const [rr, rg, rb] = shot.at(Math.floor(shot.width / 2) + 40, Math.floor(shot.height / 2))
      return lr > 200 && lg < 40 && lb < 40 && !(rr < 60 && rg < 60 && rb > 200)
    }, { timeout: 20000 })
    .toBe(true)
})

test('Export… as PSD keeps every layer and the picture, for Photoshop and other apps (plan M1.7)', async ({ page }) => {
  test.slow()
  await page.goto('/')
  await waitForEngine(page)
  await paint(page, { x: 0.35, y: 0.4 })
  await page.locator('[data-testid="add-layer-btn"]').click()
  await paint(page, { x: 0.6, y: 0.65 })

  await menu(page, /^Export/)
  const dialog = page.getByRole('dialog', { name: 'Export' })
  await dialog.getByRole('button', { name: 'PSD', exact: true }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export PSD' }).click()])

  expect(download.suggestedFilename()).toBe('Untitled Project.psd')
  await expect(page.getByText('Exported “Untitled Project.psd”')).toBeVisible()
  const psd = readPsd(await readFile(await download.path()), { useImageData: true, skipThumbnail: true })
  expect(psd).toMatchObject({ width: 1920, height: 1080 })
  expect(psd.imageResources?.resolutionInfo).toMatchObject({ horizontalResolution: 72, horizontalResolutionUnit: 'PPI' })
  const [bottom, top] = psd.children!
  expect(psd.children!.map((l) => [l.name, l.blendMode, l.opacity, l.hidden])).toEqual([
    ['Layer 1', 'normal', 1, false],
    ['Layer 2', 'normal', 1, false],
  ])
  // The active layer stays selected.
  expect(psd.imageResources?.layerSelectionIds).toEqual([top.id])
  // Each layer is kept where it was painted: its stroke, not the whole canvas.
  for (const layer of [bottom, top]) {
    expect(layer.right! - layer.left!).toBeGreaterThan(10)
    expect(layer.right! - layer.left!).toBeLessThan(1920)
  }
  expect(bottom.left).toBeLessThan(top.left!)

  // The picture other apps show: both strokes, and nothing where nothing was painted (F09 wrote it black).
  const picture = psd.imageData!
  const alpha = (x: number, y: number) => picture.data[(y * picture.width + x) * 4 + 3]
  expect(alpha(0, 0)).toBe(0)
  let painted = 0
  for (const layer of [bottom, top]) {
    const own = layer.imageData!
    let covered = 0
    let total = 0
    for (let y = 0; y < own.height; y++) {
      for (let x = 0; x < own.width; x++) {
        if (own.data[(y * own.width + x) * 4 + 3] === 0) continue
        total++
        if (alpha(layer.left! + x, layer.top! + y) > 0) covered++
      }
    }
    expect(covered).toBe(total)
    painted += total
  }
  expect(painted).toBeGreaterThan(STROKE_PIXELS)
})

test('a PSD file dropped on the canvas opens as a project with its layers, and one with too many is refused (plan M1.7)', async ({ page }) => {
  test.slow()
  await page.goto('/')
  await waitForEngine(page)
  const rows = page.locator('[data-testid="layer-row"]')
  const blank = await canvasShot(page)

  expect(await drop(page, CANVAS, [{ name: 'groups.psd', base64: await psdFixture('groups') }])).toBe(true)

  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('groups', { timeout: OPENING })
  await expect(page.getByText("Some of “groups.psd” isn't in QUAR Artist yet: its 2 groups became plain layers")).toBeVisible()
  // Top first, as the Layers panel shows them.
  const names = () => rows.getByRole('textbox', { name: /^Layer name/ }).evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value))
  await expect.poll(names).toEqual(['Layer 1', 'Layer 3', 'Layer 0'])
  await waitForEngine(page)
  await expect.poll(async () => changedPixels(page, blank, await canvasShot(page)), { timeout: 20000 }).toBeGreaterThan(STROKE_PIXELS)
  expect(await storedProjectCount(page)).toBe(2)

  // 29 layers, and the app has up to 20: refused before any are read, and the open project stays.
  expect(await drop(page, CANVAS, [{ name: 'Blend modes.psd', base64: await psdFixture('2026-blend-modes') }])).toBe(true)
  await expect(
    page.getByText("Couldn't open “Blend modes.psd”: it has 29 layers, and QUAR Artist can have up to 20. Merge some in the app that made it, then open it again"),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('groups')
  expect(await storedProjectCount(page)).toBe(2)
})
