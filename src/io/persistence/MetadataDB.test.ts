import { describe, it, expect, beforeEach } from 'vitest'
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
    it('creates a project and returns its id', async () => {
      const id = await meta.createProject('My Art', 1920, 1080, 72)
      expect(id).toBeGreaterThan(0)
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
      await meta.createProject('Newer', 200, 200, 72)

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
      await expect(meta.duplicateProject(9999, 'Ghost')).rejects.toThrow()
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
      const result = await meta.loadTile(999, 'x', 'y')
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
})
