import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { deleteDB, openDB, type IDBPDatabase } from 'idb'
import { DB_NAME, getDB, resetDB, type QuarDB } from './schema.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** A project record as version 1 stored it, before the database assigned its id. */
const v1Project = (name: string) => ({
  name,
  width: 100,
  height: 100,
  dpi: 72,
  createdAt: new Date(),
  updatedAt: new Date(),
})

const project = (id: string, name: string) => ({ id, ...v1Project(name) })

const layer = (projectId: unknown, name: string) => ({
  projectId,
  layerId: 'layer-1',
  name,
  blendMode: 'normal',
  opacity: 1,
  visible: true,
  locked: false,
  alphaLock: false,
  clippingMask: false,
  order: 0,
})

describe('QuarDB schema', () => {
  let testDb: QuarDB

  beforeEach(async () => {
    resetDB()
    // Delete the database to start fresh
    indexedDB.deleteDatabase(DB_NAME)
    testDb = await getDB()
  })

  describe('projects store', () => {
    it('adds and retrieves a project by its id', async () => {
      const id = await testDb.add('projects', { ...project('p1', 'Test Project'), width: 1920, height: 1080 })
      expect(id).toBe('p1')

      const stored = await testDb.get('projects', id)
      expect(stored).toBeDefined()
      expect(stored!.name).toBe('Test Project')
      expect(stored!.width).toBe(1920)
    })

    it('lists all projects', async () => {
      await testDb.add('projects', project('p1', 'P1'))
      await testDb.add('projects', project('p2', 'P2'))

      const all = await testDb.getAll('projects')
      expect(all).toHaveLength(2)
    })

    it('updates a project', async () => {
      const id = await testDb.add('projects', project('p1', 'Old Name'))
      const stored = await testDb.get('projects', id)
      await testDb.put('projects', { ...stored!, name: 'New Name' })

      const updated = await testDb.get('projects', id)
      expect(updated!.name).toBe('New Name')
    })

    it('deletes a project', async () => {
      const id = await testDb.add('projects', project('p1', 'Delete Me'))
      await testDb.delete('projects', id)

      const result = await testDb.get('projects', id)
      expect(result).toBeUndefined()
    })
  })

  describe('layers store', () => {
    it('adds layers for a project', async () => {
      await testDb.add('layers', layer('p1', 'Background') as never)

      const layers = await testDb.getAllFromIndex('layers', 'by-projectId', 'p1')
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
        projectId: 'p1',
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
      await testDb.add('layers', layer('p1', 'BG') as never)

      const result = await testDb.getFromIndex('layers', 'by-project-layer', ['p1', 'layer-1'])
      expect(result).toBeDefined()
      expect(result!.name).toBe('BG')
    })

    it('can query tiles by compound index', async () => {
      await testDb.add('tiles', {
        projectId: 'p1',
        layerId: 'layer-1',
        key: 'full',
        data: new ArrayBuffer(4),
      })

      const result = await testDb.getFromIndex('tiles', 'by-project-layer-key', ['p1', 'layer-1', 'full'])
      expect(result).toBeDefined()
    })
  })
})

describe('QuarDB upgrade from version 1', () => {
  /** Create the database as version 1 left it, with projects keyed by an auto-incremented number. */
  async function createVersion1(seed: (db: IDBPDatabase) => Promise<void>) {
    await deleteDB(DB_NAME)
    const db = await openDB(DB_NAME, 1, {
      upgrade(v1) {
        const projects = v1.createObjectStore('projects', { keyPath: 'id', autoIncrement: true })
        projects.createIndex('by-name', 'name')
        projects.createIndex('by-updatedAt', 'updatedAt')
        const layers = v1.createObjectStore('layers', { keyPath: 'id', autoIncrement: true })
        layers.createIndex('by-projectId', 'projectId')
        layers.createIndex('by-project-layer', ['projectId', 'layerId'])
        const tiles = v1.createObjectStore('tiles', { keyPath: 'id', autoIncrement: true })
        tiles.createIndex('by-projectId', 'projectId')
        tiles.createIndex('by-project-layer-key', ['projectId', 'layerId', 'key'])
        v1.createObjectStore('settings', { keyPath: 'key' })
      },
    })
    await seed(db)
    db.close()
  }

  beforeEach(() => resetDB())
  afterEach(() => resetDB())

  it('gives every project a UUID and keeps its layers and tiles with it', async () => {
    await createVersion1(async (db) => {
      const aId = await db.add('projects', v1Project('A'))
      const bId = await db.add('projects', v1Project('B'))
      await db.add('layers', layer(aId, 'A1'))
      await db.add('layers', layer(bId, 'B1'))
      await db.add('tiles', { projectId: bId, layerId: 'layer-1', key: 'full', data: new Uint8Array([7]).buffer })
      await db.put('settings', { key: 'theme', value: 'dark' })
    })

    const db = await getDB()
    const projects = await db.getAll('projects')
    expect(projects.map((p) => p.name).sort()).toEqual(['A', 'B'])
    for (const p of projects) expect(p.id).toMatch(UUID)

    const b = projects.find((p) => p.name === 'B')!
    const layers = await db.getAllFromIndex('layers', 'by-projectId', b.id)
    expect(layers.map((l) => l.name)).toEqual(['B1'])
    const tile = await db.getFromIndex('tiles', 'by-project-layer-key', [b.id, 'layer-1', 'full'])
    expect([...new Uint8Array(tile!.data)]).toEqual([7])
    expect(await db.get('settings', 'theme')).toEqual({ key: 'theme', value: 'dark' })
  })

  it('accepts new projects under the ids they are given', async () => {
    await createVersion1(async () => {})
    const db = await getDB()
    await db.add('projects', project('p1', 'New'))
    expect((await db.get('projects', 'p1'))!.name).toBe('New')
  })

  it('drops layers and tiles whose project no longer exists', async () => {
    await createVersion1(async (db) => {
      await db.add('layers', layer(42, 'Orphan'))
      await db.add('tiles', { projectId: 42, layerId: 'layer-1', key: 'full', data: new ArrayBuffer(4) })
    })
    const db = await getDB()
    expect(await db.count('layers')).toBe(0)
    expect(await db.count('tiles')).toBe(0)
  })
})
