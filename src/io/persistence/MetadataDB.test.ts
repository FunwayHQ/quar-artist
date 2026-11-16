import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { MetadataDB } from './MetadataDB.ts'
import { getDB, resetDB } from '../../db/schema.ts'
import type { LayerInfo } from '../../types/layer.ts'
import { layerInfo } from '../../test/fakeDocumentEngine.ts'
import { legacyRecords, writeLegacyLayers } from '../../test/legacyLayout.ts'
import { IdbTileBackend } from '../tiles/IdbTileBackend.ts'
import { TileStore } from '../tiles/TileStore.ts'

describe('MetadataDB', () => {
  let meta: MetadataDB

  beforeEach(async () => {
    resetDB()
    indexedDB.deleteDatabase('QuarArtistDB')
    meta = new MetadataDB()
  })

  describe('projects', () => {
    it('creates a project and returns its id, a UUID (D12)', async () => {
      const id = await meta.createProject('My Art', 1920, 1080, 72)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(await meta.createProject('My Art', 1920, 1080, 72)).not.toBe(id)
    })

    it('retrieves a project by id', async () => {
      const id = await meta.createProject('My Art', 1920, 1080, 72)
      const project = await meta.getProject(id)
      expect(project).toBeDefined()
      expect(project!.name).toBe('My Art')
      expect(project!.width).toBe(1920)
      expect(project!.height).toBe(1080)
      expect(project!.dpi).toBe(72)
    })

    it('lists all projects ordered by updatedAt descending', async () => {
      await meta.createProject('Older', 100, 100, 72)
      const newer = await meta.createProject('Newer', 200, 200, 72)
      // Two creates can share a millisecond; make the order certain.
      await meta.updateProject(newer, { updatedAt: new Date(Date.now() + 1000) }, { touch: false })

      const all = await meta.getAllProjects()
      expect(all).toHaveLength(2)
      expect(all[0].name).toBe('Newer')
    })

    it('updates project fields', async () => {
      const id = await meta.createProject('Original', 100, 100, 72)
      await meta.updateProject(id, { name: 'Renamed' })

      const project = await meta.getProject(id)
      expect(project!.name).toBe('Renamed')
    })

    it('deletes a project with the whole layers it was saved with before the tile store', async () => {
      const id = await meta.createProject('Delete Me', 1, 1, 72)
      await writeLegacyLayers(id, [{ info: layerInfo('layer-1', 'BG'), pixels: new Uint8Array(4) }])

      await meta.deleteProject(id)

      expect(await meta.getProject(id)).toBeUndefined()
      expect(await legacyRecords(id)).toEqual({ layers: [], tiles: [] })
    })

    it('duplicates a project, with the whole layers it was saved with before the tile store', async () => {
      const id = await meta.createProject('Original', 2, 2, 72)
      await writeLegacyLayers(id, [
        { info: layerInfo('layer-1', 'BG'), pixels: new Uint8Array(16).fill(99) },
        { info: layerInfo('layer-2', 'Ink', { opacity: 0.5 }), pixels: null },
      ])

      const newId = await meta.duplicateProject(id, 'Copy')
      expect(newId).not.toBe(id)

      const copy = await meta.getProject(newId)
      expect(copy!.name).toBe('Copy')
      expect(copy!.width).toBe(2)

      const layers = (await meta.loadLegacyLayers(newId, 2, 2))!
      expect(layers.map((l) => l.info)).toEqual([layerInfo('layer-1', 'BG'), layerInfo('layer-2', 'Ink', { opacity: 0.5 })])
      expect(layers[0].pixels![0]).toBe(99)
      expect(layers[1].pixels).toBeNull()
      // The original keeps its own.
      expect(await legacyRecords(id)).toEqual({ layers: ['layer-1', 'layer-2'], tiles: ['layer-1'] })
    })

    it('throws when duplicating non-existent project', async () => {
      await expect(meta.duplicateProject('missing', 'Ghost')).rejects.toThrow()
    })
  })

  describe('documents saved before the tile store', () => {
    it('loads their layers bottom first, with their properties and pixels', async () => {
      const id = await meta.createProject('P', 1, 1, 72)
      await writeLegacyLayers(id, [
        { info: layerInfo('sky', 'Sky'), pixels: new Uint8Array([1, 2, 3, 255]) },
        { info: layerInfo('ink', 'Ink', { opacity: 0.5, blendMode: 'multiply', locked: true }), pixels: new Uint8Array([4, 5, 6, 7]) },
      ])

      const layers = (await meta.loadLegacyLayers(id, 1, 1))!
      expect(layers.map((l) => l.info)).toEqual([
        layerInfo('sky', 'Sky'),
        layerInfo('ink', 'Ink', { opacity: 0.5, blendMode: 'multiply', locked: true }),
      ])
      expect(layers.map((l) => [...l.pixels!])).toEqual([
        [1, 2, 3, 255],
        [4, 5, 6, 7],
      ])
    })

    it('loads a layer empty when its pixels are missing or the wrong size, and fixes bad properties', async () => {
      const id = await meta.createProject('P', 2, 2, 72)
      await writeLegacyLayers(id, [
        { info: layerInfo('short', 'Short'), pixels: new Uint8Array(4) },
        { info: layerInfo('none', 'None', { blendMode: 'sparkle' as never, opacity: 7 }), pixels: null },
      ])
      const layers = (await meta.loadLegacyLayers(id, 2, 2))!
      expect(layers.map((l) => l.pixels)).toEqual([null, null])
      expect(layers[1].info).toMatchObject({ blendMode: 'normal', opacity: 1 })
    })

    it('has no layers for a project never saved', async () => {
      const id = await meta.createProject('P', 2, 2, 72)
      expect(await meta.loadLegacyLayers(id, 2, 2)).toEqual([])
    })

    it('reads nothing of a project saved to the tile store since, to read from there instead', async () => {
      const id = await meta.createProject('P', 1, 1, 72)
      await writeLegacyLayers(id, [{ info: layerInfo('bg', 'Background'), pixels: new Uint8Array([1, 2, 3, 255]) }])
      const idb = new IdbTileBackend()
      await new TileStore({ write: idb, read: { idb } }).save(id, {
        width: 1,
        height: 1,
        layers: [{ info: layerInfo('bg', 'Background'), pixels: new Uint8Array([4, 5, 6, 255]) }],
      })
      expect(await meta.loadLegacyLayers(id, 1, 1)).toBeNull()
    })
  })

  describe('project records (M1.1)', () => {
    it('stores the colour space and stack it is created with', async () => {
      const id = await meta.createProject('P', 100, 100, 72, { colorSpace: 'srgb', stackId: 's1' })
      expect(await meta.getProject(id)).toMatchObject({ colorSpace: 'srgb', stackId: 's1' })
    })

    it('marks a project modified on update, unless told not to', async () => {
      const id = await meta.createProject('P', 100, 100, 72)
      const old = new Date('2020-01-01')
      await meta.updateProject(id, { updatedAt: old }, { touch: false })

      await meta.updateProject(id, { name: 'Renamed' }, { touch: false })
      expect((await meta.getProject(id))!.updatedAt).toEqual(old)

      await meta.updateProject(id, { name: 'Edited' })
      expect((await meta.getProject(id))!.updatedAt.getTime()).toBeGreaterThan(old.getTime())
    })

    it('keeps concurrent updates of different fields', async () => {
      const id = await meta.createProject('P', 100, 100, 72)
      await Promise.all([
        meta.updateProject(id, { name: 'Renamed' }, { touch: false }),
        meta.updateProject(id, { activeLayerId: 'layer-2' }),
        meta.updateProject(id, { stackId: 's1' }, { touch: false }),
      ])
      expect(await meta.getProject(id)).toMatchObject({ name: 'Renamed', activeLayerId: 'layer-2', stackId: 's1' })
    })

    it('does nothing when updating a project that does not exist', async () => {
      await meta.updateProject('missing', { name: 'X' })
      expect(await meta.getProject('missing')).toBeUndefined()
    })

    it('duplicates into the same stack, and never copies a pending delete', async () => {
      const id = await meta.createProject('P', 100, 100, 72, { stackId: 's1' })
      await meta.updateProject(id, { deletedAt: new Date() }, { touch: false })
      const copyId = await meta.duplicateProject(id, 'P copy')
      const copy = (await meta.getProject(copyId))!
      expect(copy.stackId).toBe('s1')
      expect(copy.deletedAt).toBeUndefined()
    })
  })

  describe('stacks', () => {
    it('creates, lists, renames and deletes stacks', async () => {
      const id = await meta.createStack('Studies')
      expect(await meta.getAllStacks()).toEqual([expect.objectContaining({ id, name: 'Studies' })])

      await meta.updateStack(id, { name: 'Old studies' })
      expect((await meta.getAllStacks())[0].name).toBe('Old studies')

      await meta.deleteStack(id)
      expect(await meta.getAllStacks()).toEqual([])
    })
  })

  describe('settings', () => {
    it('stores and replaces string settings', async () => {
      expect(await meta.getSetting('gallery.sort')).toBeUndefined()
      await meta.setSetting('gallery.sort', 'name')
      await meta.setSetting('gallery.sort', 'created')
      expect(await meta.getSetting('gallery.sort')).toBe('created')
    })
  })

  describe('failed writes', () => {
    // IndexedDB can't store a function: put() and add() throw DataCloneError.
    const unstorable = (() => 'not storable') as unknown as string
    const info = (id: string, name: string): LayerInfo => ({
      id, name, visible: true, opacity: 1, blendMode: 'normal', alphaLock: false, clippingMask: false, locked: false,
    })

    /** Run `write`, then check that the transaction's abort wasn't left unhandled. */
    async function expectCleanFailure(write: () => Promise<unknown>) {
      const unhandled: unknown[] = []
      const listener = (reason: unknown) => unhandled.push(reason)
      process.on('unhandledRejection', listener)
      try {
        await expect(write()).rejects.toThrow()
        // Give the abort time to arrive.
        await new Promise((resolve) => setTimeout(resolve, 20))
      } finally {
        process.off('unhandledRejection', listener)
      }
      expect(unhandled).toEqual([])
    }

    it('reports a failed update once and keeps the record as it was', async () => {
      const id = await meta.createProject('Kept', 2, 2, 72)
      await expectCleanFailure(() => meta.updateProject(id, { name: unstorable }))
      expect((await meta.getProject(id))!.name).toBe('Kept')
    })

    it('deletes a project with all its whole layers, leaving other projects alone', async () => {
      const id = await meta.createProject('Gone', 2, 2, 72)
      const other = await meta.createProject('Stays', 2, 2, 72)
      for (const project of [id, other]) {
        await writeLegacyLayers(project, [
          { info: info('a', 'Sky'), pixels: new Uint8Array(16) },
          { info: info('b', 'Ink'), pixels: new Uint8Array(16) },
        ])
      }

      await meta.deleteProject(id)

      expect(await meta.getProject(id)).toBeUndefined()
      expect(await legacyRecords(id)).toEqual({ layers: [], tiles: [] })
      expect(await legacyRecords(other)).toEqual({ layers: ['a', 'b'], tiles: ['a', 'b'] })
    })

    it('leaves no half-copied project when duplicating fails', async () => {
      const id = await meta.createProject('Original', 2, 2, 72)
      await writeLegacyLayers(id, [{ info: info('a', 'Sky'), pixels: new Uint8Array(16) }])
      const add = IDBObjectStore.prototype.add
      const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args) {
        if (this.name === 'tiles') throw new DOMException('storage is full', 'QuotaExceededError')
        return add.apply(this, args)
      })

      await expectCleanFailure(() => meta.duplicateProject(id, 'Original copy'))
      spy.mockRestore()

      // The record and the layer records copied before the failure are rolled back.
      expect((await meta.getAllProjects()).map((p) => p.name)).toEqual(['Original'])
      expect(await (await getDB()).count('layers')).toBe(1)
      expect(await legacyRecords(id)).toEqual({ layers: ['a'], tiles: ['a'] })
    })

    it('says whether the project it updates exists', async () => {
      const id = await meta.createProject('Here', 2, 2, 72)
      expect(await meta.updateProject(id, { name: 'Still here' })).toBe(true)
      expect(await meta.updateProject('missing', { name: 'Nowhere' })).toBe(false)
      expect(await meta.getProject('missing')).toBeUndefined()
    })

  })
})
