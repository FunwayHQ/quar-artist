import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { MetadataDB } from './MetadataDB.ts'
import { resetDB } from '../../db/schema.ts'
import type { LayerInfo } from '../../types/layer.ts'

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

    it('deletes a project and its layers and tiles', async () => {
      const id = await meta.createProject('Delete Me', 100, 100, 72)
      const layers: LayerInfo[] = [{
        id: 'layer-1',
        name: 'BG',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        alphaLock: false,
        clippingMask: false,
        locked: false,
      }]
      await meta.saveLayers(id, layers)
      await meta.saveTile(id, 'layer-1', 'full', new ArrayBuffer(8))

      await meta.deleteProject(id)

      expect(await meta.getProject(id)).toBeUndefined()
      const remainingLayers = await meta.loadLayers(id)
      expect(remainingLayers).toHaveLength(0)
      expect(await meta.loadTile(id, 'layer-1', 'full')).toBeNull()
    })

    it('duplicates a project with layers and tiles', async () => {
      const id = await meta.createProject('Original', 1920, 1080, 72)
      const layers: LayerInfo[] = [{
        id: 'layer-1',
        name: 'BG',
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        alphaLock: false,
        clippingMask: false,
        locked: false,
      }]
      await meta.saveLayers(id, layers)
      const pixelData = new ArrayBuffer(16)
      new Uint8Array(pixelData).fill(99)
      await meta.saveTile(id, 'layer-1', 'full', pixelData)

      const newId = await meta.duplicateProject(id, 'Copy')
      expect(newId).not.toBe(id)

      const copy = await meta.getProject(newId)
      expect(copy!.name).toBe('Copy')
      expect(copy!.width).toBe(1920)

      const copyLayers = await meta.loadLayers(newId)
      expect(copyLayers).toHaveLength(1)
      expect(copyLayers[0].layerId).toBe('layer-1')

      const tile = await meta.loadTile(newId, 'layer-1', 'full')
      expect(tile).not.toBeNull()
      expect(new Uint8Array(tile!)[0]).toBe(99)
    })

    it('throws when duplicating non-existent project', async () => {
      await expect(meta.duplicateProject('missing', 'Ghost')).rejects.toThrow()
    })
  })

  describe('layers', () => {
    it('saves and loads layers in order', async () => {
      const id = await meta.createProject('P', 100, 100, 72)
      const layers: LayerInfo[] = [
        {
          id: 'layer-1', name: 'Background', visible: true, opacity: 1,
          blendMode: 'normal', alphaLock: false, clippingMask: false, locked: false,
        },
        {
          id: 'layer-2', name: 'Sketch', visible: true, opacity: 0.5,
          blendMode: 'multiply', alphaLock: false, clippingMask: false, locked: false,
        },
      ]
      await meta.saveLayers(id, layers)

      const loaded = await meta.loadLayers(id)
      expect(loaded).toHaveLength(2)
      expect(loaded[0].layerId).toBe('layer-1')
      expect(loaded[0].order).toBe(0)
      expect(loaded[1].layerId).toBe('layer-2')
      expect(loaded[1].order).toBe(1)
      expect(loaded[1].blendMode).toBe('multiply')
    })

    it('replaces layers on re-save', async () => {
      const id = await meta.createProject('P', 100, 100, 72)
      const layers1: LayerInfo[] = [{
        id: 'layer-1', name: 'Old', visible: true, opacity: 1,
        blendMode: 'normal', alphaLock: false, clippingMask: false, locked: false,
      }]
      await meta.saveLayers(id, layers1)

      const layers2: LayerInfo[] = [{
        id: 'layer-2', name: 'New', visible: true, opacity: 0.8,
        blendMode: 'screen', alphaLock: false, clippingMask: false, locked: false,
      }]
      await meta.saveLayers(id, layers2)

      const loaded = await meta.loadLayers(id)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].layerId).toBe('layer-2')
    })
  })

  describe('tiles', () => {
    it('saves and loads tile data', async () => {
      const id = await meta.createProject('P', 100, 100, 72)
      const data = new ArrayBuffer(32)
      new Uint8Array(data).fill(128)

      await meta.saveTile(id, 'layer-1', 'full', data)
      const loaded = await meta.loadTile(id, 'layer-1', 'full')

      expect(loaded).not.toBeNull()
      expect(new Uint8Array(loaded!)[0]).toBe(128)
    })

    it('returns null for missing tile', async () => {
      const result = await meta.loadTile('missing', 'x', 'y')
      expect(result).toBeNull()
    })

    it('overwrites existing tile data', async () => {
      const id = await meta.createProject('P', 100, 100, 72)
      const data1 = new ArrayBuffer(4)
      new Uint8Array(data1).fill(1)
      await meta.saveTile(id, 'layer-1', 'full', data1)

      const data2 = new ArrayBuffer(4)
      new Uint8Array(data2).fill(2)
      await meta.saveTile(id, 'layer-1', 'full', data2)

      const loaded = await meta.loadTile(id, 'layer-1', 'full')
      expect(new Uint8Array(loaded!)[0]).toBe(2)
    })

    it('loads all tiles for a layer', async () => {
      const id = await meta.createProject('P', 100, 100, 72)
      await meta.saveTile(id, 'layer-1', 'tile-0', new ArrayBuffer(4))
      await meta.saveTile(id, 'layer-1', 'tile-1', new ArrayBuffer(4))
      await meta.saveTile(id, 'layer-2', 'tile-0', new ArrayBuffer(4))

      const tiles = await meta.loadAllTilesForLayer(id, 'layer-1')
      expect(tiles).toHaveLength(2)
    })

    it('deletes tiles for a specific layer', async () => {
      const id = await meta.createProject('P', 100, 100, 72)
      await meta.saveTile(id, 'layer-1', 'full', new ArrayBuffer(4))
      await meta.saveTile(id, 'layer-2', 'full', new ArrayBuffer(4))

      await meta.deleteLayerTiles(id, 'layer-1')

      expect(await meta.loadTile(id, 'layer-1', 'full')).toBeNull()
      expect(await meta.loadTile(id, 'layer-2', 'full')).not.toBeNull()
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

  describe('documents', () => {
    const info = (id: string, name: string): LayerInfo => ({
      id,
      name,
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      alphaLock: false,
      clippingMask: false,
      locked: false,
    })

    it('saves layer records and pixels together, dropping layers that are gone', async () => {
      const id = await meta.createProject('P', 1, 1, 72)
      await meta.saveDocumentLayers(id, [
        { info: info('a', 'Sky'), pixels: new Uint8Array([1, 2, 3, 4]) },
        { info: info('b', 'Ink'), pixels: new Uint8Array([5, 6, 7, 8]) },
      ])
      await meta.saveDocumentLayers(id, [{ info: info('b', 'Ink'), pixels: new Uint8Array([9, 9, 9, 9]) }])

      expect((await meta.loadLayers(id)).map((l) => l.layerId)).toEqual(['b'])
      expect(await meta.loadTile(id, 'a', 'full')).toBeNull()
      expect([...new Uint8Array((await meta.loadTile(id, 'b', 'full'))!)]).toEqual([9, 9, 9, 9])
    })

    it('stores only the bytes of a view, not its whole buffer', async () => {
      const id = await meta.createProject('P', 1, 1, 72)
      const backing = new Uint8Array([0, 0, 1, 2, 3, 4, 0, 0])
      await meta.saveDocumentLayers(id, [{ info: info('a', 'Sky'), pixels: backing.subarray(2, 6) }])
      expect([...new Uint8Array((await meta.loadTile(id, 'a', 'full'))!)]).toEqual([1, 2, 3, 4])
    })

    it('deletes tiles of other layers only within the project', async () => {
      const a = await meta.createProject('A', 1, 1, 72)
      const b = await meta.createProject('B', 1, 1, 72)
      await meta.saveTile(a, 'keep', 'full', new ArrayBuffer(4))
      await meta.saveTile(a, 'drop', 'full', new ArrayBuffer(4))
      await meta.saveTile(a, 'drop', 'tile-1', new ArrayBuffer(4))
      await meta.saveTile(b, 'drop', 'full', new ArrayBuffer(4))

      await meta.deleteTilesExcept(a, new Set(['keep']))

      expect(await meta.loadTile(a, 'keep', 'full')).not.toBeNull()
      expect(await meta.loadAllTilesForLayer(a, 'drop')).toHaveLength(0)
      expect(await meta.loadTile(b, 'drop', 'full')).not.toBeNull()
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

    it('keeps the layers saved before when a layer save fails part-way', async () => {
      const id = await meta.createProject('Layers', 2, 2, 72)
      await meta.saveLayers(id, [info('a', 'Sky'), info('b', 'Ink')])

      // The old records are deleted and the first new one added before the second fails.
      await expectCleanFailure(() => meta.saveLayers(id, [info('c', 'New'), info('d', unstorable)]))

      expect((await meta.loadLayers(id)).map((l) => l.name)).toEqual(['Sky', 'Ink'])
    })

    it('deletes a project with all its layers and tiles', async () => {
      const id = await meta.createProject('Gone', 2, 2, 72)
      const other = await meta.createProject('Stays', 2, 2, 72)
      for (const project of [id, other]) {
        await meta.saveLayers(project, [info('a', 'Sky'), info('b', 'Ink')])
        await meta.saveTile(project, 'a', 'full', new Uint8Array(16).buffer)
        await meta.saveTile(project, 'b', 'full', new Uint8Array(16).buffer)
      }

      await meta.deleteProject(id)

      expect(await meta.getProject(id)).toBeUndefined()
      expect(await meta.loadLayers(id)).toEqual([])
      expect(await meta.loadTile(id, 'a', 'full')).toBeNull()
      expect(await meta.loadTile(id, 'b', 'full')).toBeNull()
      expect(await meta.loadLayers(other)).toHaveLength(2)
      expect(await meta.loadTile(other, 'b', 'full')).not.toBeNull()
    })

    it('leaves no half-copied project when duplicating fails', async () => {
      const id = await meta.createProject('Original', 2, 2, 72)
      await meta.saveLayers(id, [info('a', 'Sky')])
      await meta.saveTile(id, 'a', 'full', new Uint8Array(16).buffer)
      const add = IDBObjectStore.prototype.add
      const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args) {
        if (this.name === 'tiles') throw new DOMException('storage is full', 'QuotaExceededError')
        return add.apply(this, args)
      })

      await expect(meta.duplicateProject(id, 'Original copy')).rejects.toThrow('storage is full')
      spy.mockRestore()

      expect((await meta.getAllProjects()).map((p) => p.name)).toEqual(['Original'])
      expect(await meta.loadLayers(id)).toHaveLength(1)
    })

    it('says whether the project it updates exists', async () => {
      const id = await meta.createProject('Here', 2, 2, 72)
      expect(await meta.updateProject(id, { name: 'Still here' })).toBe(true)
      expect(await meta.updateProject('missing', { name: 'Nowhere' })).toBe(false)
      expect(await meta.getProject('missing')).toBeUndefined()
    })

    it('deletes one layer\'s tiles only', async () => {
      const id = await meta.createProject('Tiles', 2, 2, 72)
      await meta.saveTile(id, 'a', 'full', new Uint8Array(16).buffer)
      await meta.saveTile(id, 'b', 'full', new Uint8Array(16).buffer)
      await meta.deleteLayerTiles(id, 'a')
      expect(await meta.loadTile(id, 'a', 'full')).toBeNull()
      expect(await meta.loadTile(id, 'b', 'full')).not.toBeNull()
    })
  })
})
