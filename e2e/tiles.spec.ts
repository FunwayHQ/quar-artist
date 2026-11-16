/**
 * The tile store in the real app (plan M1.2): saves land as 256 × 256 tiles,
 * in OPFS where the browser lets the persistence worker write it, otherwise
 * in IndexedDB; unchanged tiles aren't written again; and projects saved the
 * old way, as whole layers, move to tiles at their next save. Saves after the
 * first read back and write only the tiles that changed (plan M1.3).
 */
import { test, expect, type Page } from '@playwright/test'
import { STROKE_PIXELS, canvasShot, changedPixels, drawStroke, waitForEngine } from './support/app.ts'

interface StoredDocument {
  /** Counts the project's saves. */
  seq: number
  backend: 'opfs' | 'idb'
  format: string
  width: number
  height: number
  /** Each layer's tile references, sorted, as the manifest has them. */
  layers: { id: string; refs: string[] }[]
  /** What is actually stored, by layer: OPFS file names, or tileData keys. */
  stored: Record<string, string[]>
  /** Records the project still has in the old layout. */
  oldRecords: number
}

/** A project's saved document as the app stored it, or null before its first save to the tile store. */
function storedDocument(page: Page, projectName: string) {
  return page.evaluate(async (name): Promise<StoredDocument | null> => {
    const request = <T,>(r: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
    const db = await request(indexedDB.open('QuarArtistDB'))
    try {
      const read = (store: string) => db.transaction(store).objectStore(store)
      const projects: { id: string; name: string; deletedAt?: Date }[] = await request(read('projects').getAll())
      const project = projects.find((p) => p.name === name && !p.deletedAt)
      if (!project) throw new Error(`no project named ${name}`)
      const manifest = await request(read('documents').get(project.id))
      const oldRecords =
        (await request(read('layers').index('by-projectId').count(project.id))) +
        (await request(read('tiles').index('by-projectId').count(project.id)))
      if (!manifest) return null

      const stored: Record<string, string[]> = {}
      if (manifest.backend === 'opfs') {
        const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('quar-artist')
        const dir = await root.getDirectoryHandle(`p-${encodeURIComponent(project.id)}`)
        for await (const [dirName, layer] of (dir as unknown as AsyncIterable<[string, FileSystemDirectoryHandle]>)) {
          const files: string[] = []
          for await (const [file] of layer as unknown as AsyncIterable<[string]>) files.push(file)
          stored[decodeURIComponent(dirName.slice(2))] = files.sort()
        }
      } else {
        const range = IDBKeyRange.bound([project.id], [project.id, []])
        const keys = (await request(read('tileData').getAllKeys(range))) as [string, string, string][]
        for (const [, layerId, key] of keys) (stored[layerId] ??= []).push(key)
        for (const keysOfLayer of Object.values(stored)) keysOfLayer.sort()
      }
      return {
        seq: manifest.seq,
        backend: manifest.backend,
        format: manifest.format,
        width: manifest.width,
        height: manifest.height,
        layers: manifest.layers.map((l: { info: { id: string }; tiles: { ref: string }[] }) => ({
          id: l.info.id,
          refs: l.tiles.map((t) => t.ref).sort(),
        })),
        stored,
        oldRecords,
      }
    } finally {
      db.close()
    }
  }, projectName)
}

/** What a manifest's layers say should be stored: the tile references of each layer that has some. */
function expectedStored(doc: StoredDocument) {
  return Object.fromEntries(doc.layers.filter((l) => l.refs.length > 0).map((l) => [l.id, l.refs]))
}

/** Save with Ctrl+S, and wait until the save is committed. */
async function saveNow(page: Page, name: string) {
  const before = (await storedDocument(page, name))?.seq ?? 0
  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await storedDocument(page, name))?.seq ?? 0).toBeGreaterThan(before)
}

/** Pixels of a canvas screenshot within `tolerance` of a colour. */
async function pixelsOfColour(page: Page, shot: Buffer, rgb: [number, number, number], tolerance = 40) {
  return page.evaluate(
    async ([base64, [r, g, b], t]) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
      let count = 0
      for (let i = 0; i < data.length; i += 4) {
        if (Math.abs(data[i] - r) <= t && Math.abs(data[i + 1] - g) <= t && Math.abs(data[i + 2] - b) <= t) count++
      }
      return count
    },
    [shot.toString('base64'), rgb, tolerance] as const,
  )
}

test('a save stores the painted tiles only, and the next keeps the ones that did not change', async ({
  page,
  browserName,
}) => {
  await page.goto('/')
  await waitForEngine(page)
  const before = await canvasShot(page)
  await drawStroke(page)
  await expect.poll(async () => changedPixels(page, before, await canvasShot(page))).toBeGreaterThan(STROKE_PIXELS)
  await saveNow(page, 'Untitled Project')

  const first = (await storedDocument(page, 'Untitled Project'))!
  test.info().annotations.push({ type: 'tile backend', description: `${browserName}: ${first.backend}` })
  expect(first).toMatchObject({ format: 'rgba8-premultiplied-256', width: 1920, height: 1080, oldRecords: 0 })
  // Chromium and Firefox write OPFS from the worker. WebKit's test contexts are
  // private, without OPFS, so the IndexedDB fallback runs in a real browser too.
  expect(first.backend).toBe(browserName === 'webkit' ? 'idb' : 'opfs')
  const [layer] = first.layers
  // The stroke crosses a few of the canvas's 8 × 5 tiles; the empty ones aren't stored.
  expect(layer.refs.length).toBeGreaterThan(0)
  expect(layer.refs.length).toBeLessThan(10)
  expect(first.stored).toEqual(expectedStored(first))

  // A new, empty layer changes no tiles: the painted ones are kept as they are.
  await page.locator('[data-testid="add-layer-btn"]').click()
  await saveNow(page, 'Untitled Project')
  const second = (await storedDocument(page, 'Untitled Project'))!
  expect(second.layers).toHaveLength(2)
  expect(second.layers.find((l) => l.id === layer.id)!.refs).toEqual(layer.refs)
  expect(second.stored).toEqual(expectedStored(second))
})

test('a change is saved by itself, on top of the last save, and opens again as painted (plan M1.3)', async ({ page }) => {
  await page.goto('/')
  await waitForEngine(page)
  let shot = await canvasShot(page)
  await drawStroke(page, { x: 0.5, y: 0.35 })
  await expect.poll(async () => changedPixels(page, shot, await canvasShot(page))).toBeGreaterThan(STROKE_PIXELS)
  await saveNow(page, 'Untitled Project')
  const first = (await storedDocument(page, 'Untitled Project'))!

  // Another stroke, lower down, saved a moment later on its own.
  shot = await canvasShot(page)
  await drawStroke(page, { x: 0.5, y: 0.75 })
  await expect.poll(async () => changedPixels(page, shot, await canvasShot(page))).toBeGreaterThan(STROKE_PIXELS)
  await expect.poll(async () => (await storedDocument(page, 'Untitled Project'))!.seq, { timeout: 15000 }).toBe(first.seq + 1)
  const second = (await storedDocument(page, 'Untitled Project'))!
  const [before] = first.layers
  const [after] = second.layers
  // The first stroke's tiles are kept, and the second's are added.
  expect(after.refs).toEqual(expect.arrayContaining(before.refs))
  expect(after.refs.length).toBeGreaterThan(before.refs.length)
  expect(second.stored).toEqual(expectedStored(second))

  const painted = await canvasShot(page)
  await page.reload()
  await page.getByRole('button', { name: 'Continue Untitled Project' }).click()
  await waitForEngine(page)
  await expect.poll(async () => changedPixels(page, painted, await canvasShot(page))).toBeLessThan(40)
})

test('a project saved before the tile store opens, and moves to tiles at its next save', async ({ page }) => {
  await page.goto('/')
  await waitForEngine(page)
  // As the previous version saved it: a layer record and the layer's whole
  // pixels, a red rectangle on a 64 × 48 canvas.
  await page.evaluate(async () => {
    const width = 64
    const height = 48
    const pixels = new Uint8Array(width * height * 4)
    for (let y = 8; y < 40; y++) for (let x = 8; x < 56; x++) pixels.set([200, 30, 40, 255], (y * width + x) * 4)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('QuarArtistDB')
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const tx = db.transaction(['projects', 'layers', 'tiles'], 'readwrite')
    const now = new Date()
    tx.objectStore('projects').add({
      id: 'saved-before-tiles',
      name: 'Old Painting',
      width,
      height,
      dpi: 72,
      colorSpace: 'srgb',
      createdAt: now,
      updatedAt: now,
      activeLayerId: 'ink',
    })
    tx.objectStore('layers').add({
      projectId: 'saved-before-tiles',
      layerId: 'ink',
      name: 'Ink',
      blendMode: 'normal',
      opacity: 1,
      visible: true,
      locked: false,
      alphaLock: false,
      clippingMask: false,
      order: 0,
    })
    tx.objectStore('tiles').add({ projectId: 'saved-before-tiles', layerId: 'ink', key: 'full', data: pixels.buffer })
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  })

  await page.reload()
  await page.getByRole('button', { name: 'Open Old Painting' }).click()
  await waitForEngine(page)
  await expect.poll(async () => pixelsOfColour(page, await canvasShot(page), [200, 30, 40])).toBeGreaterThan(1000)
  const opened = await canvasShot(page)
  expect(await storedDocument(page, 'Old Painting')).toBeNull()

  await saveNow(page, 'Old Painting')
  const doc = (await storedDocument(page, 'Old Painting'))!
  expect(doc.oldRecords).toBe(0)
  expect(doc).toMatchObject({ width: 64, height: 48 })
  expect(doc.layers).toEqual([{ id: 'ink', refs: [expect.stringMatching(/^0_0_/)] }])
  expect(doc.stored).toEqual(expectedStored(doc))

  await page.reload()
  await page.getByRole('button', { name: 'Open Old Painting' }).click()
  await waitForEngine(page)
  await expect.poll(async () => changedPixels(page, opened, await canvasShot(page))).toBeLessThan(40)
})
