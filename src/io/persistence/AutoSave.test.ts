import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { AutoSave, type LayerDataSet, type SaveStatus } from './AutoSave.ts'
import { MetadataDB } from './MetadataDB.ts'
import { resetDB } from '../../db/schema.ts'

function createMockData(): LayerDataSet {
  return {
    layerInfos: [{
      id: 'layer-1',
      name: 'Background',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      alphaLock: false,
      clippingMask: false,
      locked: false,
    }],
    layerPixels: [{
      layerId: 'layer-1',
      pixels: new Uint8Array([1, 2, 3, 4]),
    }],
  }
}

describe('AutoSave', () => {
  let metaDb: MetadataDB
  let projectId: number

  beforeEach(async () => {
    resetDB()
    indexedDB.deleteDatabase('QuarArtistDB')
    metaDb = new MetadataDB()
    projectId = await metaDb.createProject('Test', 100, 100, 72)
  })

  describe('debounce behavior', () => {
    it('hasPendingSave is true after scheduleSave', () => {
      vi.useFakeTimers()
      const autoSave = new AutoSave(metaDb, 5000)
      autoSave.setProjectId(projectId)
      autoSave.setDataExtractor(() => createMockData())

      autoSave.scheduleSave()
      expect(autoSave.hasPendingSave).toBe(true)

      autoSave.destroy()
      vi.useRealTimers()
    })

    it('cancel stops pending save', () => {
      vi.useFakeTimers()
      const autoSave = new AutoSave(metaDb, 5000)
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
      const autoSave = new AutoSave(metaDb, 5000)
      autoSave.setProjectId(999) // non-existent — won't actually save
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
      const autoSave = new AutoSave(metaDb, 5000)
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
      const autoSave = new AutoSave(metaDb, 5000)
      autoSave.setProjectId(projectId)
      autoSave.setDataExtractor(() => createMockData())

      const statuses: SaveStatus[] = []
      autoSave.setStatusCallback((s) => statuses.push(s))

      await autoSave.saveNow()

      expect(statuses).toContain('saving')
      expect(statuses).toContain('saved')
      autoSave.destroy()
    })

    it('saves layer metadata to database', async () => {
      const autoSave = new AutoSave(metaDb, 5000)
      autoSave.setProjectId(projectId)
      autoSave.setDataExtractor(() => createMockData())

      await autoSave.saveNow()

      const layers = await metaDb.loadLayers(projectId)
      expect(layers).toHaveLength(1)
      expect(layers[0].layerId).toBe('layer-1')
      expect(layers[0].name).toBe('Background')
      autoSave.destroy()
    })

    it('saves tile data to database', async () => {
      const autoSave = new AutoSave(metaDb, 5000)
      autoSave.setProjectId(projectId)
      autoSave.setDataExtractor(() => createMockData())

      await autoSave.saveNow()

      const tile = await metaDb.loadTile(projectId, 'layer-1', 'full')
      expect(tile).not.toBeNull()
      expect(new Uint8Array(tile!)).toEqual(new Uint8Array([1, 2, 3, 4]))
      autoSave.destroy()
    })

    it('does nothing when projectId is not set', async () => {
      const autoSave = new AutoSave(metaDb, 100)
      autoSave.setDataExtractor(() => createMockData())

      const statuses: SaveStatus[] = []
      autoSave.setStatusCallback((s) => statuses.push(s))

      await autoSave.saveNow()
      expect(statuses).toHaveLength(0)
      autoSave.destroy()
    })

    it('does nothing when extractor is not set', async () => {
      const autoSave = new AutoSave(metaDb, 100)
      autoSave.setProjectId(projectId)

      const statuses: SaveStatus[] = []
      autoSave.setStatusCallback((s) => statuses.push(s))

      await autoSave.saveNow()
      expect(statuses).toHaveLength(0)
      autoSave.destroy()
    })

    it('does nothing when extractor returns null', async () => {
      const autoSave = new AutoSave(metaDb, 100)
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

      const autoSave = new AutoSave(metaDb, 5000)
      autoSave.setProjectId(projectId)
      autoSave.setDataExtractor(() => createMockData())

      await autoSave.saveNow()

      const after = (await metaDb.getProject(projectId))!.updatedAt
      expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime())
      autoSave.destroy()
    })
  })
})
