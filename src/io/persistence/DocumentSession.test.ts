import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import 'fake-indexeddb/auto'
import { deleteDB } from 'idb'
import { DocumentSession, THUMBNAIL_EVERY_MS } from './DocumentSession.ts'
import { MetadataDB } from './MetadataDB.ts'
import type { SaveStatus } from './AutoSave.ts'
import { DB_NAME, resetDB } from '../../db/schema.ts'
import { IdbTileBackend } from '../tiles/IdbTileBackend.ts'
import { TileStore, type DocumentToSave } from '../tiles/TileStore.ts'
import { FakeDocumentEngine } from '../../test/fakeDocumentEngine.ts'
import { defaultGuides } from '../../stores/guideStore.ts'
import { sameBytes } from '../../test/bytes.ts'

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
    // Edited, then saved: one save, which brings the thumbnail up to date too.
    expect(statuses).toEqual(['pending', 'saving', 'saved'])
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
  describe('the view and guides saved with the project (plan M1.4)', () => {
    const guides = { ...defaultGuides(2, 2), gridEnabled: true }

    it('writes them to the project record with every save', async () => {
      const session = new DocumentSession(projectId, db, store, undefined, 10)
      session.setSettingsSource(() => ({ guides }))
      const engine = new FakeDocumentEngine()
      engine.view = { x: 1, y: 1, zoom: 4, rotation: 0 }
      session.attach(engine)
      engine.paint(3)
      expect(await session.flush()).toBe(true)
      expect(await db.getProject(projectId)).toMatchObject({ view: engine.view, guides })
      await session.close()
    })

    it("writes the view when the project closes or the page is hidden, without counting it as a change", async () => {
      const session = new DocumentSession(projectId, db, store, undefined, 10)
      session.setSettingsSource(() => ({ guides }))
      const engine = new FakeDocumentEngine()
      session.attach(engine)
      engine.paint(3)
      await session.flush()
      const modified = (await db.getProject(projectId))!.updatedAt

      // Zooming isn't an edit: nothing waits to be saved.
      engine.view = { x: 0.5, y: 1.5, zoom: 8, rotation: 1 }
      expect(session.hasUnsavedChanges).toBe(false)
      expect(await session.capture()).toBe(true)
      await vi.waitFor(async () => expect((await db.getProject(projectId))!.view).toEqual(engine.view))

      engine.view = { x: 1, y: 1, zoom: 2, rotation: 0 }
      expect(await session.close()).toBe(true)
      const record = (await db.getProject(projectId))!
      expect(record.view).toEqual(engine.view)
      // The Gallery's order stays: the project wasn't modified.
      expect(record.updatedAt).toEqual(modified)
    })

    it("doesn't write them again when they didn't change", async () => {
      const view = { x: 1, y: 1, zoom: 4, rotation: 0 }
      const session = new DocumentSession(projectId, db, store, undefined, 10)
      session.setSettingsSource(() => ({ guides }), { view, guides, activeLayerId: 'default' })
      const engine = new FakeDocumentEngine()
      engine.view = { ...view }
      session.attach(engine)
      const update = vi.spyOn(db, 'updateProject')
      expect(await session.capture()).toBe(true)
      expect(await session.close()).toBe(true)
      expect(update).not.toHaveBeenCalled()
    })

    it('writes the selected layer when the project closes, though choosing one is no edit', async () => {
      const session = new DocumentSession(projectId, db, store, undefined, 10)
      session.setSettingsSource(() => ({ guides }), { guides, activeLayerId: 'default' })
      const engine = new FakeDocumentEngine()
      session.attach(engine)
      engine.addLayer('ink', 'Ink')
      await session.flush()
      expect((await db.getProject(projectId))!.activeLayerId).toBe('ink')

      engine.activeLayerId = 'default'
      expect(session.hasUnsavedChanges).toBe(false)
      expect(await session.close()).toBe(true)
      expect((await db.getProject(projectId))!.activeLayerId).toBe('default')
    })

    it('keeps the view the user left when the page is hidden while a save finishes', async () => {
      const session = new DocumentSession(projectId, db, store, undefined, 10)
      session.setSettingsSource(() => ({ guides }), { guides })
      const engine = new FakeDocumentEngine()
      const before = { x: 1, y: 1, zoom: 1, rotation: 0 }
      const after = { x: 0.5, y: 0.5, zoom: 8, rotation: 0 }
      engine.view = before
      session.attach(engine)

      // A save of a stroke, read while the view was `before`, is finishing.
      let release!: () => void
      const held = new Promise<void>((resolve) => (release = resolve))
      let written = false
      const save = store.save.bind(store)
      vi.spyOn(store, 'save').mockImplementationOnce(async (...args) => {
        const report = await save(...args)
        written = true
        await held
        return report
      })
      engine.paint(3)
      const saving = session.saveNow()
      await vi.waitFor(() => expect(written).toBe(true))

      // The user zooms (not an edit) and the page is hidden: the view is written now.
      engine.view = after
      const update = vi.spyOn(db, 'updateProject')
      const capturing = session.capture()
      release()
      expect(await capturing).toBe(true)
      expect(await saving).toBe(true)
      expect(await session.close()).toBe(true)

      // The save's record went after, without the view it would have read first.
      expect(update.mock.calls.map(([, changes, options]) => [changes.view?.zoom, options?.touch ?? true])).toEqual([
        [8, false],
        [undefined, true],
      ])
      expect((await db.getProject(projectId))!.view).toEqual(after)
    })

    it("doesn't overwrite guides another tab saved since, when only the view changed here", async () => {
      const opened = defaultGuides(2, 2)
      const here = new DocumentSession(projectId, db, store, undefined, 10)
      here.setSettingsSource(() => ({ guides: opened }), { guides: opened, activeLayerId: 'default' })
      const hereEngine = new FakeDocumentEngine()
      here.attach(hereEngine)

      // Another tab turns the grid on: an edit, saved with its document.
      const gridOn = { ...opened, gridEnabled: true }
      const there = new DocumentSession(projectId, db, store, undefined, 10)
      there.setSettingsSource(() => ({ guides: gridOn }), { guides: opened, activeLayerId: 'default' })
      there.attach(new FakeDocumentEngine())
      there.noteSettingsChange()
      expect(await there.flush()).toBe(true)
      expect((await db.getProject(projectId))!.guides).toEqual(gridOn)

      // Here, the user only zoomed, and closes.
      hereEngine.view = { x: 1, y: 1, zoom: 4, rotation: 0 }
      expect(await here.close()).toBe(true)

      const record = (await db.getProject(projectId))!
      expect(record.view).toEqual(hereEngine.view)
      expect(record.guides).toEqual(gridOn)
      await there.close()
    })

    it('writes the settings with the next save when the record could not be written', async () => {
      const session = new DocumentSession(projectId, db, store, undefined, 10)
      session.setSettingsSource(() => ({ guides }))
      const engine = new FakeDocumentEngine()
      engine.view = { x: 1, y: 1, zoom: 4, rotation: 0 }
      session.attach(engine)
      vi.spyOn(db, 'updateProject').mockRejectedValueOnce(new Error('the disk went away'))

      engine.paint(3)
      expect(await session.flush()).toBe(false)
      expect(await db.getProject(projectId)).not.toHaveProperty('guides')

      expect(await session.flush()).toBe(true)
      expect(await db.getProject(projectId)).toMatchObject({ view: engine.view, guides, activeLayerId: 'default' })
      await session.close()
    })

    it('saves soon after the guides change, as after any change, once it has an engine', async () => {
      const session = new DocumentSession(projectId, db, store, undefined, 10)
      let current = defaultGuides(2, 2)
      session.setSettingsSource(() => ({ guides: current }))
      // Not yet showing the document: there is nothing to save from.
      session.noteSettingsChange()
      expect(session.hasUnsavedChanges).toBe(false)

      session.attach(new FakeDocumentEngine())
      current = guides
      session.noteSettingsChange()
      expect(session.hasUnsavedChanges).toBe(true)
      await vi.waitFor(async () => expect((await db.getProject(projectId))!.guides).toEqual(guides))
      await session.close()
    })
  })

  describe('incremental saves (plan M1.3)', () => {
    // 600 × 300 is 3 × 2 tiles.
    const W = 600
    const H = 300

    afterEach(() => {
      vi.restoreAllMocks()
    })

    /** Check that the saved document is the engine's, layer for layer. */
    async function expectSavedAsShown(engine: FakeDocumentEngine) {
      const doc = (await store.load(projectId))!
      expect(doc.layers.map((l) => l.info.id)).toEqual(engine.layers.map((l) => l.info.id))
      doc.layers.forEach((layer, i) => {
        const shown = engine.layers[i].pixels
        expect(sameBytes(layer.pixels ?? new Uint8Array(shown.length), shown)).toBe(true)
      })
    }

    /** What each save was given: the save it built on, and each layer whole, as changed tiles, or kept. */
    function sent(save: MockInstance<(projectId: string, doc: DocumentToSave) => unknown>) {
      return save.mock.calls.map(([, doc]) => ({
        base: doc.base,
        layers: doc.layers.map((l) =>
          l.pixels ? 'whole' : (l.tiles ?? []).map((t) => `${t.x}_${t.y}`).sort().join(',') || 'kept',
        ),
      }))
    }

    /** A document saved as another tab would: one layer, painted at a pixel. */
    async function savedElsewhere(x: number, y: number) {
      const other = new FakeDocumentEngine(W, H)
      other.paint(9, x, y)
      return store.save(projectId, {
        width: W,
        height: H,
        layers: [{ info: other.getLayerInfos()[0], pixels: other.getLayerPixels('default') }],
      })
    }

    it('saves whole layers first, then only the tiles changed since', async () => {
      const save = vi.spyOn(store, 'save')
      const session = new DocumentSession(projectId, db, store, undefined, 10)
      const engine = new FakeDocumentEngine(W, H)
      session.attach(engine)

      engine.paint(1, 10, 10)
      await session.flush()
      engine.paint(2, 300, 10)
      engine.paint(3, 599, 299)
      await session.flush()

      expect(sent(save)).toEqual([
        { base: undefined, layers: ['whole'] },
        { base: 1, layers: ['1_0,2_1'] },
      ])
      expect(engine.layerReads).toEqual(['default'])
      expect(engine.tileReads).toEqual([{ id: 'default', tiles: ['1_0', '2_1'] }])
      await expectSavedAsShown(engine)
      await session.close()
    })

    it('builds on the save the project was opened from', async () => {
      const first = await savedElsewhere(10, 10)
      const doc = (await store.load(projectId))!
      const save = vi.spyOn(store, 'save')
      const session = new DocumentSession(projectId, db, store, undefined, 10)
      const engine = new FakeDocumentEngine(W, H)
      engine.loadDocument(doc.layers, null)
      session.setBase({ seq: doc.seq, width: W, height: H, layers: new Set(['default']) })
      session.attach(engine)

      engine.paint(5, 10, 280)
      await session.flush()
      expect(sent(save)).toEqual([{ base: first.seq, layers: ['0_1'] }])
      expect(engine.layerReads).toEqual([])
      await expectSavedAsShown(engine)
      await session.close()
    })

    it('saves a new layer from nothing, keeps the others as saved, and drops a deleted one', async () => {
      const save = vi.spyOn(store, 'save')
      const session = new DocumentSession(projectId, db, store, undefined, 60_000)
      const engine = new FakeDocumentEngine(W, H)
      session.attach(engine)
      engine.paint(1, 10, 10)
      await session.flush()

      engine.addLayer('ink', 'Ink')
      engine.paint(6, 520, 260)
      engine.addLayer('empty', 'Empty')
      await session.flush()
      expect(sent(save)[1]).toEqual({ base: 1, layers: ['kept', '2_1', 'kept'] })
      await expectSavedAsShown(engine)

      engine.removeLayer('ink')
      await session.flush()
      expect(sent(save)[2]).toEqual({ base: 2, layers: ['kept', 'kept'] })
      await expectSavedAsShown(engine)
      await session.close()
    })

    it('reads a layer whole when its change is not known by tile', async () => {
      const save = vi.spyOn(store, 'save')
      const session = new DocumentSession(projectId, db, store, undefined, 60_000)
      const engine = new FakeDocumentEngine(W, H)
      session.attach(engine)
      await session.saveNow()
      engine.fillLayer('default', 8)
      await session.flush()
      expect(sent(save)).toEqual([
        { base: undefined, layers: ['whole'] },
        { base: 1, layers: ['whole'] },
      ])
      await expectSavedAsShown(engine)
      await session.close()
    })

    it('saves whole layers when another tab saved the project since, and builds on that save next', async () => {
      const session = new DocumentSession(projectId, db, store, undefined, 60_000)
      const engine = new FakeDocumentEngine(W, H)
      session.attach(engine)
      engine.paint(1, 10, 10)
      await session.flush()
      await savedElsewhere(300, 280)

      const save = vi.spyOn(store, 'save')
      engine.paint(2, 300, 10)
      expect(await session.flush()).toBe(true)
      engine.paint(3, 10, 10)
      expect(await session.flush()).toBe(true)
      // Refused, then whole layers at once (seq 3), then changes on top of that.
      expect(sent(save)).toEqual([
        { base: 1, layers: ['1_0'] },
        { base: undefined, layers: ['whole'] },
        { base: 3, layers: ['0_0'] },
      ])
      await expectSavedAsShown(engine)
      await session.close()
    })

    it('reads the tiles of a failed save again for the next one', async () => {
      const session = new DocumentSession(projectId, db, store, undefined, 60_000)
      const engine = new FakeDocumentEngine(W, H)
      session.attach(engine)
      engine.paint(1, 10, 10)
      await session.flush()

      const save = vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('the disk is on fire'))
      engine.paint(2, 300, 10)
      expect(await session.flush()).toBe(false)
      engine.paint(3, 520, 10)
      expect(await session.flush()).toBe(true)
      expect(sent(save)).toEqual([
        { base: 1, layers: ['1_0'] },
        { base: 1, layers: ['1_0,2_0'] },
      ])
      await expectSavedAsShown(engine)
      await session.close()
    })

    it('waits for a stroke to end before a save that can wait, but not to flush', async () => {
      const save = vi.spyOn(store, 'save')
      const session = new DocumentSession(projectId, db, store, undefined, 10)
      const engine = new FakeDocumentEngine(W, H)
      session.attach(engine)
      engine.paint(1, 10, 10)
      engine.drawing = true
      await new Promise((resolve) => setTimeout(resolve, 60))
      expect(save).not.toHaveBeenCalled()
      expect(session.hasUnsavedChanges).toBe(true)

      // Once it ends, the save goes ahead without another change.
      engine.drawing = false
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))

      engine.paint(2, 300, 10)
      engine.drawing = true
      expect(await session.flush()).toBe(true)
      expect(save).toHaveBeenCalledTimes(2)
      engine.drawing = false
      await session.close()
    })

    it('keeps every change for the next save when a read throws part-way through one (review of M1.3)', async () => {
      const session = new DocumentSession(projectId, db, store, undefined, 60_000)
      const engine = new FakeDocumentEngine(W, H)
      engine.addLayer('top', 'Top')
      session.attach(engine)
      // Saved whole: the saves after build on it.
      expect(await session.saveNow()).toBe(true)

      engine.activeLayerId = 'default'
      engine.paint(1, 10, 10)
      engine.activeLayerId = 'top'
      engine.paint(2, 300, 10)
      // The bottom layer is read first; the top one's read runs out of memory.
      engine.failNextTileRead = { id: 'top', error: new Error('out of memory') }
      expect(await session.flush()).toBe(false)
      expect(session.hasUnsavedChanges).toBe(true)

      expect(await session.flush()).toBe(true)
      expect(session.hasUnsavedChanges).toBe(false)
      await expectSavedAsShown(engine)
      await session.close()
    })

    it("saves the layers when the Gallery thumbnail can't be read back (review of M1.3)", async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const session = new DocumentSession(projectId, db, store, undefined, 60_000)
      const engine = new FakeDocumentEngine(W, H)
      session.attach(engine)
      engine.paint(1, 10, 10)
      engine.paint(2, 300, 10)
      engine.failNextComposite = new Error('out of memory')

      expect(await session.flush()).toBe(true)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(session.hasUnsavedChanges).toBe(false)
      await expectSavedAsShown(engine)
      await session.close()
    })

    it("doesn't count tiles it couldn't read as saved, and saves them once it can (review of M1.3)", async () => {
      const statuses: SaveStatus[] = []
      const session = new DocumentSession(projectId, db, store, (s) => statuses.push(s), 10)
      const engine = new FakeDocumentEngine(W, H)
      session.attach(engine)
      engine.paint(1, 10, 10)
      expect(await session.flush()).toBe(true)

      engine.tilesUnreadable = true
      engine.paint(2, 300, 10)
      expect(await session.flush()).toBe(true)
      expect(session.hasUnsavedChanges).toBe(true)
      expect(statuses.at(-1)).toBe('pending')

      engine.tilesUnreadable = false
      await vi.waitFor(() => expect(session.hasUnsavedChanges).toBe(false))
      await expectSavedAsShown(engine)
      expect(statuses.at(-1)).toBe('saved')

      // Closing with tiles that never become readable doesn't save forever.
      engine.tilesUnreadable = true
      engine.paint(3, 10, 280)
      expect(await session.close()).toBe(true)
    })

    it('waits for a stroke no longer than a change ever waits, should it never end', async () => {
      const save = vi.spyOn(store, 'save')
      const session = new DocumentSession(projectId, db, store, undefined, 10, 80)
      const engine = new FakeDocumentEngine(W, H)
      session.attach(engine)
      engine.drawing = true
      engine.paint(1, 10, 10)
      await new Promise((resolve) => setTimeout(resolve, 40))
      expect(save).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
      await vi.waitFor(() => expect(session.hasUnsavedChanges).toBe(false))
      await expectSavedAsShown(engine)

      // And waits again for the next.
      engine.paint(2, 300, 10)
      await new Promise((resolve) => setTimeout(resolve, 40))
      expect(save).toHaveBeenCalledTimes(1)
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
      engine.drawing = false
      await session.close()
    })

    it('brings the Gallery thumbnail up to date at most every 30 seconds, and at every flush', async () => {
      let now = 1_000_000
      vi.spyOn(Date, 'now').mockImplementation(() => now)
      const save = vi.spyOn(store, 'save')
      const session = new DocumentSession(projectId, db, store, undefined, 10)
      const engine = new FakeDocumentEngine(W, H)
      session.attach(engine)
      const saves = (count: number) => vi.waitFor(() => expect(save).toHaveBeenCalledTimes(count))

      engine.paint(1, 10, 10)
      await saves(1)
      expect(engine.compositeReads).toBe(1)
      engine.paint(2, 10, 10)
      await saves(2)
      expect(engine.compositeReads).toBe(1)

      now += THUMBNAIL_EVERY_MS
      engine.paint(3, 10, 10)
      await saves(3)
      expect(engine.compositeReads).toBe(2)

      // Behind again: a flush catches up, with a save of its own when nothing else needs saving.
      engine.paint(4, 10, 10)
      await saves(4)
      await session.settled()
      expect(await session.flush()).toBe(true)
      expect(engine.compositeReads).toBe(3)
      expect(save).toHaveBeenCalledTimes(5)
      await session.close()
    })

    it('reads what a running save lacks when the canvas is about to go, and writes it after that save', async () => {
      const session = new DocumentSession(projectId, db, store, undefined, 60_000)
      const engine = new FakeDocumentEngine(W, H)
      session.attach(engine)
      engine.paint(1, 10, 10)
      await session.flush()

      const save = store.save.bind(store)
      let release: () => void = () => {}
      const held = new Promise<void>((resolve) => (release = resolve))
      const spy = vi.spyOn(store, 'save').mockImplementationOnce(async (...args) => {
        await held
        return save(...args)
      })
      engine.paint(2, 300, 10)
      const running = session.saveNow()
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))

      // The canvas goes: what isn't saved is read now, the running save's tiles too.
      engine.paint(3, 10, 280)
      const captured = session.capture()
      session.detach()
      expect(engine.tileReads.at(-1)).toEqual({ id: 'default', tiles: ['0_1', '1_0'] })

      release()
      expect(await running).toBe(true)
      expect(await captured).toBe(true)
      // On top of the save that ran meanwhile.
      expect(sent(spy)).toEqual([
        { base: 1, layers: ['1_0'] },
        { base: 2, layers: ['0_1,1_0'] },
      ])
      expect(session.hasUnsavedChanges).toBe(false)
      await expectSavedAsShown(engine)
    })

    it('writes everything it read for a canvas that went, even when the save running then fails', async () => {
      const session = new DocumentSession(projectId, db, store, undefined, 60_000)
      const engine = new FakeDocumentEngine(W, H)
      session.attach(engine)
      engine.paint(1, 10, 10)
      await session.flush()

      let release: () => void = () => {}
      const held = new Promise<void>((resolve) => (release = resolve))
      const spy = vi.spyOn(store, 'save').mockImplementationOnce(async () => {
        await held
        throw new Error('the disk is on fire')
      })
      engine.paint(2, 300, 10)
      const running = session.saveNow()
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
      engine.paint(3, 10, 280)
      const captured = session.capture()
      session.detach()

      release()
      await running
      expect(await captured).toBe(true)
      // On top of the save before the one that failed.
      expect(sent(spy)).toEqual([
        { base: 1, layers: ['1_0'] },
        { base: 1, layers: ['0_1,1_0'] },
      ])
      await expectSavedAsShown(engine)
    })

    it('keeps a layer as saved while its tiles cannot be read, and reads them with the next save', async () => {
      const save = vi.spyOn(store, 'save')
      const session = new DocumentSession(projectId, db, store, undefined, 60_000)
      const engine = new FakeDocumentEngine(W, H)
      session.attach(engine)
      await session.saveNow()
      engine.paint(2, 300, 10)
      engine.tilesUnreadable = true
      await session.flush()
      engine.tilesUnreadable = false
      engine.paint(3, 10, 10)
      await session.flush()
      expect(sent(save).slice(1)).toEqual([
        { base: 1, layers: ['kept'] },
        { base: 2, layers: ['0_0,1_0'] },
      ])
      await expectSavedAsShown(engine)
      await session.close()
    })

    it('saves whole layers when the document is not the size of the save it would build on', async () => {
      const save = vi.spyOn(store, 'save')
      const session = new DocumentSession(projectId, db, store, undefined, 60_000)
      const engine = new FakeDocumentEngine(W, H)
      session.setBase({ seq: 7, width: 2, height: 2, layers: new Set(['default']) })
      session.attach(engine)
      engine.paint(1, 10, 10)
      await session.flush()
      expect(sent(save)).toEqual([{ base: undefined, layers: ['whole'] }])
      await session.close()
    })
  })
})
