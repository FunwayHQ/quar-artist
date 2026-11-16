import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { getDB, resetDB } from '../../db/schema.ts'
import type { LayerInfo } from '../../types/layer.ts'
import { unpremultiply } from '../../utils/alpha.ts'
import { sameBytes } from '../../test/bytes.ts'
import { FakeDirectory } from '../../test/fakeOpfs.ts'
import { FakeLocks } from '../../test/fakeLocks.ts'
import { IdbTileBackend } from './IdbTileBackend.ts'
import { OpfsTileBackend, openOpfsRoot } from './OpfsTileBackend.ts'
import { TileStore, openBackends, type SaveLayer } from './TileStore.ts'
import { TILE_FORMAT, TILE_SIZE } from './tileFormat.ts'

const W = 600
const H = 300
// 600 × 300 is 3 × 2 tiles, the last column and row partly outside the document.

function info(id: string, name = id): LayerInfo {
  return {
    id,
    name,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    alphaLock: false,
    clippingMask: false,
    locked: false,
  }
}

/** A transparent layer. */
function blank(): Uint8Array {
  return new Uint8Array(W * H * 4)
}

/**
 * A layer with varied colour and alpha in the given tiles, as the GPU gives
 * pixels back: straight alpha that premultiplies back to whole bytes.
 */
function painted(tiles: [number, number][], seed = 1): Uint8Array {
  const pixels = new Uint8ClampedArray(W * H * 4)
  for (const [tx, ty] of tiles) {
    for (let y = ty * TILE_SIZE; y < Math.min(H, (ty + 1) * TILE_SIZE); y++) {
      for (let x = tx * TILE_SIZE; x < Math.min(W, (tx + 1) * TILE_SIZE); x++) {
        const i = (y * W + x) * 4
        const a = (x * 7 + y * 3 + seed) & 255
        pixels[i] = Math.min(a, (x * 13 + seed) & 255)
        pixels[i + 1] = Math.min(a, (y * 5 + seed) & 255)
        pixels[i + 2] = Math.min(a, (x + y) & 255)
        pixels[i + 3] = a
      }
    }
  }
  unpremultiply(pixels)
  return new Uint8Array(pixels.buffer)
}

const layer = (id: string, pixels: Uint8Array | null): SaveLayer => ({ info: info(id), pixels })

async function tileRecords(projectId?: string) {
  const all = await (await getDB()).getAll('tileData')
  return projectId ? all.filter((r) => r.projectId === projectId) : all
}

async function manifest(projectId: string) {
  return (await getDB()).get('documents', projectId)
}

describe('TileStore', () => {
  beforeEach(async () => {
    resetDB()
    indexedDB.deleteDatabase('QuarArtistDB')
  })

  describe('in IndexedDB', () => {
    let store: TileStore
    beforeEach(() => {
      const idb = new IdbTileBackend()
      store = new TileStore({ write: idb, read: { idb } })
    })

    it('saves layers and loads them back byte for byte', async () => {
      const ink = painted([[0, 0], [2, 1]])
      const sky = painted([[1, 0]], 7)
      await store.save('p', { width: W, height: H, layers: [layer('sky', sky.slice()), layer('ink', ink.slice())] })

      const doc = (await store.load('p'))!
      expect(doc.width).toBe(W)
      expect(doc.height).toBe(H)
      expect(doc.unreadableTiles).toBe(0)
      expect(doc.layers.map((l) => l.info.id)).toEqual(['sky', 'ink'])
      expect(sameBytes(doc.layers[0].pixels!, sky)).toBe(true)
      expect(sameBytes(doc.layers[1].pixels!, ink)).toBe(true)
    })

    it('stores only the tiles with something in them, compressed', async () => {
      const report = await store.save('p', { width: W, height: H, layers: [layer('ink', painted([[0, 0], [2, 1]]))] })
      expect(report).toMatchObject({ backend: 'idb', written: 2, kept: 0 })
      expect(report.bytes).toBeLessThan(2 * TILE_SIZE * TILE_SIZE * 4)
      expect(await tileRecords('p')).toHaveLength(2)
      const saved = (await manifest('p'))!
      expect(saved.format).toBe(TILE_FORMAT)
      expect(saved.layers[0].tiles.map((t) => [t.x, t.y, t.codec])).toEqual([
        [0, 0, 'deflate-raw'],
        [2, 1, 'deflate-raw'],
      ])
    })

    it('saves an empty layer with no tiles, and loads it without pixels', async () => {
      await store.save('p', { width: W, height: H, layers: [layer('empty', blank())] })
      expect(await tileRecords('p')).toHaveLength(0)
      const doc = (await store.load('p'))!
      expect(doc.layers).toEqual([{ info: info('empty'), pixels: null }])
    })

    it('keeps the tiles that did not change and rewrites only the one that did', async () => {
      const pixels = painted([[0, 0], [1, 0], [2, 1]])
      await store.save('p', { width: W, height: H, layers: [layer('ink', pixels.slice())] })
      const before = (await manifest('p'))!.layers[0].tiles

      expect(await store.save('p', { width: W, height: H, layers: [layer('ink', pixels.slice())] })).toMatchObject({
        written: 0,
        kept: 3,
      })

      const changed = pixels.slice()
      const i = (10 * W + 300) * 4 // in tile (1, 0)
      changed[i + 3] = changed[i + 3] === 255 ? 254 : 255
      expect(await store.save('p', { width: W, height: H, layers: [layer('ink', changed)] })).toMatchObject({
        written: 1,
        kept: 2,
      })

      const after = (await manifest('p'))!
      expect(after.seq).toBe(3)
      expect(after.layers[0].tiles.map((t) => t.ref === before.find((b) => b.x === t.x && b.y === t.y)!.ref)).toEqual([
        true,
        false,
        true,
      ])
      // The replaced tile is gone: one record per tile the manifest names.
      expect((await tileRecords('p')).map((r) => r.key).sort()).toEqual(after.layers[0].tiles.map((t) => t.ref).sort())
    })

    it("drops a deleted layer's tiles, and a tile painted away", async () => {
      await store.save('p', {
        width: W,
        height: H,
        layers: [layer('a', painted([[0, 0], [1, 1]])), layer('b', painted([[2, 0]]))],
      })
      expect(await tileRecords('p')).toHaveLength(3)

      await store.save('p', { width: W, height: H, layers: [layer('a', painted([[0, 0]]))] })
      const records = await tileRecords('p')
      expect(records.map((r) => [r.layerId, r.key.split('_').slice(0, 2).join('_')])).toEqual([['a', '0_0']])
    })

    it('keeps what was saved for a layer it is given no pixels for', async () => {
      const ink = painted([[1, 1]])
      await store.save('p', { width: W, height: H, layers: [layer('ink', ink.slice()), layer('sky', null)] })
      const report = await store.save('p', {
        width: W,
        height: H,
        layers: [layer('ink', null), layer('sky', painted([[0, 0]]))],
      })
      expect(report).toMatchObject({ written: 1, kept: 1 })

      const doc = (await store.load('p'))!
      expect(sameBytes(doc.layers[0].pixels!, ink)).toBe(true)
      expect(doc.layers[1].pixels).not.toBeNull()
    })

    it('saves layer properties, without the panel thumbnail, and in the order given', async () => {
      const sky = { ...info('sky', 'Sky'), opacity: 0.5, blendMode: 'multiply' as const, locked: true, thumbnail: 'data:…' }
      await store.save('p', { width: W, height: H, layers: [layer('ink', null), { info: sky, pixels: null }] })
      const doc = (await store.load('p'))!
      expect(doc.layers.map((l) => l.info)).toEqual([
        info('ink'),
        { ...info('sky', 'Sky'), opacity: 0.5, blendMode: 'multiply', locked: true },
      ])
    })

    it('refuses pixels of the wrong size and keeps the last save', async () => {
      await store.save('p', { width: W, height: H, layers: [layer('ink', painted([[0, 0]]))] })
      await expect(
        store.save('p', { width: W, height: H, layers: [layer('ink', new Uint8Array(16))] }),
      ).rejects.toThrow('16 bytes')
      expect((await manifest('p'))!.seq).toBe(1)
    })

    it('keeps the last save whole when a save fails part-way, and clears up after it', async () => {
      const first = painted([[0, 0], [1, 0]])
      await store.save('p', { width: W, height: H, layers: [layer('ink', first.slice())] })

      // A document of 80 changed tiles is written in two transactions of tiles: the second fails.
      const bigW = TILE_SIZE * 10
      const bigH = TILE_SIZE * 8
      const big = new Uint8Array(bigW * bigH * 4)
      for (let i = 0; i < big.length; i += 4) big[i + 3] = 255
      const put = IDBObjectStore.prototype.put
      let writes = 0
      const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        ...args: Parameters<IDBObjectStore['put']>
      ) {
        if (this.name === 'tileData' && ++writes > 64) throw new DOMException('full', 'QuotaExceededError')
        return put.apply(this, args)
      })
      await expect(store.save('p', { width: bigW, height: bigH, layers: [layer('ink', big)] })).rejects.toMatchObject({
        name: 'QuotaExceededError',
      })
      spy.mockRestore()

      // The last save still opens as it was.
      const doc = (await store.load('p'))!
      expect(doc.width).toBe(W)
      expect(sameBytes(doc.layers[0].pixels!, first)).toBe(true)
      expect((await tileRecords('p')).length).toBeGreaterThan(2)

      // The next save that works removes the tiles the failed one left.
      await store.save('p', { width: W, height: H, layers: [layer('ink', first.slice())] })
      expect(await tileRecords('p')).toHaveLength(2)
    })

    it('refuses to save a document without layers, keeping the last save', async () => {
      await store.save('p', { width: W, height: H, layers: [layer('ink', painted([[0, 0]]))] })
      await expect(store.save('p', { width: W, height: H, layers: [] })).rejects.toThrow('no layers')
      expect((await manifest('p'))!.seq).toBe(1)
      expect(await tileRecords('p')).toHaveLength(1)
    })

    it('commits to disk before removing the tiles a save replaced', async () => {
      const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction')
      await store.save('p', { width: W, height: H, layers: [layer('ink', painted([[0, 0]]))] })
      const commit = transaction.mock.calls.find(([names]) => Array.isArray(names) && names.includes('documents'))
      expect(commit?.[2]).toEqual({ durability: 'strict' })
      transaction.mockRestore()
    })

    it('sweeps the tiles of a save whose commit failed at the next save', async () => {
      const first = painted([[0, 0]], 1)
      await store.save('p', { width: W, height: H, layers: [layer('ink', first.slice())] })

      const put = IDBObjectStore.prototype.put
      const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        ...args: Parameters<IDBObjectStore['put']>
      ) {
        if (this.name === 'documents') throw new DOMException('full', 'QuotaExceededError')
        return put.apply(this, args)
      })
      await expect(
        store.save('p', { width: W, height: H, layers: [layer('ink', painted([[0, 0], [1, 0]], 2))] }),
      ).rejects.toMatchObject({ name: 'QuotaExceededError' })
      spy.mockRestore()
      expect(await tileRecords('p')).toHaveLength(3)

      // Nothing changed since the last commit, but the next save still clears what the failed one left.
      await store.save('p', { width: W, height: H, layers: [layer('ink', first.slice())] })
      expect(await tileRecords('p')).toHaveLength(1)
      expect(sameBytes((await store.load('p'))!.layers[0].pixels!, first)).toBe(true)
    })

    it('holds Web Locks where the browser has them: saves alone, loads together', async () => {
      const locks = new FakeLocks()
      vi.stubGlobal('navigator', { ...navigator, locks })
      try {
        const last = painted([[2, 1]], 3)
        await Promise.all([
          store.save('p', { width: W, height: H, layers: [layer('ink', painted([[0, 0]], 1))] }),
          store.save('p', { width: W, height: H, layers: [layer('ink', painted([[1, 1]], 2))] }),
          store.save('p', { width: W, height: H, layers: [layer('ink', last.slice())] }),
        ])
        const [a, b] = await Promise.all([store.load('p'), store.load('p')])
        await store.copy('p', 'q')
        await store.delete('q')

        expect((await manifest('p'))!.seq).toBe(3)
        expect(sameBytes(a!.layers[0].pixels!, last)).toBe(true)
        expect(b!.unreadableTiles).toBe(0)
        expect(await tileRecords('p')).toHaveLength(1)
        expect(locks.requests).toEqual([
          ...Array(3).fill({ name: 'quar-artist:document:p', mode: 'exclusive' }),
          { name: 'quar-artist:document:p', mode: 'shared' },
          { name: 'quar-artist:document:p', mode: 'shared' },
          { name: 'quar-artist:document:p', mode: 'shared' },
          { name: 'quar-artist:document:q', mode: 'exclusive' },
          { name: 'quar-artist:document:q', mode: 'exclusive' },
        ])
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('runs saves of one project one after another', async () => {
      const a = painted([[0, 0]], 1)
      const b = painted([[0, 0], [1, 1]], 2)
      const c = painted([[2, 1]], 3)
      await Promise.all([
        store.save('p', { width: W, height: H, layers: [layer('ink', a)] }),
        store.save('p', { width: W, height: H, layers: [layer('ink', b)] }),
        store.save('p', { width: W, height: H, layers: [layer('ink', c.slice())] }),
      ])
      const saved = (await manifest('p'))!
      expect(saved.seq).toBe(3)
      const doc = (await store.load('p'))!
      expect(doc.unreadableTiles).toBe(0)
      expect(sameBytes(doc.layers[0].pixels!, c)).toBe(true)
      expect(await tileRecords('p')).toHaveLength(1)
    })

    it('loads what it can of a document with a tile missing, and counts it', async () => {
      const ink = painted([[0, 0], [1, 0]])
      await store.save('p', { width: W, height: H, layers: [layer('ink', ink)] })
      const [first] = (await manifest('p'))!.layers[0].tiles
      await (await getDB()).delete('tileData', ['p', 'ink', first.ref])

      const doc = (await store.load('p'))!
      expect(doc.unreadableTiles).toBe(1)
      const pixels = doc.layers[0].pixels!
      expect(pixels[3]).toBe(0) // the missing tile (0, 0) is transparent
      expect(pixels[(10 * W + 300) * 4 + 3]).toBe(ink[(10 * W + 300) * 4 + 3])
    })

    it('counts a tile that does not decode as unreadable', async () => {
      await store.save('p', { width: W, height: H, layers: [layer('ink', painted([[0, 0]]))] })
      const [tile] = (await manifest('p'))!.layers[0].tiles
      await (await getDB()).put('tileData', { projectId: 'p', layerId: 'ink', key: tile.ref, data: new Uint8Array([1, 2]).buffer })
      expect((await store.load('p'))!.unreadableTiles).toBe(1)
    })

    it('has nothing for a project never saved here, and refuses a newer format', async () => {
      expect(await store.load('nope')).toBeNull()
      await (await getDB()).put('documents', {
        projectId: 'future',
        seq: 1,
        backend: 'idb',
        format: 'rgba16f-1024' as never,
        width: 1,
        height: 1,
        layers: [],
        savedAt: new Date(),
      })
      await expect(store.load('future')).rejects.toThrow('newer version')
    })

    it('removes the whole-layer records of a project saved the old way when it first saves', async () => {
      const db = await getDB()
      for (const projectId of ['p', 'other']) {
        await db.add('layers', {
          projectId,
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
        await db.add('tiles', { projectId, layerId: 'ink', key: 'full', data: new ArrayBuffer(4) })
      }

      await store.save('p', { width: W, height: H, layers: [layer('ink', painted([[0, 0]]))] })
      expect((await db.getAll('layers')).map((r) => r.projectId)).toEqual(['other'])
      expect((await db.getAll('tiles')).map((r) => r.projectId)).toEqual(['other'])
    })

    it('copies a document to another project, which stays whole when the original goes', async () => {
      const ink = painted([[0, 0], [2, 1]])
      await store.save('p', { width: W, height: H, layers: [layer('bg', null), layer('ink', ink.slice())] })

      expect(await store.copy('p', 'copy')).toBe(true)
      await store.delete('p')

      expect(await store.load('p')).toBeNull()
      const doc = (await store.load('copy'))!
      expect(doc.layers.map((l) => l.info.id)).toEqual(['bg', 'ink'])
      expect(sameBytes(doc.layers[1].pixels!, ink)).toBe(true)
      expect((await manifest('copy'))!.seq).toBe(1)
      expect(await tileRecords('p')).toHaveLength(0)
      expect(await tileRecords('copy')).toHaveLength(2)
    })

    it('copies nothing from a project with no saved document', async () => {
      expect(await store.copy('nope', 'copy')).toBe(false)
      expect(await manifest('copy')).toBeUndefined()
    })

    it('fails a copy when a tile is missing, committing nothing', async () => {
      await store.save('p', { width: W, height: H, layers: [layer('ink', painted([[0, 0], [1, 0]]))] })
      const [first] = (await manifest('p'))!.layers[0].tiles
      await (await getDB()).delete('tileData', ['p', 'ink', first.ref])
      await expect(store.copy('p', 'copy')).rejects.toThrow('missing')
      expect(await manifest('copy')).toBeUndefined()
    })

    it('deletes only the project asked for', async () => {
      await store.save('p', { width: W, height: H, layers: [layer('ink', painted([[0, 0]]))] })
      await store.save('q', { width: W, height: H, layers: [layer('ink', painted([[0, 0]]))] })
      await store.delete('p')
      await store.delete('never-saved')
      expect(await manifest('p')).toBeUndefined()
      expect(await tileRecords('p')).toHaveLength(0)
      expect(await store.load('q')).not.toBeNull()
    })
  })

  describe('in OPFS', () => {
    let root: FakeDirectory
    let store: TileStore
    beforeEach(() => {
      root = new FakeDirectory()
      const opfs = new OpfsTileBackend(root.asHandle())
      store = new TileStore({ write: opfs, read: { opfs, idb: new IdbTileBackend() } })
    })

    it('writes one file per tile and loads them back byte for byte', async () => {
      const ink = painted([[0, 0], [2, 1]])
      expect(await store.save('p', { width: W, height: H, layers: [layer('ink', ink.slice())] })).toMatchObject({
        backend: 'opfs',
        written: 2,
      })
      const files = [...root.files().keys()]
      expect(files).toHaveLength(2)
      expect(files.every((f) => /^p-p\/l-ink\/\d+_\d+_[0-9a-f-]{13}$/.test(f))).toBe(true)
      expect(await tileRecords()).toHaveLength(0)

      const doc = (await store.load('p'))!
      expect(sameBytes(doc.layers[0].pixels!, ink)).toBe(true)
    })

    it('writes a changed tile to a new file and removes the one it replaced', async () => {
      await store.save('p', { width: W, height: H, layers: [layer('ink', painted([[0, 0], [1, 0]], 1))] })
      const first = new Set(root.files().keys())
      await store.save('p', { width: W, height: H, layers: [layer('ink', painted([[0, 0]], 1))] })
      await store.save('p', { width: W, height: H, layers: [layer('ink', painted([[0, 0]], 2))] })

      const now = [...root.files().keys()]
      expect(now).toHaveLength(1)
      expect(first.has(now[0])).toBe(false)
      const saved = (await manifest('p'))!
      expect(saved.layers[0].tiles.map((t) => `p-p/l-ink/${t.ref}`)).toEqual(now)
    })

    it('leaves the last save untouched when writing a tile fails, and sweeps the leftovers later', async () => {
      const first = painted([[0, 0]], 1)
      await store.save('p', { width: W, height: H, layers: [layer('ink', first.slice())] })

      let writes = 0
      root.faults.write = () => (++writes === 2 ? new DOMException('full', 'QuotaExceededError') : null)
      await expect(
        store.save('p', { width: W, height: H, layers: [layer('ink', painted([[0, 0], [1, 0], [2, 0]], 2))] }),
      ).rejects.toMatchObject({ name: 'QuotaExceededError' })
      root.faults.write = undefined

      expect(sameBytes((await store.load('p'))!.layers[0].pixels!, first)).toBe(true)
      expect(root.files().size).toBeGreaterThan(1)

      await store.save('p', { width: W, height: H, layers: [layer('ink', first.slice())] })
      expect(root.files().size).toBe(1)
    })

    it('sweeps files no manifest refers to the first time it saves a project', async () => {
      await store.save('p', { width: W, height: H, layers: [layer('ink', painted([[0, 0]]))] })
      // Left by a save that stopped, in an earlier visit.
      const ink = await (await root.getDirectoryHandle('p-p')).getDirectoryHandle('l-ink')
      await ink.getFileHandle('9_9_leftover', { create: true })
      await (await root.getDirectoryHandle('p-p')).getDirectoryHandle('l-gone', { create: true })

      const opfs = new OpfsTileBackend(root.asHandle())
      const later = new TileStore({ write: opfs, read: { opfs } })
      await later.save('p', { width: W, height: H, layers: [layer('ink', null)] })
      expect([...root.files().keys()].some((f) => f.includes('leftover'))).toBe(false)
      expect((await root.getDirectoryHandle('p-p')).children.has('l-gone')).toBe(false)
    })

    it('copies and deletes projects', async () => {
      const ink = painted([[1, 1]])
      await store.save('p', { width: W, height: H, layers: [layer('ink', ink.slice())] })
      await store.copy('p', 'copy')
      await store.delete('p')
      expect(root.children.has('p-p')).toBe(false)
      expect(sameBytes((await store.load('copy'))!.layers[0].pixels!, ink)).toBe(true)
    })

    it('opens and moves projects saved in the other backend', async () => {
      const ink = painted([[0, 0], [1, 1]])
      const sky = painted([[2, 0]], 5)
      // Saved where OPFS couldn't be written, in IndexedDB.
      const idb = new IdbTileBackend()
      await new TileStore({ write: idb, read: { idb } }).save('p', {
        width: W,
        height: H,
        layers: [layer('ink', ink.slice()), layer('sky', sky.slice())],
      })
      expect(sameBytes((await store.load('p'))!.layers[0].pixels!, ink)).toBe(true)

      // A save here writes everything to OPFS, the unchanged layer too, and clears IndexedDB.
      const report = await store.save('p', { width: W, height: H, layers: [layer('ink', ink.slice()), layer('sky', null)] })
      expect(report).toMatchObject({ backend: 'opfs', written: 3, kept: 0 })
      expect(await tileRecords('p')).toHaveLength(0)
      expect(root.files().size).toBe(3)
      const doc = (await store.load('p'))!
      expect(sameBytes(doc.layers[1].pixels!, sky)).toBe(true)
    })
  })

  describe('choosing a backend', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    function withStorage(root: FakeDirectory | null) {
      vi.stubGlobal('navigator', {
        ...navigator,
        storage: root ? { getDirectory: async () => root.asHandle() } : {},
      })
    }

    it('writes to OPFS where sync access handles work, as in the worker', async () => {
      const root = new FakeDirectory()
      withStorage(root)
      const backends = await openBackends()
      expect(backends.write.kind).toBe('opfs')
      expect(Object.keys(backends.read).sort()).toEqual(['idb', 'opfs'])
      // The file it tried writing to is gone again.
      expect([...(await root.getDirectoryHandle('quar-artist')).children.keys()]).toEqual([])
    })

    it('writes to IndexedDB without OPFS, and reads OPFS where it can only read it', async () => {
      withStorage(null)
      expect((await openBackends()).write.kind).toBe('idb')

      const root = new FakeDirectory()
      // The main thread: files can be read, but not written.
      const file = FakeDirectory.prototype.getFileHandle
      vi.spyOn(FakeDirectory.prototype, 'getFileHandle').mockImplementation(async function (this: FakeDirectory, ...args) {
        const handle = await file.apply(this, args)
        return Object.assign(Object.create(handle), { createSyncAccessHandle: undefined })
      })
      withStorage(root)
      expect((await openOpfsRoot())!.writable).toBe(false)
      const backends = await openBackends()
      expect(backends.write.kind).toBe('idb')
      expect(backends.read.opfs).toBeDefined()
      vi.restoreAllMocks()
    })

    it('treats OPFS that throws as not there', async () => {
      vi.stubGlobal('navigator', {
        ...navigator,
        storage: { getDirectory: () => Promise.reject(new DOMException('no', 'SecurityError')) },
      })
      expect(await openOpfsRoot()).toBeNull()
    })
  })
})
