import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { getDB, resetDB, type QuarDB } from './schema.ts'

describe('QuarDB schema', () => {
  let testDb: QuarDB

  beforeEach(async () => {
    resetDB()
    // Delete the database to start fresh
    indexedDB.deleteDatabase('QuarArtistDB')
    testDb = await getDB()
  })

  describe('projects store', () => {
    it('adds and retrieves a project', async () => {
      const id = await testDb.add('projects', {
        name: 'Test Project',
        width: 1920,
        height: 1080,
        dpi: 72,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      expect(id).toBeGreaterThan(0)

      const project = await testDb.get('projects', id)
      expect(project).toBeDefined()
      expect(project!.name).toBe('Test Project')
      expect(project!.width).toBe(1920)
    })

    it('lists all projects', async () => {
      await testDb.add('projects', {
        name: 'P1',
        width: 100,
        height: 100,
        dpi: 72,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      await testDb.add('projects', {
        name: 'P2',
        width: 200,
        height: 200,
        dpi: 150,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const all = await testDb.getAll('projects')
      expect(all).toHaveLength(2)
    })

    it('updates a project', async () => {
      const id = await testDb.add('projects', {
        name: 'Old Name',
        width: 100,
        height: 100,
        dpi: 72,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      const project = await testDb.get('projects', id)
      await testDb.put('projects', { ...project!, name: 'New Name' })

      const updated = await testDb.get('projects', id)
      expect(updated!.name).toBe('New Name')
    })

    it('deletes a project', async () => {
      const id = await testDb.add('projects', {
        name: 'Delete Me',
        width: 100,
        height: 100,
        dpi: 72,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      await testDb.delete('projects', id)

      const result = await testDb.get('projects', id)
      expect(result).toBeUndefined()
    })
  })

  describe('layers store', () => {
    it('adds layers for a project', async () => {
      await testDb.add('layers', {
        projectId: 1,
        layerId: 'layer-1',
        name: 'Background',
        blendMode: 'normal',
        opacity: 1,
        visible: true,
        locked: false,
        alphaLock: false,
        clippingMask: false,
        order: 0,
      })

      const layers = await testDb.getAllFromIndex('layers', 'by-projectId', 1)
      expect(layers).toHaveLength(1)
      expect(layers[0].name).toBe('Background')
      expect(layers[0].layerId).toBe('layer-1')
    })
  })

  describe('tiles store', () => {
    it('stores and retrieves binary tile data', async () => {
      const data = new ArrayBuffer(16)
      new Uint8Array(data).fill(42)

      const id = await testDb.add('tiles', {
        projectId: 1,
        layerId: 'layer-1',
        key: 'full',
        data,
      })

      const tile = await testDb.get('tiles', id)
      expect(tile).toBeDefined()
      expect(new Uint8Array(tile!.data)[0]).toBe(42)
    })
  })

  describe('settings store', () => {
    it('stores and retrieves settings', async () => {
      await testDb.put('settings', { key: 'theme', value: 'dark' })
      const setting = await testDb.get('settings', 'theme')
      expect(setting).toBeDefined()
      expect(setting!.value).toBe('dark')
    })

    it('overwrites existing settings', async () => {
      await testDb.put('settings', { key: 'zoom', value: '1.0' })
      await testDb.put('settings', { key: 'zoom', value: '2.0' })
      const setting = await testDb.get('settings', 'zoom')
      expect(setting!.value).toBe('2.0')
    })
  })

  describe('indexes', () => {
    it('can query layers by project-layer compound index', async () => {
      await testDb.add('layers', {
        projectId: 1,
        layerId: 'layer-1',
        name: 'BG',
        blendMode: 'normal',
        opacity: 1,
        visible: true,
        locked: false,
        alphaLock: false,
        clippingMask: false,
        order: 0,
      })

      const result = await testDb.getFromIndex('layers', 'by-project-layer', [1, 'layer-1'])
      expect(result).toBeDefined()
      expect(result!.name).toBe('BG')
    })

    it('can query tiles by compound index', async () => {
      await testDb.add('tiles', {
        projectId: 1,
        layerId: 'layer-1',
        key: 'full',
        data: new ArrayBuffer(4),
      })

      const result = await testDb.getFromIndex('tiles', 'by-project-layer-key', [1, 'layer-1', 'full'])
      expect(result).toBeDefined()
    })
  })
})
