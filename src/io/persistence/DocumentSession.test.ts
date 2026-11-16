import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { deleteDB } from 'idb'
import { DocumentSession } from './DocumentSession.ts'
import { MetadataDB } from './MetadataDB.ts'
import type { SaveStatus } from './AutoSave.ts'
import { DB_NAME, resetDB } from '../../db/schema.ts'
import { IdbTileBackend } from '../tiles/IdbTileBackend.ts'
import { TileStore } from '../tiles/TileStore.ts'
import { FakeDocumentEngine } from '../../test/fakeDocumentEngine.ts'

describe('DocumentSession', () => {
  let db: MetadataDB
  let store: TileStore
  let projectId: string

  beforeEach(async () => {
    resetDB()
    await deleteDB(DB_NAME)
    db = new MetadataDB()
    const idb = new IdbTileBackend()
    store = new TileStore({ write: idb, read: { idb } })
    projectId = await db.createProject('Painting', 2, 2, 72)
  })

  /** The red of a saved layer's first pixel, or null when it has none saved. */
  const firstByte = async (id: string, layerId: string) => {
    const doc = await store.load(id)
    const pixels = doc?.layers.find((l) => l.info.id === layerId)?.pixels
    return pixels ? pixels[0] : null
  }

  it('saves the engine\'s document a moment after each change', async () => {
    const session = new DocumentSession(projectId, db, store, undefined, 10)
    const engine = new FakeDocumentEngine()
    session.attach(engine)

    engine.addLayer('ink', 'Ink')
    engine.paint(7)

    await vi.waitFor(async () => expect(await firstByte(projectId, 'ink')).toBe(7))
    expect((await store.load(projectId))!.layers.map((l) => l.info.id)).toEqual(['default', 'ink'])
    expect(await db.getProject(projectId)).toMatchObject({ width: 2, height: 2, activeLayerId: 'ink' })
    expect(session.hasUnsavedChanges).toBe(false)
    await session.close()
  })

  it('reports its save status', async () => {
    const statuses: SaveStatus[] = []
    const session = new DocumentSession(projectId, db, store, (s) => statuses.push(s), 10)
    const engine = new FakeDocumentEngine()
    session.attach(engine)
    engine.paint(1)
    await session.flush()
    expect(statuses).toEqual(['saving', 'saved'])
    await session.close()
  })

  it('only ever writes to its own project', async () => {
    const other = await db.createProject('Other', 2, 2, 72)
    const first = new DocumentSession(projectId, db, store, undefined, 10)
    const engine = new FakeDocumentEngine()
    first.attach(engine)
    engine.paint(3)
    expect(await first.close()).toBe(true)

    // The next document, in a new engine, saves to the next project only.
    const second = new DocumentSession(other, db, store, undefined, 10)
    const next = new FakeDocumentEngine()
    second.attach(next)
    next.paint(9)
    await second.flush()

    expect(await firstByte(projectId, 'default')).toBe(3)
    expect(await firstByte(other, 'default')).toBe(9)
    await second.close()
  })

  it('stops following the engine when detached, and keeps the change marked unsaved', async () => {
    const session = new DocumentSession(projectId, db, store, undefined, 10)
    const engine = new FakeDocumentEngine()
    session.attach(engine)
    engine.paint(4)
    session.detach()

    expect(engine.following).toBe(false)
    expect(session.hasUnsavedChanges).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(await firstByte(projectId, 'default')).toBeNull()
  })

  it('saves before it closes', async () => {
    const session = new DocumentSession(projectId, db, store, undefined, 60_000)
    const engine = new FakeDocumentEngine()
    session.attach(engine)
    engine.paint(5)

    expect(await session.close()).toBe(true)
    expect(await firstByte(projectId, 'default')).toBe(5)
    expect(engine.following).toBe(false)
  })

  it('stays open, still saving, when the closing save fails', async () => {
    const session = new DocumentSession(projectId, db, store, undefined, 60_000)
    const engine = new FakeDocumentEngine()
    session.attach(engine)
    engine.paint(6)
    const failure = new Error('disk full')
    vi.spyOn(store, 'save').mockRejectedValueOnce(failure)

    expect(await session.close()).toBe(false)
    expect(session.lastError).toBe(failure)
    expect(session.hasUnsavedChanges).toBe(true)
    expect(engine.following).toBe(true)

    expect(await session.close()).toBe(true)
    expect(await firstByte(projectId, 'default')).toBe(6)
  })

  it('saves on request even with nothing changed', async () => {
    const session = new DocumentSession(projectId, db, store, undefined, 60_000)
    session.attach(new FakeDocumentEngine())
    const save = vi.spyOn(store, 'save')
    expect(await session.saveNow()).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
    await session.close()
  })

  it('knows a new engine from the same one coming back', () => {
    const session = new DocumentSession(projectId, db, store)
    const engine = new FakeDocumentEngine()
    expect(session.isNewEngine(engine)).toBe(false)
    session.attach(engine)
    session.detach()
    // React StrictMode attaches the same engine again: it still has the document.
    expect(session.isNewEngine(engine)).toBe(false)
    // A restarted canvas brings an empty engine.
    expect(session.isNewEngine(new FakeDocumentEngine())).toBe(true)
  })

  it('keeps saving while closing, until changes made during the last save are saved too', async () => {
    const session = new DocumentSession(projectId, db, store, undefined, 60_000)
    const engine = new FakeDocumentEngine()
    session.attach(engine)
    engine.paint(1)
    // A stroke lands while the closing save writes the pixels it already read.
    const save = store.save.bind(store)
    let strokes = 0
    vi.spyOn(store, 'save').mockImplementation(async (...args) => {
      if (strokes++ === 0) engine.paint(2)
      return save(...args)
    })

    expect(await session.close()).toBe(true)

    expect(await firstByte(projectId, 'default')).toBe(2)
    expect(engine.following).toBe(false)
  })

  it('stays open when reading the pixels back fails, and closes once it works', async () => {
    const session = new DocumentSession(projectId, db, store, undefined, 60_000)
    const engine = new FakeDocumentEngine()
    session.attach(engine)
    engine.paint(8)
    engine.readFailure = new RangeError('Array buffer allocation failed')

    expect(await session.close()).toBe(false)
    expect(session.lastError).toBe(engine.readFailure)
    expect(engine.following).toBe(true)

    engine.readFailure = null
    expect(await session.close()).toBe(true)
    expect(await firstByte(projectId, 'default')).toBe(8)
  })

  it('keeps the last thumbnail while a preview shows', async () => {
    const session = new DocumentSession(projectId, db, store, undefined, 60_000)
    const engine = new FakeDocumentEngine()
    session.attach(engine)

    engine.previewing = true
    engine.paint(1)
    await session.flush()
    expect(engine.compositeReads).toBe(0)

    engine.previewing = false
    engine.paint(2)
    await session.flush()
    expect(engine.compositeReads).toBe(1)
    await session.close()
  })

  it('can forget unsaved changes, and stop without saving', async () => {
    const session = new DocumentSession(projectId, db, store, undefined, 10)
    const engine = new FakeDocumentEngine()
    session.attach(engine)
    engine.paint(5)
    session.forgetUnsaved()
    expect(session.hasUnsavedChanges).toBe(false)

    engine.paint(6)
    session.discard()
    expect(engine.following).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(await firstByte(projectId, 'default')).toBeNull()
  })
})
