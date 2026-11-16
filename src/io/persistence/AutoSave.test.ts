import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { AutoSave, type LayerDataSet, type SaveStatus } from './AutoSave.ts'
import { MetadataDB } from './MetadataDB.ts'
import { resetDB } from '../../db/schema.ts'
import { IdbTileBackend } from '../tiles/IdbTileBackend.ts'
import { TileStore } from '../tiles/TileStore.ts'
import { layerInfo } from '../../test/fakeDocumentEngine.ts'

/** A one-pixel document; opaque pixels load back exactly. */
function createMockData(pixel = [1, 2, 3, 255]): LayerDataSet {
  return {
    width: 1,
    height: 1,
    layers: [{ info: layerInfo('layer-1', 'Background'), pixels: new Uint8Array(pixel) }],
  }
}

describe('AutoSave', () => {
  let metaDb: MetadataDB
  let store: TileStore
  let projectId: string

  beforeEach(async () => {
    resetDB()
    indexedDB.deleteDatabase('QuarArtistDB')
    metaDb = new MetadataDB()
    const idb = new IdbTileBackend()
    store = new TileStore({ write: idb, read: { idb } })
    projectId = await metaDb.createProject('Test', 100, 100, 72)
  })

  /** The saved pixels of each layer, by id. */
  async function savedPixels() {
    const doc = await store.load(projectId)
    return new Map(doc?.layers.map((l) => [l.info.id, l.pixels && [...l.pixels]]))
  }

  describe('debounce behavior', () => {
    it('hasPendingSave is true after scheduleSave', () => {
      vi.useFakeTimers()
      const autoSave = new AutoSave(metaDb, store, 5000)
      autoSave.setProjectId(projectId)
      autoSave.setDataExtractor(() => createMockData())

      autoSave.scheduleSave()
      expect(autoSave.hasPendingSave).toBe(true)

      autoSave.destroy()
      vi.useRealTimers()
    })

    it('cancel stops pending save', () => {
      vi.useFakeTimers()
      const autoSave = new AutoSave(metaDb, store, 5000)
      autoSave.setProjectId(projectId)
      autoSave.setDataExtractor(() => createMockData())

      autoSave.scheduleSave()
      autoSave.cancel()
      expect(autoSave.hasPendingSave).toBe(false)

      autoSave.destroy()
      vi.useRealTimers()
    })

    it('saveNow cancels pending debounced save', async () => {
      vi.useFakeTimers()
      const autoSave = new AutoSave(metaDb, store, 5000)
      autoSave.setProjectId('missing') // non-existent — won't actually save
      autoSave.setDataExtractor(() => null) // no data to save

      autoSave.scheduleSave()
      expect(autoSave.hasPendingSave).toBe(true)

      await autoSave.saveNow()
      expect(autoSave.hasPendingSave).toBe(false)

      autoSave.destroy()
      vi.useRealTimers()
    })

    it('destroy cleans up pending timer', () => {
      vi.useFakeTimers()
      const autoSave = new AutoSave(metaDb, store, 5000)
      autoSave.setProjectId(projectId)
      autoSave.setDataExtractor(() => createMockData())

      autoSave.scheduleSave()
      autoSave.destroy()
      expect(autoSave.hasPendingSave).toBe(false)

      vi.useRealTimers()
    })
  })

  describe('save operations (real timers)', () => {
    it('saveNow saves immediately and reports saved status', async () => {
      const autoSave = new AutoSave(metaDb, store, 5000)
      autoSave.setProjectId(projectId)
      autoSave.setDataExtractor(() => createMockData())

      const statuses: SaveStatus[] = []
      autoSave.setStatusCallback((s) => statuses.push(s))

      await autoSave.saveNow()

      expect(statuses).toContain('saving')
      expect(statuses).toContain('saved')
      autoSave.destroy()
    })

    it('saves the layers to the document store', async () => {
      const autoSave = new AutoSave(metaDb, store, 5000)
      autoSave.setProjectId(projectId)
      autoSave.setDataExtractor(() => createMockData())

      await autoSave.saveNow()

      const doc = (await store.load(projectId))!
      expect(doc.layers.map((l) => l.info)).toEqual([layerInfo('layer-1', 'Background')])
      expect([...doc.layers[0].pixels!]).toEqual([1, 2, 3, 255])
      autoSave.destroy()
    })

    it('does nothing when projectId is not set', async () => {
      const autoSave = new AutoSave(metaDb, store, 100)
      autoSave.setDataExtractor(() => createMockData())

      const statuses: SaveStatus[] = []
      autoSave.setStatusCallback((s) => statuses.push(s))

      await autoSave.saveNow()
      expect(statuses).toHaveLength(0)
      autoSave.destroy()
    })

    it('does nothing when extractor is not set', async () => {
      const autoSave = new AutoSave(metaDb, store, 100)
      autoSave.setProjectId(projectId)

      const statuses: SaveStatus[] = []
      autoSave.setStatusCallback((s) => statuses.push(s))

      await autoSave.saveNow()
      expect(statuses).toHaveLength(0)
      autoSave.destroy()
    })

    it('does nothing when extractor returns null', async () => {
      const autoSave = new AutoSave(metaDb, store, 100)
      autoSave.setProjectId(projectId)
      autoSave.setDataExtractor(() => null)

      const statuses: SaveStatus[] = []
      autoSave.setStatusCallback((s) => statuses.push(s))

      await autoSave.saveNow()
      expect(statuses).toHaveLength(0)
      autoSave.destroy()
    })

    it('updates project timestamp on save', async () => {
      const before = (await metaDb.getProject(projectId))!.updatedAt

      const autoSave = new AutoSave(metaDb, store, 5000)
      autoSave.setProjectId(projectId)
      autoSave.setDataExtractor(() => createMockData())

      await autoSave.saveNow()

      const after = (await metaDb.getProject(projectId))!.updatedAt
      expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime())
      autoSave.destroy()
    })

    it('writes the size, active layer and thumbnail to the project record', async () => {
      const thumbnail = { type: 'image/webp', data: new Uint8Array([1, 2, 3]).buffer }
      const autoSave = new AutoSave(metaDb, store, 5000)
      autoSave.setProjectId(projectId)
      autoSave.setDataExtractor(() => ({
        width: 64,
        height: 48,
        layers: [{ info: layerInfo('layer-1', 'Background'), pixels: new Uint8Array(64 * 48 * 4) }],
        activeLayerId: 'layer-1',
        thumbnail: async () => thumbnail,
      }))

      expect(await autoSave.saveNow()).toBe(true)

      const project = (await metaDb.getProject(projectId))!
      expect(project).toMatchObject({ width: 64, height: 48, activeLayerId: 'layer-1' })
      expect(project.thumbnail?.type).toBe('image/webp')
      expect(new Uint8Array(project.thumbnail!.data)).toEqual(new Uint8Array([1, 2, 3]))
      autoSave.destroy()
    })

    it('saves even when the thumbnail fails to encode', async () => {
      const autoSave = new AutoSave(metaDb, store, 5000)
      autoSave.setProjectId(projectId)
      autoSave.setDataExtractor(() => ({ ...createMockData(), thumbnail: () => Promise.reject(new Error('no canvas')) }))

      expect(await autoSave.saveNow()).toBe(true)
      expect((await savedPixels()).get('layer-1')).toEqual([1, 2, 3, 255])
      autoSave.destroy()
    })

    it('drops the layers deleted since the last save', async () => {
      const autoSave = new AutoSave(metaDb, store, 5000)
      autoSave.setProjectId(projectId)
      const two = createMockData()
      two.layers.push({ info: layerInfo('layer-2', 'Ink'), pixels: new Uint8Array([5, 6, 7, 255]) })
      let data = two
      autoSave.setDataExtractor(() => data)
      await autoSave.saveNow()
      expect([...(await savedPixels()).keys()]).toEqual(['layer-1', 'layer-2'])

      data = createMockData()
      await autoSave.saveNow()

      expect([...(await savedPixels()).keys()]).toEqual(['layer-1'])
      autoSave.destroy()
    })
  })

  describe('flush and failures', () => {
    function started(debounceMs = 5000) {
      const autoSave = new AutoSave(metaDb, store, debounceMs)
      autoSave.setProjectId(projectId)
      autoSave.setDataExtractor(() => createMockData())
      return autoSave
    }

    it('fails one save, not every later one, when reading the pixels back throws', async () => {
      const statuses: SaveStatus[] = []
      const autoSave = new AutoSave(metaDb, store, 5000)
      autoSave.setProjectId(projectId)
      autoSave.setStatusCallback((s) => statuses.push(s))
      const outOfMemory = new RangeError('Array buffer allocation failed')
      const extract = vi.fn<() => LayerDataSet | null>(() => {
        throw outOfMemory
      })
      autoSave.setDataExtractor(extract)
      autoSave.scheduleSave()

      expect(await autoSave.flush()).toBe(false)
      expect(statuses).toEqual(['error'])
      expect(autoSave.lastError).toBe(outOfMemory)
      expect(autoSave.hasUnsavedChanges).toBe(true)

      // The next save reads again, and works.
      extract.mockImplementation(() => createMockData())
      expect(await autoSave.flush()).toBe(true)
      expect(extract).toHaveBeenCalledTimes(2)
      expect(statuses).toEqual(['error', 'saving', 'saved'])
      expect(autoSave.hasUnsavedChanges).toBe(false)
      expect((await savedPixels()).get('layer-1')).toEqual([1, 2, 3, 255])
      autoSave.destroy()
    })

    it('forgets unsaved changes and the save waiting for them', async () => {
      const autoSave = started(20)
      const save = vi.spyOn(store, 'save')
      autoSave.scheduleSave()
      autoSave.forgetUnsaved()
      expect(autoSave.hasUnsavedChanges).toBe(false)
      expect(autoSave.hasPendingSave).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(save).not.toHaveBeenCalled()
      autoSave.destroy()
    })

    it('flush saves unsaved changes at once', async () => {
      const autoSave = started()
      const save = vi.spyOn(store, 'save')
      autoSave.scheduleSave()
      expect(autoSave.hasUnsavedChanges).toBe(true)

      expect(await autoSave.flush()).toBe(true)

      expect(save).toHaveBeenCalledTimes(1)
      expect(autoSave.hasPendingSave).toBe(false)
      expect(autoSave.hasUnsavedChanges).toBe(false)
      autoSave.destroy()
    })

    it('flush with nothing changed writes nothing', async () => {
      const autoSave = started()
      const save = vi.spyOn(store, 'save')
      expect(await autoSave.flush()).toBe(true)
      expect(save).not.toHaveBeenCalled()
      autoSave.destroy()
    })

    it('flush waits for a save already running', async () => {
      const autoSave = started()
      let release!: () => void
      vi.spyOn(store, 'save').mockImplementationOnce((...args) => new Promise((resolve) => { release = () => resolve(store.save(...args)) }))
      const running = autoSave.saveNow()
      await vi.waitFor(() => expect(release).toBeDefined())

      let flushed = false
      const flush = autoSave.flush().then((ok) => { flushed = ok })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(flushed).toBe(false)
      expect(autoSave.hasUnsavedChanges).toBe(true)

      release()
      await Promise.all([running, flush])
      expect(flushed).toBe(true)
      autoSave.destroy()
    })

    it('runs again after a save that a change arrived during, so nothing is dropped', async () => {
      const autoSave = started()
      let version = 1
      autoSave.setDataExtractor(() => createMockData([version, 0, 0, 255]))
      let release!: () => void
      vi.spyOn(store, 'save').mockImplementationOnce((...args) => new Promise((resolve) => { release = () => resolve(store.save(...args)) }))

      const first = autoSave.saveNow()
      await vi.waitFor(() => expect(release).toBeDefined())
      version = 2
      autoSave.scheduleSave()
      const second = autoSave.flush()
      release()

      expect(await first).toBe(true)
      expect(await second).toBe(true)
      expect((await savedPixels()).get('layer-1')).toEqual([2, 0, 0, 255])
      expect(autoSave.hasUnsavedChanges).toBe(false)
      autoSave.destroy()
    })

    it('keeps changes unsaved and reports why when a save fails', async () => {
      const autoSave = started()
      const failure = new Error('QuotaExceededError')
      vi.spyOn(store, 'save').mockRejectedValueOnce(failure)
      const statuses: [SaveStatus, unknown][] = []
      autoSave.setStatusCallback((s, err) => statuses.push([s, err]))

      autoSave.scheduleSave()
      expect(await autoSave.flush()).toBe(false)

      expect(statuses.at(-1)).toEqual(['error', failure])
      expect(autoSave.lastError).toBe(failure)
      expect(autoSave.hasUnsavedChanges).toBe(true)

      // The next try succeeds and clears the error.
      expect(await autoSave.flush()).toBe(true)
      expect(autoSave.lastError).toBeNull()
      expect(autoSave.hasUnsavedChanges).toBe(false)
      autoSave.destroy()
    })

    it('saves after the debounce once changes stop', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        const autoSave = started(1000)
        const save = vi.spyOn(store, 'save')
        autoSave.scheduleSave()
        vi.advanceTimersByTime(600)
        autoSave.scheduleSave()
        vi.advanceTimersByTime(600)
        expect(save).not.toHaveBeenCalled()
        vi.advanceTimersByTime(400)
        expect(save).toHaveBeenCalledTimes(1)
        vi.useRealTimers()
        await autoSave.flush()
        autoSave.destroy()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
