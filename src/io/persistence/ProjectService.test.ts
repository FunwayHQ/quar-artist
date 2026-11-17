import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { deleteDB, openDB } from 'idb'
import { ProjectService, DEFAULT_PROJECT, DELETE_UNDO_MS, PURGE_GRACE_MS, baseName, importKind, sortDroppedFiles } from './ProjectService.ts'
import { MetadataDB } from './MetadataDB.ts'
import { DB_NAME, DB_VERSION, getDB, resetDB, type ProjectRecord } from '../../db/schema.ts'
import { IdbTileBackend } from '../tiles/IdbTileBackend.ts'
import { TileStore } from '../tiles/TileStore.ts'
import { legacyRecords, writeLegacyLayers } from '../../test/legacyLayout.ts'
import { useProjectStore } from '../../stores/projectStore.ts'
import { useUIStore } from '../../stores/uiStore.ts'
import { decodeImageBlob } from '../importImage.ts'
import { writeQart } from '../formats/qart/QartWriter.ts'
import { readQart } from '../formats/qart/QartReader.ts'
import * as fileAccess from '../files/fileAccess.ts'
import type { FileHandle } from '../files/fileAccess.ts'
import { FakeDocumentEngine, layerInfo } from '../../test/fakeDocumentEngine.ts'
import { sameBytes } from '../../test/bytes.ts'
import { defaultGuides, documentGuides, useGuideStore } from '../../stores/guideStore.ts'

vi.mock('../importImage.ts', () => ({ decodeImageBlob: vi.fn() }))
// Files on disk: the tests pick them, and see what is written to them.
vi.mock('../files/fileAccess.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../files/fileAccess.ts')>()),
  canPickSaveFile: vi.fn(),
  pickSaveFile: vi.fn(),
  pickOpenFile: vi.fn(),
  mayWrite: vi.fn(),
  writeFile: vi.fn(),
  lastModified: vi.fn(),
  sameFile: vi.fn(),
  downloadFile: vi.fn(),
}))
const files = vi.mocked(fileAccess)
/** Files on disk as the tests stand them in: each one's last-modified time, which every write moves on. */
const disk = new Map<string, number>()
function diskKey(handle: unknown): string {
  const { id, name } = handle as { id?: string; name: string }
  return id ?? name
}
/** Another program writes a file. */
function writtenElsewhere(handle: unknown) {
  disk.set(diskKey(handle), (disk.get(diskKey(handle)) ?? 1) + 1000)
}
// jsdom has no 2D canvas to draw thumbnails with.
vi.mock('./thumbnail.ts', () => ({
  encodeLayersThumbnail: vi.fn(async () => ({ type: 'image/webp', data: new Uint8Array([1, 2, 3]).buffer })),
  encodeThumbnail: vi.fn(async () => null),
}))

const initialProjectState = useProjectStore.getState()
const store = () => useProjectStore.getState()
const toasts = () => useUIStore.getState().toasts.map((t) => t.message)
/** 2 × 2 opaque pixels of one grey: they load back exactly. */
function filled(value: number) {
  const pixels = new Uint8Array(2 * 2 * 4).fill(value)
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255
  return pixels
}

describe('ProjectService', () => {
  let db: MetadataDB
  let tiles: TileStore
  let service: ProjectService

  beforeEach(async () => {
    resetDB()
    await deleteDB(DB_NAME)
    useProjectStore.setState(initialProjectState, true)
    useUIStore.setState({ toasts: [] })
    vi.mocked(decodeImageBlob).mockReset()
    files.canPickSaveFile.mockReset().mockReturnValue(false)
    files.pickSaveFile.mockReset()
    files.pickOpenFile.mockReset()
    files.mayWrite.mockReset().mockResolvedValue(true)
    disk.clear()
    files.writeFile.mockReset().mockImplementation(async (handle) => {
      disk.set(diskKey(handle), (disk.get(diskKey(handle)) ?? 1) + 1)
    })
    files.lastModified.mockReset().mockImplementation(async (handle) => disk.get(diskKey(handle)) ?? 1)
    files.sameFile.mockReset().mockImplementation(async (a, b) => (a as { id?: string }).id === (b as { id?: string }).id)
    files.downloadFile.mockReset()
    db = new MetadataDB()
    const idb = new IdbTileBackend()
    tiles = new TileStore({ write: idb, read: { idb } })
    service = new ProjectService(db, { debounceMs: 10, store: tiles })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** A saved 2 × 2 project with two layers, the bottom one active. */
  async function seedProject(name: string, extra: Partial<ProjectRecord> = {}) {
    const id = await db.createProject(name, 2, 2, 72)
    await tiles.save(id, {
      width: 2,
      height: 2,
      layers: [
        { info: layerInfo('bg', 'Background'), pixels: filled(1) },
        { info: layerInfo('ink', 'Ink', { opacity: 0.5, blendMode: 'multiply' }), pixels: filled(2) },
      ],
    })
    await db.updateProject(id, { activeLayerId: 'bg', ...extra }, { touch: false })
    return id
  }

  /** Mark a project deleted by another tab, `undoLeft` ms before the end of the window in which it can still be undone. */
  async function deletedElsewhere(id: string, undoLeft: number) {
    const deletedAt = new Date(Date.now() - DELETE_UNDO_MS - PURGE_GRACE_MS + undoLeft)
    await db.updateProject(id, { deletedAt }, { touch: false })
  }

  /** The grey of a saved layer's first pixel, or null when it has none saved. */
  async function firstByte(projectId: string, layerId: string) {
    const pixels = (await tiles.load(projectId))?.layers.find((l) => l.info.id === layerId)?.pixels
    return pixels ? pixels[0] : null
  }

  /** The ids of a project's saved layers, bottom first. */
  async function layerIds(projectId: string) {
    return (await tiles.load(projectId))?.layers.map((l) => l.info.id) ?? []
  }

  /** Open a project, hand it an engine of the project's size, and wait until its saved document is in (plan M1.4). */
  async function openAndAttach(id: string, width = 2, height = 2) {
    expect(await service.openProject(id)).toBe(true)
    const engine = new FakeDocumentEngine(width, height)
    const detach = service.attachEngine(engine)
    await service.settled()
    return { engine, detach }
  }

  describe('start-up', () => {
    it('opens a new project when there are none', async () => {
      await service.start()

      const [project] = await db.getAllProjects()
      expect(project).toMatchObject({ name: 'Untitled Project', width: 1920, height: 1080, dpi: 72, colorSpace: 'srgb' })
      expect(store()).toMatchObject({
        view: 'canvas',
        currentProjectId: project.id,
        currentProjectName: 'Untitled Project',
        canvasWidth: 1920,
        canvasHeight: 1080,
        lastProjectId: project.id,
      })
      expect(store().sessionId).not.toBeNull()
      expect(await db.getSetting('gallery.lastProjectId')).toBe(project.id)
    })

    it('opens the Gallery when there are projects, with the saved sort and last project', async () => {
      const a = await seedProject('A')
      await seedProject('B')
      await db.setSetting('gallery.sort', 'name')
      await db.setSetting('gallery.lastProjectId', a)

      await service.start()

      expect(store().view).toBe('gallery')
      expect(store().projects.map((p) => p.name).sort()).toEqual(['A', 'B'])
      expect(store().gallerySort).toBe('name')
      expect(store().lastProjectId).toBe(a)
      expect(store().sessionId).toBeNull()
    })

    it('ignores a sort setting it does not know', async () => {
      await seedProject('A')
      await db.setSetting('gallery.sort', 'colour')
      await service.start()
      expect(store().gallerySort).toBe('updated')
    })

    it('finishes deletes left from last time, and the stacks they empty', async () => {
      const stackId = await db.createStack('Old')
      const gone = await seedProject('Gone', { stackId, deletedAt: new Date(Date.now() - 60 * 60_000) })
      await seedProject('Kept')

      await service.start()

      expect(await db.getProject(gone)).toBeUndefined()
      expect(await tiles.load(gone)).toBeNull()
      expect(await db.getAllStacks()).toEqual([])
      expect(store().projects.map((p) => p.name)).toEqual(['Kept'])
    })

    it('leaves a recent delete to the tab that can still undo it, then makes it final', async () => {
      const recent = await seedProject('Recent')
      await seedProject('Kept')
      // Another tab deleted it a moment ago; its Undo window ends in 250 ms.
      await deletedElsewhere(recent, 250)

      await service.start()

      expect(await db.getProject(recent)).toBeDefined()
      expect(store().projects.map((p) => p.name)).toEqual(['Kept'])
      await vi.waitFor(async () => expect(await db.getProject(recent)).toBeUndefined(), { timeout: 3000 })
    })

    it('keeps a recent delete that its tab undid in time', async () => {
      const recent = await seedProject('Recent')
      await deletedElsewhere(recent, 150)
      await service.start()

      // The other tab's Undo.
      await db.updateProject(recent, { deletedAt: undefined }, { touch: false })
      await new Promise((resolve) => setTimeout(resolve, 400))

      expect(await db.getProject(recent)).toBeDefined()
      expect(await layerIds(recent)).toEqual(['bg', 'ink'])
    })

    it('starts only once', async () => {
      await Promise.all([service.start(), service.start()])
      expect(await db.getAllProjects()).toHaveLength(1)
    })

    it('opens an unsaved canvas, and says so, when storage is unavailable', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const broken = new MetadataDB()
      vi.spyOn(broken, 'getAllProjects').mockRejectedValue(new DOMException('denied', 'SecurityError'))
      service = new ProjectService(broken)

      await service.start()

      expect(store()).toMatchObject({ view: 'canvas', currentProjectId: null, currentProjectName: 'Untitled Project' })
      expect(toasts()).toEqual(["Your work can't be saved in this browser: denied"])

      // The canvas keeps working, without a Gallery to go to.
      expect(await service.goToGallery()).toBe(false)
      expect(store().view).toBe('canvas')
      expect(await service.saveNow()).toBe(false)
      const session = store().sessionId
      expect(await service.createProject({ ...DEFAULT_PROJECT, name: 'Next' })).toBe(true)
      expect(store()).toMatchObject({ view: 'canvas', currentProjectId: null, currentProjectName: 'Next' })
      expect(store().sessionId).not.toBe(session)
    })

    it('asks before a new canvas replaces one with changes it can\'t save', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const broken = new MetadataDB()
      vi.spyOn(broken, 'getAllProjects').mockRejectedValue(new DOMException('denied', 'SecurityError'))
      service = new ProjectService(broken)
      await service.start()
      const engine = new FakeDocumentEngine()
      service.attachEngine(engine)
      engine.paint(1)
      expect(service.hasUnsavedChanges).toBe(true)
      const session = store().sessionId

      expect(await service.createProject({ ...DEFAULT_PROJECT, name: 'Next' })).toBe(false)

      expect(store().sessionId).toBe(session)
      const toast = useUIStore.getState().toasts.at(-1)!
      expect(toast).toMatchObject({
        message: "The open canvas can't be saved in this browser, so starting a new one loses it",
        action: { label: 'Start anyway' },
      })
      toast.action!.run()
      expect(store()).toMatchObject({ currentProjectName: 'Next' })
      expect(store().sessionId).not.toBe(session)
      expect(service.hasUnsavedChanges).toBe(false)
    })
  })

  describe('opening and closing', () => {
    it('opens a project with its layers, pixels and active layer', async () => {
      const id = await seedProject('Painting')
      await service.start()

      const { engine } = await openAndAttach(id)

      expect(store()).toMatchObject({ view: 'canvas', currentProjectId: id, currentProjectName: 'Painting', canvasWidth: 2, canvasHeight: 2 })
      expect(engine.loads).toHaveLength(1)
      const [load] = engine.loads
      expect(load.activeLayerId).toBe('bg')
      expect(load.layers.map((l) => l.info)).toEqual([
        layerInfo('bg', 'Background'),
        layerInfo('ink', 'Ink', { opacity: 0.5, blendMode: 'multiply' }),
      ])
      expect(load.layers.map((l) => l.pixels?.[0])).toEqual([1, 2])
      expect(store().lastProjectId).toBe(id)
    })

    it('opens a project saved before the tile store, and moves it to tiles at its next save', async () => {
      const id = await db.createProject('Old', 2, 2, 72)
      await writeLegacyLayers(id, [
        { info: layerInfo('bg', 'Background'), pixels: filled(5) },
        // Pixels of the wrong size load as an empty layer.
        { info: layerInfo('ink', 'Ink', { opacity: 0.5 }), pixels: new Uint8Array(3) },
      ])
      await db.updateProject(id, { activeLayerId: 'ink' }, { touch: false })
      await service.start()

      const { engine } = await openAndAttach(id)
      expect(engine.loads[0].layers.map((l) => l.info)).toEqual([
        layerInfo('bg', 'Background'),
        layerInfo('ink', 'Ink', { opacity: 0.5 }),
      ])
      expect(engine.loads[0].layers.map((l) => l.pixels?.[0] ?? null)).toEqual([5, null])
      expect(engine.loads[0].activeLayerId).toBe('ink')

      engine.paint(9)
      expect(await service.goToGallery()).toBe(true)
      expect(await layerIds(id)).toEqual(['bg', 'ink'])
      expect(await firstByte(id, 'bg')).toBe(5)
      expect(await firstByte(id, 'ink')).toBe(9)
      expect(await legacyRecords(id)).toEqual({ layers: [], tiles: [] })
    })

    it('opens a project that another tab moves to tiles while it opens from the old layout', async () => {
      const id = await db.createProject('Old', 2, 2, 72)
      await writeLegacyLayers(id, [{ info: layerInfo('bg', 'Background'), pixels: filled(5) }])
      await service.start()
      // Between this tab finding no tiles and reading the old records, the other tab's first save commits.
      const readOld = db.loadLegacyLayers.bind(db)
      vi.spyOn(db, 'loadLegacyLayers').mockImplementationOnce(async (...args) => {
        await tiles.save(id, { width: 2, height: 2, layers: [{ info: layerInfo('bg', 'Background'), pixels: filled(7) }] })
        return readOld(...args)
      })

      const { engine } = await openAndAttach(id)
      expect(engine.loads[0].layers.map((l) => l.pixels?.[0])).toEqual([7])
      expect(await legacyRecords(id)).toEqual({ layers: [], tiles: [] })
    })

    it('does not stop at start-up when a deleted project cannot be removed yet', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const stuck = await seedProject('Stuck')
      const gone = await seedProject('Gone')
      await seedProject('Kept')
      await deletedElsewhere(stuck, -60 * 60_000)
      await deletedElsewhere(gone, -60 * 60_000)
      const remove = tiles.delete.bind(tiles)
      vi.spyOn(tiles, 'delete').mockImplementation(async (projectId) => {
        if (projectId === stuck) throw new Error('the persistence worker stopped')
        return remove(projectId)
      })

      await service.start()

      expect(store().view).toBe('gallery')
      expect(store().projects.map((p) => p.name)).toEqual(['Kept'])
      expect(toasts()).toEqual([])
      expect(await db.getProject(gone)).toBeUndefined()
      // Still deleted, for the next start to remove.
      expect((await db.getProject(stuck))?.deletedAt).toBeInstanceOf(Date)
      expect(warn).toHaveBeenCalledWith('[QUAR] A deleted project could not be removed yet:', expect.any(Error))
    })

    it('opens a project with a tile it cannot read, and says so', async () => {
      const id = await seedProject('Painting')
      const [record] = await (await getDB()).getAll('tileData')
      await (await getDB()).delete('tileData', [record.projectId, record.layerId, record.key])
      await service.start()

      const { engine } = await openAndAttach(id)
      // The layer whose tile is gone opens transparent; the other as saved.
      expect(engine.loads[0].layers.map((l) => l.pixels?.[0] ?? null)).toEqual([null, 2])
      expect(toasts()).toEqual([
        'Part of “Painting” couldn\'t be read and shows as transparent (1 tile of 256 × 256 px)',
      ])
    })

    it('opens a project at the size it was saved at, even when its record says otherwise', async () => {
      const id = await seedProject('Painting')
      // A save whose record update failed after its layers were committed.
      await db.updateProject(id, { width: 3, height: 5 }, { touch: false })
      await service.start()
      await openAndAttach(id)
      expect(store()).toMatchObject({ canvasWidth: 2, canvasHeight: 2 })
    })

    it('saves changes to the open project', async () => {
      const id = await seedProject('Painting')
      await service.start()
      const { engine } = await openAndAttach(id)

      engine.paint(77)

      await vi.waitFor(async () => expect(await firstByte(id, 'bg')).toBe(77))
      await vi.waitFor(() => expect(store().saveStatus).toBe('saved'))
    })

    it('saves the open project before going back to the Gallery', async () => {
      const id = await seedProject('Painting')
      service = new ProjectService(db, { debounceMs: 60_000, store: tiles })
      await service.start()
      const { engine } = await openAndAttach(id)
      engine.paint(9)
      expect(service.hasUnsavedChanges).toBe(true)

      expect(await service.goToGallery()).toBe(true)

      expect(await firstByte(id, 'bg')).toBe(9)
      expect(store()).toMatchObject({ view: 'gallery', currentProjectId: null, sessionId: null })
      expect(engine.following).toBe(false)
    })

    it('keeps the project open, and says why once, when saving it fails', async () => {
      const id = await seedProject('Painting')
      service = new ProjectService(db, { debounceMs: 60_000, store: tiles })
      await service.start()
      const { engine } = await openAndAttach(id)
      engine.paint(9)
      vi.spyOn(tiles, 'save').mockRejectedValueOnce(new Error('disk full'))

      expect(await service.goToGallery()).toBe(false)

      expect(store()).toMatchObject({ view: 'canvas', currentProjectId: id, saveStatus: 'error' })
      expect(toasts()).toEqual(["Couldn't save “Painting”, so it stays open: disk full"])
      expect(engine.following).toBe(true)

      // Once storage works again, leaving saves the change.
      expect(await service.goToGallery()).toBe(true)
      expect(await firstByte(id, 'bg')).toBe(9)
    })

    it('reports a failed background save once', async () => {
      const id = await seedProject('Painting')
      await service.start()
      const { engine } = await openAndAttach(id)
      vi.spyOn(tiles, 'save').mockRejectedValue(new Error('disk full'))

      engine.paint(1)
      await vi.waitFor(() => expect(store().saveStatus).toBe('error'))
      engine.paint(2)
      await new Promise((resolve) => setTimeout(resolve, 40))

      expect(toasts()).toEqual(["Couldn't save “Painting”: disk full"])
    })

    it('creates a new project after saving the open one, in a new session', async () => {
      await service.start()
      const first = store().currentProjectId!
      const firstSession = store().sessionId
      const engine = new FakeDocumentEngine()
      service.attachEngine(engine)
      engine.paint(5)

      expect(await service.createProject({ name: 'Second', width: 640, height: 480, dpi: 300, colorSpace: 'srgb' })).toBe(true)

      expect(await firstByte(first, 'default')).toBe(5)
      const second = store().currentProjectId!
      expect(second).not.toBe(first)
      expect(store().sessionId).not.toBe(firstSession)
      expect(await db.getProject(second)).toMatchObject({ name: 'Second', width: 640, height: 480, dpi: 300 })
      expect(store()).toMatchObject({ currentProjectName: 'Second', canvasWidth: 640, canvasHeight: 480, dpi: 300 })
      expect(engine.following).toBe(false)

      // The new document's engine starts empty and saves to the new project.
      const next = new FakeDocumentEngine()
      service.attachEngine(next)
      expect(next.loads).toEqual([])
      next.paint(6)
      await vi.waitFor(async () => expect(await firstByte(second, 'default')).toBe(6))
      expect(await firstByte(first, 'default')).toBe(5)
    })

    it('says so when the project to open no longer exists', async () => {
      await seedProject('A')
      await service.start()
      expect(await service.openProject('missing')).toBe(false)
      expect(store().view).toBe('gallery')
      expect(toasts()).toEqual(['the project no longer exists'])
    })

    it('opens one project at a time, ending with the last asked for', async () => {
      const a = await seedProject('A')
      const b = await seedProject('B')
      await service.start()
      await Promise.all([service.openProject(a), service.openProject(b)])
      expect(store().currentProjectId).toBe(b)
    })

    it('brings the last save back into a restarted engine', async () => {
      const id = await seedProject('Painting')
      await service.start()
      const { engine, detach } = await openAndAttach(id)
      engine.paint(42)
      await service.saveNow()
      detach()

      const restarted = new FakeDocumentEngine()
      service.attachEngine(restarted)

      await vi.waitFor(() => expect(restarted.following).toBe(true))
      expect(restarted.loads[0].layers[0].pixels?.[0]).toBe(42)
    })

    it('forgets changes that went with an engine that restarted', async () => {
      const id = await seedProject('Painting')
      await service.start()
      const { engine, detach } = await openAndAttach(id)
      engine.paint(42)
      detach()

      const restarted = new FakeDocumentEngine()
      service.attachEngine(restarted)
      await vi.waitFor(() => expect(restarted.following).toBe(true))

      // The last save came back, and nothing is waiting to be written over it.
      expect(restarted.loads[0].layers[0].pixels?.[0]).toBe(1)
      expect(service.hasUnsavedChanges).toBe(false)
      expect(await service.goToGallery()).toBe(true)
      expect(await firstByte(id, 'bg')).toBe(1)
    })

    it('leaves the project as saved, and shows the Gallery, when a restarted engine can\'t be reloaded', async () => {
      const id = await seedProject('Painting')
      await service.start()
      const { engine, detach } = await openAndAttach(id)
      engine.paint(42)
      detach()
      vi.spyOn(db, 'getProject').mockRejectedValueOnce(new DOMException('read failed', 'UnknownError'))

      const restarted = new FakeDocumentEngine()
      service.attachEngine(restarted)

      await vi.waitFor(() => expect(store().view).toBe('gallery'))
      expect(toasts()).toContain('Couldn\'t reopen “Painting” after the canvas restarted: read failed')
      expect(restarted.following).toBe(false)
      expect(await layerIds(id)).toEqual(['bg', 'ink'])
      expect(await firstByte(id, 'bg')).toBe(1)
      expect(await firstByte(id, 'ink')).toBe(2)
    })

    it('opens the project again at its saved size when the canvas restarts at another', async () => {
      const id = await seedProject('Painting')
      await service.start()
      const { detach } = await openAndAttach(id)
      const session = store().sessionId
      detach()

      // Say a Canvas Size to 4 × 4 wasn't saved yet: the restarted engine has the new size.
      const resized = new FakeDocumentEngine(4, 4)
      service.attachEngine(resized)

      await vi.waitFor(() => expect(store().sessionId).not.toBe(session))
      expect(resized.loads).toEqual([])
      expect(resized.following).toBe(false)
      expect(store()).toMatchObject({ canvasWidth: 2, canvasHeight: 2, currentProjectId: id })

      // The canvas starts again for the new session, at the saved size.
      const reopened = new FakeDocumentEngine(2, 2)
      service.attachEngine(reopened)
      await service.settled()
      expect(reopened.loads[0].layers.map((l) => l.pixels?.[0])).toEqual([1, 2])
      expect(reopened.following).toBe(true)
    })

    it('shows the Gallery, and says why, when a new project can\'t be created after the open one closed', async () => {
      const id = await seedProject('Painting')
      await service.start()
      const { engine } = await openAndAttach(id)
      engine.paint(9)
      vi.spyOn(db, 'createProject').mockRejectedValueOnce(new DOMException('storage is full', 'QuotaExceededError'))

      expect(await service.createProject({ ...DEFAULT_PROJECT, name: 'Next' })).toBe(false)

      expect(store().view).toBe('gallery')
      expect(store().sessionId).toBeNull()
      expect(toasts()).toContain("Couldn't create “Next”: the browser's storage is full")
      // The open project was saved before it closed.
      expect(await firstByte(id, 'bg')).toBe(9)
    })

    it('does not reload the same engine coming back (React StrictMode)', async () => {
      const id = await seedProject('Painting')
      await service.start()
      const { engine, detach } = await openAndAttach(id)
      detach()
      service.attachEngine(engine)
      expect(engine.loads).toHaveLength(1)
      expect(engine.following).toBe(true)
    })

    it('saves on request and says so', async () => {
      const id = await seedProject('Painting')
      await service.start()
      await openAndAttach(id)
      expect(await service.saveNow()).toBe(true)
      expect(toasts()).toEqual(['Saved “Painting”'])
    })

    it('ignores a save request in the Gallery', async () => {
      await seedProject('Painting')
      await service.start()
      expect(await service.saveNow()).toBe(true)
      expect(toasts()).toEqual([])
    })
  })

  describe('saving (plan M1.3)', () => {
    afterEach(() => {
      Reflect.deleteProperty(navigator, 'storage')
    })

    it('saves only the changed tiles of a project it opened, on top of the save it opened', async () => {
      const id = await seedProject('Painting')
      await service.start()
      const { engine } = await openAndAttach(id)
      const save = vi.spyOn(tiles, 'save')

      engine.paint(77)
      await vi.waitFor(() => expect(store().saveStatus).toBe('saved'))
      expect(save).toHaveBeenCalledTimes(1)
      const [, doc] = save.mock.calls[0]
      expect(doc.base).toBe(1)
      expect(doc.layers.map((l) => [l.pixels, l.tiles?.map((t) => [t.x, t.y])])).toEqual([[null, [[0, 0]]], [null, []]])
      expect(await firstByte(id, 'bg')).toBe(77)
      expect(await firstByte(id, 'ink')).toBe(2)
    })

    it('saves whole layers for a project opened with tiles it could not read', async () => {
      const id = await seedProject('Painting')
      const [record] = await (await getDB()).getAll('tileData')
      await (await getDB()).delete('tileData', [record.projectId, record.layerId, record.key])
      await service.start()
      const { engine } = await openAndAttach(id)
      const save = vi.spyOn(tiles, 'save')

      engine.paint(77)
      await vi.waitFor(() => expect(store().saveStatus).toBe('saved'))
      const [, doc] = save.mock.calls[0]
      expect(doc.base).toBeUndefined()
      expect(doc.layers.every((l) => l.pixels !== null)).toBe(true)
    })

    it('reloads a restarted engine once a save of the old one is done, and builds on that save', async () => {
      const id = await seedProject('Painting')
      await service.start()
      const { engine, detach } = await openAndAttach(id)
      const save = tiles.save.bind(tiles)
      let release: () => void = () => {}
      const held = new Promise<void>((resolve) => (release = resolve))
      const spy = vi.spyOn(tiles, 'save').mockImplementationOnce(async (...args) => {
        await held
        return save(...args)
      })
      engine.paint(42)
      const saving = service.saveNow()
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
      detach()

      const restarted = new FakeDocumentEngine()
      service.attachEngine(restarted)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(restarted.loads).toHaveLength(0)
      release()
      await saving
      await vi.waitFor(() => expect(restarted.following).toBe(true))
      expect(restarted.loads[0].layers[0].pixels?.[0]).toBe(42)

      restarted.paint(43)
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
      expect(spy.mock.calls[1][1].base).toBe(2)
    })

    it('saves when the page is hidden or put away, and asks before leaving with changes not saved', async () => {
      service = new ProjectService(db, { debounceMs: 60_000, store: tiles })
      const id = await seedProject('Painting')
      await service.start()
      const { engine } = await openAndAttach(id)
      const win = new EventTarget()
      const page = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
      const stop = service.watchPage(win as never, page as never)
      const leave = () => {
        const event = new Event('beforeunload', { cancelable: true })
        win.dispatchEvent(event)
        return event.defaultPrevented
      }

      expect(leave()).toBe(false)
      engine.paint(5)
      // Asks, and saves meanwhile.
      expect(leave()).toBe(true)
      await vi.waitFor(async () => expect(await firstByte(id, 'bg')).toBe(5))
      await vi.waitFor(() => expect(service.hasUnsavedChanges).toBe(false))
      expect(leave()).toBe(false)

      engine.paint(6)
      page.visibilityState = 'hidden'
      page.dispatchEvent(new Event('visibilitychange'))
      await vi.waitFor(async () => expect(await firstByte(id, 'bg')).toBe(6))

      engine.paint(7)
      win.dispatchEvent(new Event('pagehide'))
      await vi.waitFor(async () => expect(await firstByte(id, 'bg')).toBe(7))

      stop()
      engine.paint(8)
      win.dispatchEvent(new Event('pagehide'))
      expect(leave()).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(await firstByte(id, 'bg')).toBe(7)
    })

    it('asks the browser to keep its storage once a save has worked, and only once', async () => {
      const persist = vi.fn(async () => true)
      const persisted = vi.fn(async () => false)
      Object.defineProperty(navigator, 'storage', { value: { persist, persisted }, configurable: true })
      const id = await seedProject('Painting')
      await service.start()
      const { engine } = await openAndAttach(id)
      expect(persisted).not.toHaveBeenCalled()

      engine.paint(5)
      await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1))
      engine.paint(6)
      await vi.waitFor(async () => expect(await firstByte(id, 'bg')).toBe(6))
      await vi.waitFor(() => expect(store().saveStatus).toBe('saved'))
      expect(persisted).toHaveBeenCalledTimes(1)
      expect(persist).toHaveBeenCalledTimes(1)
    })

    it('does not ask again when the storage is kept already', async () => {
      const persist = vi.fn(async () => true)
      Object.defineProperty(navigator, 'storage', { value: { persist, persisted: async () => true }, configurable: true })
      const id = await seedProject('Painting')
      await service.start()
      const { engine } = await openAndAttach(id)
      engine.paint(5)
      await vi.waitFor(() => expect(store().saveStatus).toBe('saved'))
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(persist).not.toHaveBeenCalled()
    })

    it('says how to keep the work and make room when the storage is full', async () => {
      const id = await seedProject('Painting')
      await service.start()
      const { engine } = await openAndAttach(id)
      vi.spyOn(tiles, 'save').mockRejectedValue(new DOMException('no room', 'QuotaExceededError'))

      engine.paint(5)
      await vi.waitFor(() => expect(store().saveStatus).toBe('error'))
      const [full] = useUIStore.getState().toasts
      expect(full.message).toBe(
        "The browser's storage is full: “Painting” isn't being saved. Save it as a .qart file to keep a copy, and make room by deleting projects you don't need from the Gallery in another tab.",
      )
      // A .qart file keeps every layer (plan M1.5): here a download, which needs no storage.
      expect(full.action?.label).toBe('Save as .qart…')
      full.action!.run()
      await vi.waitFor(() => expect(files.downloadFile).toHaveBeenCalledOnce())
      const [[blob, name]] = files.downloadFile.mock.calls
      expect(name).toBe('Painting.qart')
      expect((await readQart(blob)).layers.map((l) => l.pixels[0])).toEqual([5, 2])

      // It can't close either: it stays open, with the same way out.
      expect(await service.goToGallery()).toBe(false)
      const stuck = useUIStore.getState().toasts.at(-1)!
      expect(stuck.message).toContain("“Painting” can't be saved, so it stays open")
      expect(stuck.action?.label).toBe('Save as .qart…')
    })

    it('removes saved documents whose project is gone at start-up, and keeps every other', async () => {
      const kept = await seedProject('Painting')
      // Deleted, with its Undo still open: its record keeps it.
      const deleted = await seedProject('Deleted')
      await deletedElsewhere(deleted, 150)
      await tiles.save('orphan', { width: 2, height: 2, layers: [{ info: layerInfo('bg', 'Background'), pixels: filled(3) }] })

      await service.start()
      expect((await tiles.storedProjects()).sort()).toEqual([kept, deleted].sort())
      expect(await firstByte(kept, 'bg')).toBe(1)
      // Once its Undo has gone, the delete is made final as before.
      await vi.waitFor(async () => expect(await tiles.storedProjects()).toEqual([kept]), { timeout: 3000 })
    })
  })

  describe('Gallery', () => {
    it('renames a project without marking it modified', async () => {
      const id = await seedProject('A')
      const old = new Date('2020-01-01')
      await db.updateProject(id, { updatedAt: old }, { touch: false })
      await service.start()

      await service.renameProject(id, '  Sunset  ')

      expect(await db.getProject(id)).toMatchObject({ name: 'Sunset', updatedAt: old })
      expect(store().projects[0].name).toBe('Sunset')
    })

    it('renames the open project in the title bar too', async () => {
      const id = await seedProject('A')
      await service.start()
      await openAndAttach(id)
      await service.renameProject(id, 'Sunset')
      expect(store().currentProjectName).toBe('Sunset')
    })

    it('ignores a blank name', async () => {
      const id = await seedProject('A')
      await service.start()
      await service.renameProject(id, '   ')
      expect((await db.getProject(id))!.name).toBe('A')
    })

    it('duplicates a project with its layers', async () => {
      const id = await seedProject('A')
      await service.start()

      await service.duplicateProject(id)

      const copy = store().projects.find((p) => p.name === 'A copy')!
      expect(copy.id).not.toBe(id)
      expect(await layerIds(copy.id)).toEqual(['bg', 'ink'])
      expect(await firstByte(copy.id, 'ink')).toBe(2)
      expect(toasts()).toEqual(['Duplicated “A”'])
    })

    it('duplicates a project saved before the tile store', async () => {
      const id = await db.createProject('Old', 2, 2, 72)
      await writeLegacyLayers(id, [{ info: layerInfo('bg', 'Background'), pixels: filled(4) }])
      await service.start()

      await service.duplicateProject(id)

      const copy = store().projects.find((p) => p.name === 'Old copy')!
      expect(await legacyRecords(copy.id)).toEqual({ layers: ['bg'], tiles: ['bg'] })
      const { engine } = await openAndAttach(copy.id)
      expect(engine.loads[0].layers.map((l) => l.pixels?.[0])).toEqual([4])
    })

    it('leaves no half-made copy when copying the document fails', async () => {
      const id = await seedProject('A')
      await service.start()
      vi.spyOn(tiles, 'copy').mockRejectedValueOnce(new DOMException('storage is full', 'QuotaExceededError'))

      await service.duplicateProject(id)

      expect(toasts()).toEqual(["Couldn't duplicate “A”: the browser's storage is full"])
      expect((await db.getAllProjects()).map((p) => p.name)).toEqual(['A'])
      expect(await layerIds(id)).toEqual(['bg', 'ink'])
    })

    it('deletes a project with an Undo, and Undo brings it back', async () => {
      const id = await seedProject('A')
      await seedProject('B')
      await service.start()

      await service.deleteProject(id)

      expect(store().projects.map((p) => p.name)).toEqual(['B'])
      const toast = useUIStore.getState().toasts.at(-1)!
      expect(toast).toMatchObject({ message: 'Deleted “A”', durationMs: DELETE_UNDO_MS, action: { label: 'Undo' } })

      toast.action!.run()
      useUIStore.getState().dismissToast(toast.id, 'action')

      await vi.waitFor(() => expect(store().projects.map((p) => p.name).sort()).toEqual(['A', 'B']))
      expect((await db.getProject(id))!.deletedAt).toBeUndefined()
      expect(await layerIds(id)).toEqual(['bg', 'ink'])
    })

    it('says so when Undo comes after another tab made the delete final', async () => {
      const id = await seedProject('A')
      await service.start()
      await service.deleteProject(id)
      await db.deleteProject(id)

      useUIStore.getState().toasts.at(-1)!.action!.run()

      await vi.waitFor(() => expect(toasts()).toContain('“A” was already deleted for good'))
      expect(store().projects).toEqual([])
    })

    it('deletes a project for good when its Undo goes away', async () => {
      const stackId = await db.createStack('Only')
      const id = await seedProject('A', { stackId })
      await seedProject('B')
      await service.start()

      await service.deleteProject(id)
      const toast = useUIStore.getState().toasts.at(-1)!
      useUIStore.getState().dismissToast(toast.id, 'timeout')

      await vi.waitFor(async () => expect(await db.getProject(id)).toBeUndefined())
      expect(await tiles.load(id)).toBeNull()
      expect((await (await getDB()).getAll('tileData')).every((r) => r.projectId !== id)).toBe(true)
      // Its stack had nothing else, so it went too.
      await vi.waitFor(async () => expect(await db.getAllStacks()).toEqual([]))
    })

    it('keeps an unchanged thumbnail, so its card does not reload it', async () => {
      const a = await seedProject('A', { thumbnail: { type: 'image/webp', data: new Uint8Array([7]).buffer } })
      await service.start()
      const before = store().projects[0].thumbnail

      await service.renameProject(a, 'Renamed')

      expect(store().projects[0].name).toBe('Renamed')
      expect(store().projects[0].thumbnail).toBe(before)
    })

    it('remembers the sort', async () => {
      await seedProject('A')
      await service.start()
      await service.setSort('created')
      expect(store().gallerySort).toBe('created')
      expect(await db.getSetting('gallery.sort')).toBe('created')
    })
  })

  describe('stacks', () => {
    const stackOf = (id: string) => store().projects.find((p) => p.id === id)?.stackId

    it('stacks projects, moves them, and removes stacks left empty', async () => {
      const a = await seedProject('A')
      const b = await seedProject('B')
      const c = await seedProject('C')
      await service.start()

      const studies = await service.createStack('Studies', [a, b])
      expect(store().stacks.map((s) => s.name)).toEqual(['Studies'])
      expect([stackOf(a), stackOf(b), stackOf(c)]).toEqual([studies, studies, undefined])

      await service.moveToStack(c, studies)
      await service.moveToStack(a, null)
      expect([stackOf(a), stackOf(c)]).toEqual([undefined, studies])

      await service.renameStack(studies, 'Old studies')
      expect(store().stacks[0].name).toBe('Old studies')

      // Moving the last projects out of a stack removes it.
      const other = await service.createStack('Other', [b, c])
      expect(store().stacks.map((s) => s.id)).toEqual([other])

      await service.unstack(other)
      expect(store().stacks).toEqual([])
      expect([stackOf(a), stackOf(b), stackOf(c)]).toEqual([undefined, undefined, undefined])
    })

    it('does not change modified dates when stacking', async () => {
      const a = await seedProject('A')
      const old = new Date('2020-01-01')
      await db.updateProject(a, { updatedAt: old }, { touch: false })
      await service.start()
      await service.createStack('Studies', [a])
      expect((await db.getProject(a))!.updatedAt).toEqual(old)
    })

    it('puts a project made inside an open stack into it', async () => {
      const a = await seedProject('A')
      await service.start()
      const stack = await service.createStack('Studies', [a])
      service.openStack(stack)

      await service.createProject({ ...DEFAULT_PROJECT, name: 'Inside' })

      expect((await db.getAllProjects()).find((p) => p.name === 'Inside')!.stackId).toBe(stack)
    })

    it('leaves a stack that is unstacked while open', async () => {
      const a = await seedProject('A')
      await service.start()
      const stack = await service.createStack('Studies', [a])
      service.openStack(stack)
      await service.unstack(stack)
      expect(store().openStackId).toBeNull()
    })
  })

  describe('import', () => {
    async function qartFile(name: string) {
      const blob = await writeQart({
        name: 'ignored',
        width: 2,
        height: 2,
        dpi: 300,
        activeLayerId: 'l2',
        layers: [
          { info: layerInfo('l1', 'Sky'), order: 0, pixels: filled(10) },
          { info: layerInfo('l2', 'Ink', { blendMode: 'screen', opacity: 0.25 }), order: 1, pixels: filled(20) },
        ],
      })
      return new File([blob], name)
    }

    beforeEach(async () => {
      await seedProject('Existing')
      await service.start()
    })

    it('imports a .qart file as a project that opens with its layers', async () => {
      await service.importFiles([await qartFile('Landscape.qart')])

      const project = store().projects.find((p) => p.name === 'Landscape')!
      expect(project).toMatchObject({ width: 2, height: 2, dpi: 300 })
      expect(project.thumbnail?.type).toBe('image/webp')
      expect(project.thumbnail?.data.byteLength).toBe(3)
      const layers = (await tiles.load(project.id))!.layers.map((l) => l.info)
      expect(layers.map((l) => l.name)).toEqual(['Sky', 'Ink'])
      // Fresh ids, so importing a file twice makes two independent projects.
      expect(layers.map((l) => l.id)).not.toContain('l1')
      expect(layers[1]).toMatchObject({ blendMode: 'screen', opacity: 0.25 })
      expect(project.activeLayerId).toBe(layers[1].id)
      expect(toasts()).toEqual(['Imported “Landscape”'])

      const { engine } = await openAndAttach(project.id)
      expect(engine.loads[0].layers.map((l) => l.pixels?.[0])).toEqual([10, 20])
      expect(engine.loads[0].activeLayerId).toBe(layers[1].id)
    })

    it('imports an image as a one-layer project named after the file', async () => {
      vi.mocked(decodeImageBlob).mockResolvedValue({ pixels: new Uint8ClampedArray(16).fill(200), width: 2, height: 2 })

      await service.importFiles([new File(['png'], 'cat.png', { type: 'image/png' })])

      const project = store().projects.find((p) => p.name === 'cat')!
      expect(project).toMatchObject({ width: 2, height: 2, dpi: 72, colorSpace: 'srgb' })
      const [layer] = (await tiles.load(project.id))!.layers.map((l) => l.info)
      expect(layer.name).toBe('cat')
      expect(project.activeLayerId).toBe(layer.id)
      expect(await firstByte(project.id, layer.id)).toBe(200)
    })

    it('imports into the open stack', async () => {
      const existing = store().projects[0].id
      const stack = await service.createStack('Studies', [existing])
      service.openStack(stack)
      await service.importFiles([await qartFile('Landscape.qart')])
      expect(store().projects.find((p) => p.name === 'Landscape')!.stackId).toBe(stack)
    })

    it('leaves no half-imported project when saving its pixels fails', async () => {
      vi.mocked(decodeImageBlob).mockResolvedValue({ pixels: new Uint8ClampedArray(2 * 2 * 4), width: 2, height: 2 })
      vi.spyOn(tiles, 'save').mockRejectedValueOnce(new DOMException('storage is full', 'QuotaExceededError'))

      await service.importFiles([new File(['png'], 'Swatch.png', { type: 'image/png' })])

      expect(toasts()).toContain("Couldn't import “Swatch.png”: the browser's storage is full")
      expect((await db.getAllProjects()).map((p) => p.name)).toEqual(['Existing'])
    })

    it('says which files it could not import, and imports the rest', async () => {
      vi.mocked(decodeImageBlob).mockResolvedValue({ pixels: new Uint8ClampedArray(4), width: 9000, height: 1 })

      await service.importFiles([
        new File(['psd'], 'scan.psd'),
        new File(['text'], 'notes.txt', { type: 'text/plain' }),
        new File(['not a zip'], 'bad.qart'),
        new File(['png'], 'huge.png', { type: 'image/png' }),
        await qartFile('Good.qart'),
      ])

      expect(toasts()).toEqual([
        "“scan.psd”: PSD files can't be opened yet",
        "“notes.txt” isn't a .qart file or an image",
        expect.stringMatching(/^Couldn't import “bad\.qart”: /),
        "Couldn't import “huge.png”: it is 9000 × 1 px. This device supports canvases up to 8192 × 8192 px",
        'Imported “Good”',
      ])
      expect(store().projects.map((p) => p.name).sort()).toEqual(['Existing', 'Good'])
    })
  })

  describe('opening a saved document (plan M1.4)', () => {
    const W = 600
    const H = 300
    // 600 × 300 is 3 × 2 tiles.

    /** Opaque pixels of one grey in the given tiles of a 600 × 300 layer. */
    function inTiles(value: number, tiles: [number, number][]) {
      const pixels = new Uint8Array(W * H * 4)
      for (const [tx, ty] of tiles) {
        for (let y = ty * 256; y < Math.min(H, ty * 256 + 256); y++) {
          for (let x = tx * 256; x < Math.min(W, tx * 256 + 256); x++) pixels.set([value, value, value, 255], (y * W + x) * 4)
        }
      }
      return pixels
    }

    const ALL: [number, number][] = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]

    /** A saved 600 × 300 project: a background painted in all 6 tiles, ink in one. */
    async function seedTiled(extra: Partial<ProjectRecord> = {}) {
      const id = await db.createProject('Painting', W, H, 72)
      await tiles.save(id, {
        width: W,
        height: H,
        layers: [
          { info: layerInfo('bg', 'Background'), pixels: inTiles(10, ALL) },
          { info: layerInfo('ink', 'Ink'), pixels: inTiles(20, [[1, 1]]) },
        ],
      })
      await db.updateProject(id, { activeLayerId: 'bg', ...extra }, { touch: false })
      return id
    }

    beforeEach(() => {
      service = new ProjectService(db, { debounceMs: 10, store: tiles, loadBatchTiles: 2 })
    })

    it('puts the tiles into the canvas a batch at a time, saving from it only once they are all in', async () => {
      const id = await seedTiled()
      await service.start()
      const progress: (number | null)[] = []
      const stop = useProjectStore.subscribe((s, prev) => {
        if (s.openProgress !== prev.openProgress) progress.push(s.openProgress)
      })
      const events: string[] = []
      const read = tiles.readTiles.bind(tiles)
      vi.spyOn(tiles, 'readTiles').mockImplementation(async (...args) => {
        events.push('read')
        return read(...args)
      })

      expect(await service.openProject(id)).toBe(true)
      // The canvas can't be used until it is in.
      expect(store()).toMatchObject({ view: 'canvas', openProgress: 0 })
      expect(await service.saveNow()).toBe(true)
      expect(toasts()).toEqual([])

      const engine = new FakeDocumentEngine(W, H)
      const savingWhilePlaced: boolean[] = []
      const place = engine.placeTiles.bind(engine)
      vi.spyOn(engine, 'placeTiles').mockImplementation((...args) => {
        events.push('place')
        savingWhilePlaced.push(engine.following)
        place(...args)
      })
      service.attachEngine(engine)
      await service.settled()
      stop()

      // Background: 3 batches of 2; ink: 1 of 1.
      expect(engine.placed.map((p) => [p.id, p.tiles.length])).toEqual([['bg', 2], ['bg', 2], ['bg', 2], ['ink', 1]])
      // Each batch is read while the one before goes in: never more than two batches held.
      expect(events).toEqual(['read', 'read', 'place', 'read', 'place', 'read', 'place', 'place'])
      expect(progress).toEqual([0, 2 / 7, 4 / 7, 6 / 7, 1, null])
      expect(savingWhilePlaced).toEqual([false, false, false, false])
      expect(engine.following).toBe(true)

      const [load] = engine.loads
      expect(load.activeLayerId).toBe('bg')
      expect(sameBytes(load.layers[0].pixels!, inTiles(10, ALL))).toBe(true)
      expect(sameBytes(load.layers[1].pixels!, inTiles(20, [[1, 1]]))).toBe(true)
      expect(store().openProgress).toBeNull()
      // Opening isn't a change, and the next save builds on the save it opened.
      expect(service.hasUnsavedChanges).toBe(false)
      engine.paint(99, 300, 10)
      await vi.waitFor(async () => expect((await (await getDB()).get('documents', id))?.seq).toBe(2))
      expect(engine.tileReads).toEqual([{ id: 'bg', tiles: ['1_0'] }])
    })

    it('starts over from the new save when another tab saves the project while it opens', async () => {
      const id = await seedTiled()
      await service.start()
      const read = tiles.readTiles.bind(tiles)
      const spy = vi.spyOn(tiles, 'readTiles').mockImplementationOnce(async (...args) => {
        // Another tab paints the background over: the tiles the outline names go.
        await tiles.save(id, {
          width: W,
          height: H,
          layers: [{ info: layerInfo('bg', 'Background'), pixels: inTiles(30, ALL) }],
        })
        return read(...args)
      })

      const { engine } = await openAndAttach(id, W, H)

      expect(spy.mock.calls.length).toBeGreaterThan(3)
      expect(engine.loads).toHaveLength(1)
      expect(engine.loads[0].layers.map((l) => l.info.id)).toEqual(['bg'])
      expect(sameBytes(engine.loads[0].layers[0].pixels!, inTiles(30, ALL))).toBe(true)
      expect(engine.following).toBe(true)
      expect(toasts()).toEqual([])
    })

    it("leaves the project as saved and shows the Gallery when its tiles can't be read", async () => {
      const id = await seedTiled()
      await service.start()
      vi.spyOn(tiles, 'readTiles').mockRejectedValue(new Error('the disk went away'))

      const { engine } = await openAndAttach(id, W, H)

      expect(store()).toMatchObject({ view: 'gallery', currentProjectId: null, openProgress: null })
      expect(toasts()).toEqual(["Couldn't open “Painting”: the disk went away"])
      expect(engine.following).toBe(false)
      expect(engine.loads).toEqual([])
      expect(service.hasUnsavedChanges).toBe(false)
      expect(await (await getDB()).get('documents', id)).toMatchObject({ seq: 1 })
    })

    it('loads into the new engine when the canvas restarts while it opens, and stops loading into the old one', async () => {
      const id = await seedTiled()
      await service.start()
      let release!: () => void
      const held = new Promise<void>((resolve) => (release = resolve))
      const read = tiles.readTiles.bind(tiles)
      const spy = vi.spyOn(tiles, 'readTiles').mockImplementationOnce(async (...args) => {
        await held
        return read(...args)
      })

      expect(await service.openProject(id)).toBe(true)
      const first = new FakeDocumentEngine(W, H)
      const detach = service.attachEngine(first)
      await vi.waitFor(() => expect(spy).toHaveBeenCalled())
      detach()
      const second = new FakeDocumentEngine(W, H)
      service.attachEngine(second)
      release()
      await service.settled()

      expect(first.placed).toEqual([])
      expect(first.following).toBe(false)
      expect(second.loads).toHaveLength(1)
      expect(sameBytes(second.loads[0].layers[0].pixels!, inTiles(10, ALL))).toBe(true)
      expect(second.following).toBe(true)
      expect(store().openProgress).toBeNull()
    })

    it('loads once into an engine that comes back while its document loads (React StrictMode)', async () => {
      const id = await seedTiled()
      await service.start()
      expect(await service.openProject(id)).toBe(true)
      const engine = new FakeDocumentEngine(W, H)
      service.attachEngine(engine)()
      service.attachEngine(engine)
      // Not saved from until the document is in.
      expect(engine.following).toBe(false)
      await service.settled()

      expect(engine.loads).toHaveLength(1)
      expect(engine.placed).toHaveLength(4)
      expect(engine.following).toBe(true)
    })

    it('keeps a restarted canvas from being used until the last save is in it again', async () => {
      const id = await seedProject('Painting')
      await service.start()
      const { detach } = await openAndAttach(id)
      expect(store().openProgress).toBeNull()

      let release!: () => void
      const held = new Promise<void>((resolve) => (release = resolve))
      const read = tiles.readTiles.bind(tiles)
      const spy = vi.spyOn(tiles, 'readTiles').mockImplementationOnce(async (...args) => {
        await held
        return read(...args)
      })
      // The canvas restarts (the error screen's Retry, a lost GPU context): a new, empty engine.
      detach()
      const restarted = new FakeDocumentEngine()
      service.attachEngine(restarted)
      // At once: the overlay covers it, and shortcuts, paste and drop wait.
      expect(store().openProgress).toBe(0)
      await vi.waitFor(() => expect(spy).toHaveBeenCalled())
      expect(store().openProgress).toBe(0)
      // Ctrl+S doesn't claim to have saved what the canvas doesn't have yet.
      expect(await service.saveNow()).toBe(true)
      expect(toasts()).toEqual([])

      release()
      await service.settled()
      expect(store().openProgress).toBeNull()
      expect(restarted.loads.map((l) => l.layers.map((layer) => layer.pixels?.[0]))).toEqual([[1, 2]])
      expect(restarted.following).toBe(true)
    })

    it('keeps a restarted canvas from being used while a project saved the old way loads into it again', async () => {
      const id = await db.createProject('Old', 2, 2, 72)
      await writeLegacyLayers(id, [{ info: layerInfo('bg', 'Background'), pixels: filled(5) }])
      await service.start()
      const { detach } = await openAndAttach(id)
      expect(store().openProgress).toBeNull()

      let release!: () => void
      const held = new Promise<void>((resolve) => (release = resolve))
      const getProject = db.getProject.bind(db)
      const spy = vi.spyOn(db, 'getProject').mockImplementationOnce(async (...args) => {
        await held
        return getProject(...args)
      })
      detach()
      const restarted = new FakeDocumentEngine()
      service.attachEngine(restarted)
      await vi.waitFor(() => expect(spy).toHaveBeenCalled())
      expect(store().openProgress).toBe(0)

      release()
      await service.settled()
      expect(store().openProgress).toBeNull()
      expect(restarted.loads.map((l) => l.layers.map((layer) => layer.pixels?.[0]))).toEqual([[5]])
    })

    it('opens a new project at once, with nothing to load', async () => {
      await service.start()
      expect(store()).toMatchObject({ view: 'canvas', openProgress: null })
      const engine = new FakeDocumentEngine()
      service.attachEngine(engine)
      expect(engine.following).toBe(true)
    })

    it('opens a project with the view and guides it was saved with', async () => {
      const view = { x: 120, y: 80, zoom: 3, rotation: 0.5 }
      const guides = { ...defaultGuides(W, H), gridEnabled: true, gridSpacing: 64, symmetryEnabled: true, symmetryCenterX: 100 }
      const id = await seedTiled({ view, guides })
      useGuideStore.getState().setQuickShapeEnabled(true)
      await service.start()

      const { engine } = await openAndAttach(id, W, H)
      expect(store().initialView).toEqual(view)
      expect(documentGuides(useGuideStore.getState())).toEqual(guides)
      // QuickShape is the user's, not the project's.
      expect(useGuideStore.getState().quickShapeEnabled).toBe(true)
      expect(engine.loads[0].activeLayerId).toBe('bg')
      // Showing them isn't a change.
      expect(service.hasUnsavedChanges).toBe(false)
      expect(store().takeInitialView()).toEqual(view)
      expect(store().takeInitialView()).toBeNull()
    })

    it("gives a project without guides fresh ones centred on it, not the last project's", async () => {
      const id = await seedTiled({ guides: { ...defaultGuides(W, H), gridEnabled: true } })
      await service.start()
      await openAndAttach(id, W, H)
      expect(useGuideStore.getState().gridEnabled).toBe(true)

      expect(await service.createProject({ name: 'Next', width: 640, height: 480, dpi: 72, colorSpace: 'srgb' })).toBe(true)
      expect(useGuideStore.getState()).toMatchObject({ gridEnabled: false, symmetryCenterX: 320, symmetryCenterY: 240 })
      expect(store().initialView).toBeNull()
    })

    it('saves the guides soon after they change, and the view when the project closes', async () => {
      const id = await seedTiled()
      await service.start()
      const { engine } = await openAndAttach(id, W, H)

      useGuideStore.getState().setSymmetryEnabled(true)
      expect(service.hasUnsavedChanges).toBe(true)
      await vi.waitFor(async () => expect((await db.getProject(id))!.guides?.symmetryEnabled).toBe(true))

      // QuickShape isn't the project's: no save for it.
      await vi.waitFor(() => expect(service.hasUnsavedChanges).toBe(false))
      useGuideStore.getState().setQuickShapeEnabled(true)
      expect(service.hasUnsavedChanges).toBe(false)

      // Zooming and choosing a layer aren't edits: they are written as the project closes.
      engine.view = { x: 10, y: 20, zoom: 0.5, rotation: 0 }
      engine.activeLayerId = 'ink'
      expect(service.hasUnsavedChanges).toBe(false)
      const modified = (await db.getProject(id))!.updatedAt
      expect(await service.goToGallery()).toBe(true)
      expect(await db.getProject(id)).toMatchObject({ view: engine.view, activeLayerId: 'ink', updatedAt: modified })
    })

    it('writes nothing when a project is opened and closed as it was', async () => {
      const id = await seedTiled({ view: { x: 300, y: 150, zoom: 1, rotation: 0 } })
      await service.start()
      const { engine } = await openAndAttach(id, W, H)
      engine.view = { x: 300, y: 150, zoom: 1, rotation: 0 }
      const update = vi.spyOn(db, 'updateProject')
      expect(await service.goToGallery()).toBe(true)
      expect(update).not.toHaveBeenCalled()
    })
  })

  describe('files on disk (plan M1.5)', () => {
    /** A file's handle, as tests stand it in: a record, which storage can keep. `id` tells files apart. */
    function fileHandle(name: string, id = name): FileHandle {
      return { kind: 'file', name, id } as unknown as FileHandle
    }

    /** A .qart file of a 2 × 2, 300 dpi document: a Sky layer under an active Ink layer. */
    async function qartFile(name: string) {
      const blob = await writeQart({
        name: 'ignored',
        width: 2,
        height: 2,
        dpi: 300,
        activeLayerId: 'l2',
        layers: [
          { info: layerInfo('l1', 'Sky'), order: 0, pixels: filled(10) },
          { info: layerInfo('l2', 'Ink'), order: 1, pixels: filled(20) },
        ],
      })
      // As the fake disk has it: last modified at 1.
      return new File([blob], name, { lastModified: 1 })
    }

    /** A write to a file (the last by default): the handle, and each layer's name and first grey, as the file has them. */
    async function written(call = -1) {
      const [handle, blob] = files.writeFile.mock.calls.at(call)!
      const { manifest, layers } = await readQart(blob)
      const active = layers.find((l) => l.manifest.id === manifest.activeLayerId)?.manifest.name
      return { handle, layers: layers.map((l) => [l.manifest.name, l.pixels[0]]), active }
    }

    /** Start without storage, as a browser that blocks it does, with an engine on the canvas. */
    async function startUnsaved() {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const broken = new MetadataDB()
      vi.spyOn(broken, 'getAllProjects').mockRejectedValue(new DOMException('denied', 'SecurityError'))
      service = new ProjectService(broken)
      await service.start()
      useUIStore.setState({ toasts: [] })
      const engine = new FakeDocumentEngine()
      service.attachEngine(engine)
      return engine
    }

    /** Open a seeded project and save it as a .qart file picked as `handle`. */
    async function savedAs(handle = fileHandle('Painting.qart')) {
      const id = await seedProject('Painting')
      await service.start()
      const { engine } = await openAndAttach(id)
      files.canPickSaveFile.mockReturnValue(true)
      files.pickSaveFile.mockResolvedValue(handle)
      expect(await service.saveAsFile()).toBe(true)
      useUIStore.setState({ toasts: [] })
      return { id, engine, handle }
    }

    it('saves as a .qart file picked to save to, with every layer as the canvas has it', async () => {
      const id = await seedProject('Painting')
      await service.start()
      const { engine } = await openAndAttach(id)
      engine.paint(9)
      // Saved, thumbnail and all: Save as has nothing left to save in the browser.
      expect(await service.saveNow()).toBe(true)
      const modified = (await db.getProject(id))!.updatedAt.getTime()
      useUIStore.setState({ toasts: [] })
      files.canPickSaveFile.mockReturnValue(true)
      const picked = fileHandle('Painting.qart')
      files.pickSaveFile.mockResolvedValue(picked)

      expect(await service.saveAsFile()).toBe(true)

      expect(files.pickSaveFile).toHaveBeenCalledWith('Painting.qart')
      expect(await written()).toEqual({ handle: picked, layers: [['Background', 9], ['Ink', 2]], active: 'Background' })
      expect(toasts()).toEqual(['Saved “Painting” to “Painting.qart”'])
      // Kept with the project, without changing its modified date, with the time the file has.
      const record = (await db.getProject(id))!
      expect(record.fileHandle).toEqual(picked)
      expect(record.fileModified).toBe(disk.get('Painting.qart'))
      expect(record.updatedAt.getTime()).toBe(modified)
    })

    it('writes the file again with Ctrl+S, besides saving in the browser', async () => {
      const { id, engine, handle } = await savedAs()
      engine.paint(10)

      expect(await service.saveNow()).toBe(true)

      expect(files.mayWrite).toHaveBeenCalledWith(handle)
      expect(files.writeFile).toHaveBeenCalledTimes(2)
      expect((await written()).layers).toEqual([['Background', 10], ['Ink', 2]])
      expect(await firstByte(id, 'bg')).toBe(10)
      expect(toasts()).toEqual(['Saved “Painting” to “Painting.qart”'])
    })

    it('writes the file a project was saved as when it opens again', async () => {
      const { id, handle } = await savedAs()
      expect(await service.goToGallery()).toBe(true)
      const { engine } = await openAndAttach(id)
      engine.paint(11)

      expect(await service.saveNow()).toBe(true)

      expect(await written()).toMatchObject({ handle, layers: [['Background', 11], ['Ink', 2]] })
    })

    it('writes the document as it was at the key press, while the browser asks whether it may', async () => {
      const { engine } = await savedAs()
      engine.paint(20)
      let allow: (ok: boolean) => void = () => {}
      files.mayWrite.mockReturnValue(new Promise((resolve) => (allow = resolve)))

      const saving = service.saveNow()
      engine.paint(21)
      allow(true)

      expect(await saving).toBe(true)
      expect((await written()).layers[0]).toEqual(['Background', 20])
    })

    it('writes nothing when the picker is closed without a file', async () => {
      const id = await seedProject('Painting')
      await service.start()
      await openAndAttach(id)
      files.canPickSaveFile.mockReturnValue(true)
      files.pickSaveFile.mockResolvedValue(null)

      expect(await service.saveAsFile()).toBe(false)

      expect(files.writeFile).not.toHaveBeenCalled()
      expect(toasts()).toEqual([])
      expect((await db.getProject(id))!.fileHandle).toBeUndefined()
    })

    it('says why it could not save to the file picked, and keeps no file', async () => {
      const id = await seedProject('Painting')
      await service.start()
      await openAndAttach(id)
      files.canPickSaveFile.mockReturnValue(true)
      files.pickSaveFile.mockResolvedValue(fileHandle('Painting.qart'))
      files.writeFile.mockRejectedValue(new DOMException('no room', 'QuotaExceededError'))

      expect(await service.saveAsFile()).toBe(false)

      expect(toasts()).toEqual(["Couldn't save “Painting” to “Painting.qart”: the disk is full"])
      expect((await db.getProject(id))!.fileHandle).toBeUndefined()
    })

    it('downloads the .qart file where a file cannot be picked to save to, and Ctrl+S then saves in the browser only', async () => {
      const id = await seedProject('Painting')
      await service.start()
      const { engine } = await openAndAttach(id)
      engine.paint(9)

      expect(await service.saveAsFile()).toBe(true)

      const [[blob, name]] = files.downloadFile.mock.calls
      expect(name).toBe('Painting.qart')
      expect((await readQart(blob)).layers.map((l) => l.pixels[0])).toEqual([9, 2])
      expect(toasts()).toEqual(['Downloaded “Painting.qart”'])
      expect(await service.saveNow()).toBe(true)
      expect(files.writeFile).not.toHaveBeenCalled()
      expect(toasts().at(-1)).toBe('Saved “Painting”')
    })

    it('saves in the browser, and says so, when the file may not be written; the next Ctrl+S asks again', async () => {
      const { id, engine } = await savedAs()
      engine.paint(30)
      files.mayWrite.mockResolvedValue(false)

      expect(await service.saveNow()).toBe(false)

      expect(files.writeFile).toHaveBeenCalledTimes(1)
      expect(await firstByte(id, 'bg')).toBe(30)
      const toast = useUIStore.getState().toasts.at(-1)!
      expect(toast.message).toBe("Saved “Painting” in the browser, but not to “Painting.qart”: the browser didn't allow writing to it")
      expect(toast.action?.label).toBe('Save as .qart…')
      files.mayWrite.mockResolvedValue(true)
      expect(await service.saveNow()).toBe(true)
      expect(files.writeFile).toHaveBeenCalledTimes(2)
    })

    it('forgets a file that was moved or deleted', async () => {
      const { id } = await savedAs()
      files.writeFile.mockRejectedValueOnce(new DOMException('gone', 'NotFoundError'))

      expect(await service.saveNow()).toBe(false)

      expect(toasts()).toEqual(['Saved “Painting” in the browser, but not to “Painting.qart”: it was moved or deleted'])
      await vi.waitFor(async () => expect((await db.getProject(id))!.fileHandle).toBeUndefined())
      expect(await service.saveNow()).toBe(true)
      expect(files.writeFile).toHaveBeenCalledTimes(2)
      expect(toasts().at(-1)).toBe('Saved “Painting”')
    })

    it('says when a layer cannot be read for the file, and saves in the browser all the same', async () => {
      const { id, engine } = await savedAs()
      engine.paint(31)
      vi.spyOn(engine, 'getLayerPixels').mockReturnValueOnce(null)

      expect(await service.saveNow()).toBe(false)

      expect(await firstByte(id, 'bg')).toBe(31)
      expect(toasts()).toEqual([
        "Saved “Painting” in the browser, but not to “Painting.qart”: the layer “Background” can't be read right now. Try again in a moment",
      ])
    })

    it('keeps a file with one project: another saved to it takes it over', async () => {
      const a = await seedProject('A')
      const b = await seedProject('B')
      await service.start()
      files.canPickSaveFile.mockReturnValue(true)
      await openAndAttach(a)
      files.pickSaveFile.mockResolvedValue(fileHandle('Shared.qart', 'shared'))
      expect(await service.saveAsFile()).toBe(true)
      await openAndAttach(b)
      // The same file, picked again: another handle to it.
      files.pickSaveFile.mockResolvedValue({ ...fileHandle('Shared.qart', 'shared'), again: true } as unknown as FileHandle)
      expect(await service.saveAsFile()).toBe(true)

      expect((await db.getProject(a))!.fileHandle).toBeUndefined()
      expect((await db.getProject(b))!.fileHandle).toMatchObject({ id: 'shared', again: true })
    })

    it('does not copy the file with a duplicate: the copy is work of its own', async () => {
      const { id } = await savedAs()
      expect(await service.goToGallery()).toBe(true)

      await service.duplicateProject(id)

      const copy = (await db.getAllProjects()).find((p) => p.name === 'Painting copy')!
      expect(copy.fileHandle).toBeUndefined()
      expect((await db.getProject(id))!.fileHandle).toBeDefined()
    })

    it('opens a .qart file as a new project, once the open one is saved, and writes it with Ctrl+S', async () => {
      const id = await seedProject('Painting')
      await service.start()
      const { engine } = await openAndAttach(id)
      engine.paint(40)
      const handle = fileHandle('Landscape.qart')
      files.pickOpenFile.mockResolvedValue({ file: await qartFile('Landscape.qart'), handle })

      expect(await service.openFile()).toBe(true)

      expect(await firstByte(id, 'bg')).toBe(40)
      expect(store()).toMatchObject({ view: 'canvas', currentProjectName: 'Landscape', canvasWidth: 2, canvasHeight: 2, dpi: 300 })
      const project = (await db.getAllProjects()).find((p) => p.name === 'Landscape')!
      expect(project.stackId).toBeUndefined()
      expect(project.fileHandle).toEqual(handle)
      const opened = new FakeDocumentEngine()
      service.attachEngine(opened)
      await service.settled()
      expect(opened.loads[0].layers.map((l) => l.pixels?.[0])).toEqual([10, 20])
      opened.paint(50)
      expect(await service.saveNow()).toBe(true)
      expect(await written()).toEqual({ handle, layers: [['Sky', 10], ['Ink', 50]], active: 'Ink' })
    })

    it('opens an image as a new project of its own, which Ctrl+S does not write to', async () => {
      await seedProject('Painting')
      await service.start()
      vi.mocked(decodeImageBlob).mockResolvedValue({ pixels: new Uint8ClampedArray(16).fill(200), width: 2, height: 2 })
      files.pickOpenFile.mockResolvedValue({ file: new File(['png'], 'cat.png', { type: 'image/png' }), handle: fileHandle('cat.png') })

      expect(await service.openFile()).toBe(true)

      expect(store().currentProjectName).toBe('cat')
      expect((await db.getAllProjects()).find((p) => p.name === 'cat')!.fileHandle).toBeUndefined()
      const engine = new FakeDocumentEngine()
      service.attachEngine(engine)
      await service.settled()
      engine.paint(1)
      expect(await service.saveNow()).toBe(true)
      expect(files.writeFile).not.toHaveBeenCalled()
    })

    it('opens from the Gallery into the stack open there', async () => {
      const existing = await seedProject('Painting')
      await service.start()
      const stack = await service.createStack('Studies', [existing])
      service.openStack(stack)
      files.pickOpenFile.mockResolvedValue({ file: await qartFile('Landscape.qart'), handle: null })

      expect(await service.openFile()).toBe(true)

      expect((await db.getAllProjects()).find((p) => p.name === 'Landscape')!.stackId).toBe(stack)
    })

    it('says why it cannot open a PSD file or another, leaves the open project open, and does nothing for a closed picker', async () => {
      const id = await seedProject('Painting')
      await service.start()
      await openAndAttach(id)
      const pick = (file: File) => files.pickOpenFile.mockResolvedValueOnce({ file, handle: null })
      files.pickOpenFile.mockResolvedValueOnce(null)
      pick(new File(['psd'], 'scan.psd'))
      pick(new File(['text'], 'notes.txt', { type: 'text/plain' }))
      pick(new File(['not a zip'], 'bad.qart'))

      for (let i = 0; i < 4; i++) expect(await service.openFile()).toBe(false)

      expect(toasts()).toEqual([
        "“scan.psd”: PSD files can't be opened yet",
        "“notes.txt” isn't a .qart file or an image",
        expect.stringMatching(/^Couldn't open “bad\.qart”: /),
      ])
      expect(store()).toMatchObject({ view: 'canvas', currentProjectId: id })
      expect((await db.getAllProjects()).map((p) => p.name)).toEqual(['Painting'])
    })

    it('says why the open picker failed', async () => {
      files.pickOpenFile.mockRejectedValue(new DOMException('Must be handling a user gesture to show a file picker.', 'SecurityError'))
      expect(await service.openFile()).toBe(false)
      expect(toasts()).toEqual(["Couldn't open a file: Must be handling a user gesture to show a file picker."])
    })

    it('without storage, opens a file in the canvas’s place, and Ctrl+S writes the file', async () => {
      await startUnsaved()
      const handle = fileHandle('Landscape.qart')
      files.pickOpenFile.mockResolvedValue({ file: await qartFile('Landscape.qart'), handle })
      const before = store().sessionId

      expect(await service.openFile()).toBe(true)

      expect(store()).toMatchObject({ view: 'canvas', currentProjectId: null, currentProjectName: 'Landscape', canvasWidth: 2, dpi: 300 })
      expect(store().sessionId).not.toBe(before)
      // Until it is in, the canvas can't be used.
      expect(store().openProgress).toBe(0)
      const engine = new FakeDocumentEngine()
      service.attachEngine(engine)
      expect(engine.loads[0].layers.map((l) => l.pixels?.[0])).toEqual([10, 20])
      expect(store().openProgress).toBeNull()

      engine.paint(60)
      expect(service.hasUnsavedChanges).toBe(true)
      expect(await service.saveNow()).toBe(true)
      expect(await written()).toEqual({ handle, layers: [['Sky', 10], ['Ink', 60]], active: 'Ink' })
      expect(toasts().at(-1)).toBe('Saved “Landscape” to “Landscape.qart”')
      // The file has its changes: the canvas can go without asking.
      expect(service.hasUnsavedChanges).toBe(false)
      expect(await service.capture()).toBe(true)
    })

    it('without storage, asks before a file replaces a canvas with changes', async () => {
      const engine = await startUnsaved()
      engine.paint(1)
      files.pickOpenFile.mockResolvedValue({ file: await qartFile('Landscape.qart'), handle: null })
      const session = store().sessionId

      expect(await service.openFile()).toBe(false)

      expect(store().sessionId).toBe(session)
      const toast = useUIStore.getState().toasts.at(-1)!
      expect(toast).toMatchObject({
        message: "The open canvas can't be saved in this browser, so opening “Landscape.qart” loses it",
        action: { label: 'Open anyway' },
      })
      toast.action!.run()
      expect(store()).toMatchObject({ currentProjectName: 'Landscape' })
      expect(store().sessionId).not.toBe(session)
    })

    it('without storage, offers on Ctrl+S to save a .qart file, which Ctrl+S writes from then on', async () => {
      const engine = await startUnsaved()
      engine.paint(1)

      expect(await service.saveNow()).toBe(false)

      const toast = useUIStore.getState().toasts.at(-1)!
      expect(toast.message).toBe("“Untitled Project” can't be saved in this browser. Save it as a .qart file to keep it.")
      expect(toast.action?.label).toBe('Save as .qart…')
      files.canPickSaveFile.mockReturnValue(true)
      files.pickSaveFile.mockResolvedValue(fileHandle('Untitled Project.qart'))
      toast.action!.run()
      await vi.waitFor(() => expect(files.writeFile).toHaveBeenCalledOnce())
      await vi.waitFor(() => expect(service.hasUnsavedChanges).toBe(false))

      engine.paint(2)
      expect(service.hasUnsavedChanges).toBe(true)
      expect(await service.saveNow()).toBe(true)
      expect((await written()).layers).toEqual([['Layer 1', 2]])
      expect(service.hasUnsavedChanges).toBe(false)
    })

    it('without storage, never writes a restarted, empty canvas over the file it was saved to', async () => {
      const engine = await startUnsaved()
      engine.paint(1)
      files.canPickSaveFile.mockReturnValue(true)
      files.pickSaveFile.mockResolvedValue(fileHandle('Untitled Project.qart'))
      expect(await service.saveAsFile()).toBe(true)
      // React StrictMode hands the same engine over again: nothing was lost.
      service.attachEngine(engine)
      expect(await service.saveNow()).toBe(true)
      expect(files.writeFile).toHaveBeenCalledTimes(2)

      // A lost GPU context: the canvas comes back with a new, empty engine.
      service.attachEngine(new FakeDocumentEngine())

      expect(toasts().at(-1)).toBe(
        'The canvas restarted and lost what it showed. “Untitled Project.qart” still has it as last saved: open it again with File › Open…',
      )
      expect(await service.saveNow()).toBe(false)
      expect(files.writeFile).toHaveBeenCalledTimes(2)
    })

    it('does not write a project that opened with tiles it could not read over its file, which may still have them', async () => {
      const { id, handle } = await savedAs()
      expect(await written()).toMatchObject({ handle, layers: [['Background', 1], ['Ink', 2]] })
      expect(await service.goToGallery()).toBe(true)
      // One of the project's saved tiles is lost from browser storage.
      const [record] = await (await getDB()).getAll('tileData')
      await (await getDB()).delete('tileData', [record.projectId, record.layerId, record.key])

      await openAndAttach(id)

      expect(toasts().at(-1)).toBe(
        "Part of “Painting” couldn't be read and shows as transparent (1 tile of 256 × 256 px). “Painting.qart” may still have it, so Ctrl+S no longer writes to it: open it with File › Open…",
      )
      expect(await service.saveNow()).toBe(true)
      expect(files.writeFile).toHaveBeenCalledOnce()
      await vi.waitFor(async () => expect((await db.getProject(id))!.fileHandle).toBeUndefined())
    })

    it('after a reload, does not write the older browser copy over the file Ctrl+S wrote while storage was full', async () => {
      const { id, engine, handle } = await savedAs()
      let full = true
      const save = tiles.save.bind(tiles)
      vi.spyOn(tiles, 'save').mockImplementation(async (...args) => {
        if (full) throw new DOMException('no room', 'QuotaExceededError')
        return save(...args)
      })
      // Storage is full: Ctrl+S can't save in the browser, but writes the file.
      engine.paint(77)
      expect(await service.saveNow()).toBe(false)
      expect(toasts()).toContain('Saved “Painting” to “Painting.qart”')
      expect((await written()).layers).toEqual([['Background', 77], ['Ink', 2]])

      // The project can't close, so the tab is closed: the file has the work. Later, with room again, it opens.
      full = false
      useProjectStore.setState(initialProjectState, true)
      useUIStore.setState({ toasts: [] })
      service = new ProjectService(db, { debounceMs: 10, store: tiles })
      await service.start()
      const { engine: reopened } = await openAndAttach(id)
      reopened.paint(5)

      expect(await service.saveNow()).toBe(false)

      expect(files.writeFile).toHaveBeenCalledTimes(2)
      expect(await written()).toMatchObject({ handle, layers: [['Background', 77], ['Ink', 2]] })
      expect(toasts()).toEqual([
        'Saved “Painting” in the browser, but not to “Painting.qart”: it may have changed since “Painting” was last saved to it. Open it with File › Open… to keep what it has, or Save as .qart… to replace it',
      ])
      await vi.waitFor(async () => expect((await db.getProject(id))!.fileHandle).toBeUndefined())
    })

    it('leaves a file another program wrote since the project last saved to it, and writes one the project wrote', async () => {
      const { id, engine, handle } = await savedAs()
      engine.paint(3)
      expect(await service.saveNow()).toBe(true)
      expect(await service.goToGallery()).toBe(true)
      // Reopened, the project still writes its file: the browser copy has what the file has.
      const { engine: reopened } = await openAndAttach(id)
      reopened.paint(4)
      expect(await service.saveNow()).toBe(true)
      expect(files.writeFile).toHaveBeenCalledTimes(3)

      writtenElsewhere(handle)
      reopened.paint(5)

      expect(await service.saveNow()).toBe(false)
      expect(files.writeFile).toHaveBeenCalledTimes(3)
      expect(toasts().at(-1)).toMatch(/^Saved “Painting” in the browser, but not to “Painting.qart”: it may have changed since/)
      // Let go of: the next Ctrl+S saves in the browser only, and says so.
      expect(await service.saveNow()).toBe(true)
      expect(toasts().at(-1)).toBe('Saved “Painting”')
    })

    it('keeps the file Save as picked with the project when it closes while the file is being written', async () => {
      const id = await seedProject('Painting')
      await service.start()
      await openAndAttach(id)
      files.canPickSaveFile.mockReturnValue(true)
      const handle = fileHandle('Painting.qart')
      files.pickSaveFile.mockResolvedValue(handle)
      let finish!: () => void
      files.writeFile.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))

      const saving = service.saveAsFile()
      await vi.waitFor(() => expect(files.writeFile).toHaveBeenCalledOnce())
      // A large file takes a while to write; meanwhile the user goes back to the Gallery.
      expect(await service.goToGallery()).toBe(true)
      finish()

      expect(await saving).toBe(true)
      expect(toasts().at(-1)).toBe('Saved “Painting” to “Painting.qart”')
      expect((await db.getProject(id))!.fileHandle).toEqual(handle)
      // Ctrl+S writes it when the project opens again.
      const { engine } = await openAndAttach(id)
      engine.paint(6)
      expect(await service.saveNow()).toBe(true)
      expect(await written()).toMatchObject({ handle, layers: [['Background', 6], ['Ink', 2]] })
    })

    it('stops writing a file with Ctrl+S once another tab linked it to another project', async () => {
      const a = await seedProject('A')
      const b = await seedProject('B')
      await service.start()
      const { engine } = await openAndAttach(a)
      files.canPickSaveFile.mockReturnValue(true)
      const shared = fileHandle('Shared.qart', 'shared')
      files.pickSaveFile.mockResolvedValue(shared)
      expect(await service.saveAsFile()).toBe(true)
      // Another tab opens the file as B: what its File › Open… writes.
      await db.updateProject(a, { fileHandle: undefined, fileModified: undefined }, { touch: false })
      await db.updateProject(b, { fileHandle: { ...shared } as FileHandle, fileModified: disk.get('shared') }, { touch: false })
      engine.paint(9)

      expect(await service.saveNow()).toBe(false)

      expect(files.writeFile).toHaveBeenCalledOnce()
      expect(toasts().at(-1)).toBe(
        'Saved “A” in the browser, but not to “Shared.qart”: it belongs to another project now. Save as .qart… to write to it anyway',
      )
      expect((await db.getProject(b))!.fileHandle).toMatchObject({ id: 'shared' })
    })

    it('writes the latest of the Ctrl+S presses made while the file is being written, once, rather than each', async () => {
      const { engine } = await savedAs()
      let finish!: () => void
      files.writeFile.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
      const saves = [service.saveNow()]
      await vi.waitFor(() => expect(files.writeFile).toHaveBeenCalledTimes(2))
      // Pressed again and again while a large file writes.
      for (let i = 0; i < 9; i++) {
        engine.paint(10 + i)
        saves.push(service.saveNow())
      }
      finish()

      expect(await Promise.all(saves)).toEqual(Array(10).fill(true))
      expect(files.writeFile).toHaveBeenCalledTimes(3)
      expect((await written()).layers).toEqual([['Background', 18], ['Ink', 2]])
    })

    it('without storage, does not write the empty canvas over a file that could not be put into it', async () => {
      await startUnsaved()
      const handle = fileHandle('Landscape.qart')
      files.pickOpenFile.mockResolvedValue({ file: await qartFile('Landscape.qart'), handle })
      expect(await service.openFile()).toBe(true)
      // The canvas made for it can't take the document (a GPU allocation failing, say).
      const opened = new FakeDocumentEngine()
      vi.spyOn(opened, 'loadDocument').mockImplementation(() => {
        throw new Error('out of memory')
      })

      service.attachEngine(opened)

      expect(toasts().at(-1)).toBe("Couldn't open “Landscape”: out of memory")
      expect(store().openProgress).toBeNull()
      opened.paint(5)
      expect(await service.saveNow()).toBe(false)
      expect(files.writeFile).not.toHaveBeenCalled()
    })

    it('without storage, still asks before leaving after a restart, when a write that was running finishes', async () => {
      const engine = await startUnsaved()
      files.canPickSaveFile.mockReturnValue(true)
      files.pickSaveFile.mockResolvedValue(fileHandle('Untitled Project.qart'))
      expect(await service.saveAsFile()).toBe(true)
      for (let i = 1; i <= 3; i++) engine.paint(i)
      let finish!: () => void
      files.writeFile.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
      const saving = service.saveNow()
      await vi.waitFor(() => expect(files.writeFile).toHaveBeenCalledTimes(2))

      // Meanwhile the canvas restarts, empty: the counts start again.
      const restarted = new FakeDocumentEngine()
      service.attachEngine(restarted)
      finish()
      expect(await saving).toBe(true)
      for (let i = 1; i <= 3; i++) restarted.paint(i)

      expect(service.hasUnsavedChanges).toBe(true)
    })

    it('without storage, still asks before leaving a canvas only downloaded: the download may not have been kept', async () => {
      const engine = await startUnsaved()
      engine.paint(1)
      expect(await service.saveAsFile()).toBe(true)
      expect(files.downloadFile).toHaveBeenCalledOnce()
      expect(service.hasUnsavedChanges).toBe(true)
    })
  })

  it('tells the user when a newer version in another tab takes over storage', async () => {
    await service.start()
    const newer = await openDB(DB_NAME, DB_VERSION + 1)
    newer.close()
    expect(toasts()).toEqual(['QUAR Artist was updated in another tab. Reload this tab to keep saving your work.'])
  })
})

describe('import helpers', () => {
  it('tells .qart, PSD and image files apart', () => {
    expect(importKind({ name: 'a.QART', type: '' })).toBe('qart')
    expect(importKind({ name: 'b.psd', type: 'image/vnd.adobe.photoshop' })).toBe('psd')
    expect(importKind({ name: 'c', type: 'image/png' })).toBe('image')
    expect(importKind({ name: 'd.jpeg', type: '' })).toBe('image')
    expect(importKind({ name: 'e.txt', type: 'text/plain' })).toBe('other')
  })

  it('sorts dropped files: images become layers, the first .qart file opens, and the rest are refused (plan M1.5)', () => {
    const cat = new File(['png'], 'cat.png', { type: 'image/png' })
    const dog = new File(['jpg'], 'dog.jpg')
    const first = new File(['zip'], 'First.qart')
    const second = new File(['zip'], 'Second.qart')
    const scan = new File(['psd'], 'scan.psd')
    const notes = new File(['text'], 'notes.txt', { type: 'text/plain' })

    expect(sortDroppedFiles([notes, cat, first, scan, second, dog])).toEqual({
      images: [cat, dog],
      project: first,
      refused: [
        "“notes.txt” isn't a .qart file or an image",
        "“scan.psd”: PSD files can't be opened yet",
        "“Second.qart” wasn't opened: one project opens at a time",
      ],
    })
    expect(sortDroppedFiles([])).toEqual({ images: [], project: null, refused: [] })
  })

  it('names a project after its file', () => {
    expect(baseName('My Painting.final.png')).toBe('My Painting.final')
    expect(baseName('sketch')).toBe('sketch')
    expect(baseName('.png')).toBe('Untitled')
  })
})
