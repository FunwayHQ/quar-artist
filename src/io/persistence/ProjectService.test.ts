import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { deleteDB, openDB } from 'idb'
import { ProjectService, DEFAULT_PROJECT, DELETE_UNDO_MS, PURGE_GRACE_MS, baseName, importKind } from './ProjectService.ts'
import { MetadataDB } from './MetadataDB.ts'
import { DB_NAME, DB_VERSION, resetDB, type ProjectRecord } from '../../db/schema.ts'
import { useProjectStore } from '../../stores/projectStore.ts'
import { useUIStore } from '../../stores/uiStore.ts'
import { decodeImageBlob } from '../importImage.ts'
import { writeQart } from '../formats/qart/QartWriter.ts'
import { FakeDocumentEngine, layerInfo } from '../../test/fakeDocumentEngine.ts'

vi.mock('../importImage.ts', () => ({ decodeImageBlob: vi.fn() }))
// jsdom has no 2D canvas to draw thumbnails with.
vi.mock('./thumbnail.ts', () => ({
  encodeLayersThumbnail: vi.fn(async () => ({ type: 'image/webp', data: new Uint8Array([1, 2, 3]).buffer })),
  encodeThumbnail: vi.fn(async () => null),
}))

const initialProjectState = useProjectStore.getState()
const store = () => useProjectStore.getState()
const toasts = () => useUIStore.getState().toasts.map((t) => t.message)
const filled = (value: number) => new Uint8Array(2 * 2 * 4).fill(value)

describe('ProjectService', () => {
  let db: MetadataDB
  let service: ProjectService

  beforeEach(async () => {
    resetDB()
    await deleteDB(DB_NAME)
    useProjectStore.setState(initialProjectState, true)
    useUIStore.setState({ toasts: [] })
    vi.mocked(decodeImageBlob).mockReset()
    db = new MetadataDB()
    service = new ProjectService(db, { debounceMs: 10 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** A saved 2 × 2 project with two layers, the bottom one active. */
  async function seedProject(name: string, extra: Partial<ProjectRecord> = {}) {
    const id = await db.createProject(name, 2, 2, 72)
    await db.saveDocumentLayers(id, [
      { info: layerInfo('bg', 'Background'), pixels: filled(1) },
      { info: layerInfo('ink', 'Ink', { opacity: 0.5, blendMode: 'multiply' }), pixels: filled(2) },
    ])
    await db.updateProject(id, { activeLayerId: 'bg', ...extra }, { touch: false })
    return id
  }

  async function firstByte(projectId: string, layerId: string) {
    const data = await db.loadTile(projectId, layerId, 'full')
    return data ? new Uint8Array(data)[0] : null
  }

  async function openAndAttach(id: string) {
    expect(await service.openProject(id)).toBe(true)
    const engine = new FakeDocumentEngine()
    const detach = service.attachEngine(engine)
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
      expect(await db.loadLayers(gone)).toEqual([])
      expect(await db.getAllStacks()).toEqual([])
      expect(store().projects.map((p) => p.name)).toEqual(['Kept'])
    })

    it('leaves a recent delete to the tab that can still undo it, then makes it final', async () => {
      // Another tab deleted it a moment ago; its Undo window ends in 100 ms.
      const recent = await seedProject('Recent', { deletedAt: new Date(Date.now() - DELETE_UNDO_MS - PURGE_GRACE_MS + 100) })
      await seedProject('Kept')

      await service.start()

      expect(await db.getProject(recent)).toBeDefined()
      expect(store().projects.map((p) => p.name)).toEqual(['Kept'])
      await vi.waitFor(async () => expect(await db.getProject(recent)).toBeUndefined(), { timeout: 2000 })
    })

    it('keeps a recent delete that its tab undid in time', async () => {
      const recent = await seedProject('Recent', { deletedAt: new Date(Date.now() - DELETE_UNDO_MS - PURGE_GRACE_MS + 50) })
      await service.start()

      // The other tab's Undo.
      await db.updateProject(recent, { deletedAt: undefined }, { touch: false })
      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(await db.getProject(recent)).toBeDefined()
      expect(await db.loadLayers(recent)).toHaveLength(2)
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

    it('leaves a layer empty when its saved pixels are the wrong size', async () => {
      const id = await seedProject('Painting')
      await db.saveTile(id, 'ink', 'full', new ArrayBuffer(3))
      await service.start()
      const { engine } = await openAndAttach(id)
      expect(engine.loads[0].layers.map((l) => l.pixels === null)).toEqual([false, true])
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
      service = new ProjectService(db, { debounceMs: 60_000 })
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
      service = new ProjectService(db, { debounceMs: 60_000 })
      await service.start()
      const { engine } = await openAndAttach(id)
      engine.paint(9)
      vi.spyOn(db, 'saveLayers').mockRejectedValueOnce(new Error('disk full'))

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
      vi.spyOn(db, 'saveLayers').mockRejectedValue(new Error('disk full'))

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
      expect((await db.loadLayers(id)).map((l) => l.layerId)).toEqual(['bg', 'ink'])
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
      expect((await db.loadLayers(copy.id)).map((l) => l.layerId)).toEqual(['bg', 'ink'])
      expect(await firstByte(copy.id, 'ink')).toBe(2)
      expect(toasts()).toEqual(['Duplicated “A”'])
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
      expect(await db.loadLayers(id)).toHaveLength(2)
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
      expect(await db.loadTile(id, 'bg', 'full')).toBeNull()
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
      const layers = await db.loadLayers(project.id)
      expect(layers.map((l) => l.name)).toEqual(['Sky', 'Ink'])
      // Fresh ids, so importing a file twice makes two independent projects.
      expect(layers.map((l) => l.layerId)).not.toContain('l1')
      expect(layers[1]).toMatchObject({ blendMode: 'screen', opacity: 0.25 })
      expect(project.activeLayerId).toBe(layers[1].layerId)
      expect(toasts()).toEqual(['Imported “Landscape”'])

      const { engine } = await openAndAttach(project.id)
      expect(engine.loads[0].layers.map((l) => l.pixels?.[0])).toEqual([10, 20])
      expect(engine.loads[0].activeLayerId).toBe(layers[1].layerId)
    })

    it('imports an image as a one-layer project named after the file', async () => {
      vi.mocked(decodeImageBlob).mockResolvedValue({ pixels: new Uint8ClampedArray(16).fill(200), width: 2, height: 2 })

      await service.importFiles([new File(['png'], 'cat.png', { type: 'image/png' })])

      const project = store().projects.find((p) => p.name === 'cat')!
      expect(project).toMatchObject({ width: 2, height: 2, dpi: 72, colorSpace: 'srgb' })
      const [layer] = await db.loadLayers(project.id)
      expect(layer.name).toBe('cat')
      expect(project.activeLayerId).toBe(layer.layerId)
      expect(await firstByte(project.id, layer.layerId)).toBe(200)
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
      vi.spyOn(db, 'saveDocumentLayers').mockRejectedValueOnce(new DOMException('storage is full', 'QuotaExceededError'))

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

  it('names a project after its file', () => {
    expect(baseName('My Painting.final.png')).toBe('My Painting.final')
    expect(baseName('sketch')).toBe('sketch')
    expect(baseName('.png')).toBe('Untitled')
  })
})
