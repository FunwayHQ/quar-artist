import { useProjectStore } from '../../stores/projectStore.ts'
import { useUIStore, type ToastOptions } from '../../stores/uiStore.ts'
import { documentGuides, savedGuides, useGuideStore } from '../../stores/guideStore.ts'
import { MetadataDB } from './MetadataDB.ts'
import { DocumentSession, type DocumentEngine, type PlacedTile, type SavedBase } from './DocumentSession.ts'
import { isStaleLoad, type DocumentOutline, type DocumentStore, type SaveLayer, type TileRequest } from '../tiles/TileStore.ts'
import { createDocumentStore } from '../tiles/WorkerDocumentStore.ts'
import { TILE_SIZE, savedLayerInfo } from '../tiles/tileFormat.ts'
import type { SaveStatus } from './AutoSave.ts'
import { encodeLayersThumbnail } from './thumbnail.ts'
import { readQart } from '../formats/qart/QartReader.ts'
import { decodeImageBlob } from '../importImage.ts'
import { canvasSizeProblem } from '../../utils/deviceLimits.ts'
import { createId } from '../../utils/id.ts'
import { setDatabaseEventListener, type DatabaseEvent, type ProjectRecord } from '../../db/schema.ts'
import type { GallerySort, NewProjectConfig } from '../../types/project.ts'
import { MAX_LAYERS, type BlendMode, type LayerInfo, type StoredLayer } from '../../types/layer.ts'

const SETTING_SORT = 'gallery.sort'
const SETTING_LAST_PROJECT = 'gallery.lastProjectId'

/** How long a delete can be undone, in ms. */
export const DELETE_UNDO_MS = 8000
/** Extra time a delete waits after its Undo window before another tab makes it final. */
export const PURGE_GRACE_MS = 2000

/** The project the app opens with when there are none yet. */
export const DEFAULT_PROJECT: NewProjectConfig = {
  name: 'Untitled Project',
  width: 1920,
  height: 1080,
  dpi: 72,
  colorSpace: 'srgb',
}

const GALLERY_SORTS: readonly GallerySort[] = ['updated', 'created', 'name']

/** Tiles read and put into the canvas at a time while a document opens: 16 MB of pixels (plan M1.4). */
export const LOAD_BATCH_TILES = 64

/** What kind of file the Gallery was given to import. */
export function importKind(file: Pick<File, 'name' | 'type'>): 'qart' | 'psd' | 'image' | 'other' {
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'qart') return 'qart'
  if (ext === 'psd') return 'psd'
  if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'].includes(ext)) {
    return 'image'
  }
  return 'other'
}

/** A file name without its extension, as a project name. */
export function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim() || 'Untitled'
}

/** A name as toasts show it. */
function q(name: string): string {
  return `\u201c${name}\u201d`
}

/** Whether an error says the browser's storage is full. */
function isStorageFull(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'QuotaExceededError'
}

/** An error as toasts show it. DOMExceptions aren't Errors everywhere, so any message will do. */
function describe(err: unknown): string {
  const { message } = (typeof err === 'object' && err !== null ? err : {}) as { message?: unknown }
  if (isStorageFull(err)) return "the browser's storage is full"
  if (typeof message === 'string' && message) return message
  return String(err)
}

/** A delete that couldn't be made final yet. The project stays deleted, and the next start tries again. */
function warnPurge(err: unknown) {
  console.warn('[QUAR] A deleted project could not be removed yet:', err)
}

function newLayerInfo(name: string): LayerInfo {
  return {
    id: createId(),
    name,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    alphaLock: false,
    clippingMask: false,
    locked: false,
  }
}

/** A saved document, ready to load into an engine: the project record, at the document's size, and its layers. */
interface LoadedDocument {
  project: ProjectRecord
  /**
   * The layers to make, bottom first: whole, for a document saved before the
   * tile store, or without pixels, for one whose tiles load into them next.
   */
  layers: StoredLayer[]
  activeLayerId: string | null
  /** Where the tiles to load are, and the save they belong to; null for a document saved before the tile store. */
  outline: DocumentOutline | null
}

/** A document waiting for its engine. */
interface PendingDocument {
  sessionId: string
  doc: LoadedDocument
}

/**
 * The save a loaded document is, for its next saves to build on (plan M1.3).
 * None for one saved before the tile store, or with tiles that couldn't be
 * read: they show as transparent, so its next save writes whole layers and
 * saves what it shows. None either when the engine didn't make the saved
 * layers as they were (repeated ids, too many layers).
 */
function baseOf(doc: LoadedDocument, made: readonly string[], unreadableTiles: number): SavedBase | null {
  const { outline } = doc
  if (!outline || unreadableTiles > 0) return null
  const saved = outline.layers.map((l) => l.info.id)
  if (made.length !== saved.length || made.some((id, i) => id !== saved[i])) return null
  return { seq: outline.seq, width: outline.width, height: outline.height, layers: new Set(saved) }
}

/** Whether two guide settings are the same for a document. */
function sameGuides(a: Parameters<typeof documentGuides>[0], b: Parameters<typeof documentGuides>[0]): boolean {
  return JSON.stringify(documentGuides(a)) === JSON.stringify(documentGuides(b))
}

/** Stops the started service hearing about guide changes. */
let unwatchGuides: (() => void) | null = null

/**
 * The project lifecycle and the Gallery: create, open, close, rename, delete,
 * duplicate, stacks and import, all backed by database records (plan M1.1).
 *
 * One document is open at a time, in a DocumentSession of its own. Opening,
 * creating and closing run one at a time, and a document closes only after
 * its last changes are saved: when saving fails it stays open.
 */
export class ProjectService {
  private readonly db: MetadataDB
  private readonly tiles: DocumentStore
  private readonly debounceMs: number | undefined
  private readonly loadBatchTiles: number
  private session: DocumentSession | null = null
  private pending: PendingDocument | null = null
  private engine: DocumentEngine | null = null
  private started: Promise<void> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  /** True when the browser has no usable storage: documents open, but can't be saved. */
  private unsaved = false
  /** The canvas that can't be saved has changes, which replacing it would lose. */
  private unsavedChanged = false
  /** Saves running whose failure the caller reports itself (Ctrl+S, closing a project). */
  private reporting = 0
  /** A save failure was shown, and no save has worked since: further failures stay quiet. */
  private saveErrorShown = false
  /** Whether the browser was asked to keep this site's storage (once a save worked). */
  private persistAsked = false
  /** The engine the open document is loading into, until it is all in and saved from (plan M1.4). */
  private loadingInto: DocumentEngine | null = null
  /** True while a document's guides are being shown: that isn't a change to save. */
  private showingGuides = false

  constructor(
    db = new MetadataDB(),
    options: { debounceMs?: number; store?: DocumentStore; loadBatchTiles?: number } = {},
  ) {
    this.db = db
    this.tiles = options.store ?? createDocumentStore()
    this.debounceMs = options.debounceMs
    this.loadBatchTiles = Math.max(1, options.loadBatchTiles ?? LOAD_BATCH_TILES)
  }

  /** Wait for the lifecycle steps asked for so far (opening, loading into the canvas, closing) to finish. */
  settled(): Promise<void> {
    return this.queue.then(() => undefined)
  }

  private get store() {
    return useProjectStore
  }

  private toast(message: string, type: 'info' | 'success' | 'error', options?: ToastOptions) {
    useUIStore.getState().addToast(message, type, options)
  }

  /** Run a save whose failure the caller reports, so the save status doesn't report it too. */
  private async reported<T>(save: () => Promise<T>): Promise<T> {
    this.reporting++
    try {
      return await save()
    } finally {
      this.reporting--
    }
  }

  /** Run lifecycle steps one at a time, so two opens can't interleave. */
  private run<T>(step: () => Promise<T>): Promise<T> {
    const result = this.queue.then(step, step)
    this.queue = result.catch(() => undefined)
    return result
  }

  // ── Start-up ──────────────────────────────────────────────────────

  /**
   * Decide where the app opens: the Gallery when there are projects (PRD),
   * otherwise a new project. Without usable storage, an unsaved document.
   */
  start(): Promise<void> {
    setDatabaseEventListener((event) => this.onDatabaseEvent(event))
    // The guides are the document's: changing them is a change to save (plan M1.4).
    // Like storage events, they go to the service that started last.
    unwatchGuides?.()
    unwatchGuides = useGuideStore.subscribe((state, prev) => {
      if (!this.showingGuides && !sameGuides(state, prev)) this.session?.noteSettingsChange()
    })
    this.started ??= this.run(async () => {
      try {
        await this.purgeDeleted()
        const [sort, lastId] = await Promise.all([
          this.db.getSetting(SETTING_SORT),
          this.db.getSetting(SETTING_LAST_PROJECT),
        ])
        this.store.setState({
          gallerySort: GALLERY_SORTS.includes(sort as GallerySort) ? (sort as GallerySort) : 'updated',
          lastProjectId: lastId ?? null,
        })
        await this.refresh()
        if (this.store.getState().projects.length > 0) {
          this.store.setState({ view: 'gallery' })
        } else {
          await this.createAndOpen(DEFAULT_PROJECT)
        }
        await this.sweepOrphans().catch((err) => console.warn('[QUAR] Saved documents without a project could not be removed:', err))
      } catch (err) {
        console.error('[QUAR] Project storage is unavailable:', err)
        this.unsaved = true
        this.openUnsaved(DEFAULT_PROJECT)
        this.toast(`Your work can't be saved in this browser: ${describe(err)}`, 'error', { durationMs: 10000 })
      }
    })
    return this.started
  }

  private onDatabaseEvent(event: DatabaseEvent) {
    const long = { durationMs: 15000 }
    if (event === 'blocked') {
      this.toast('QUAR Artist is updating. Close it in your other tabs to finish.', 'info', long)
    } else if (event === 'blocking') {
      this.toast('QUAR Artist was updated in another tab. Reload this tab to keep saving your work.', 'error', long)
    } else {
      this.toast('The browser closed QUAR Artist\'s storage. Reload to keep saving your work.', 'error', long)
    }
  }

  /**
   * Reload the Gallery's projects and stacks. A thumbnail that can't have
   * changed (the project wasn't saved since) stays the same object, so its
   * card doesn't decode the image again.
   */
  async refresh(): Promise<void> {
    const [projects, stacks] = await Promise.all([this.db.getAllProjects(), this.db.getAllStacks()])
    const shown = new Map(this.store.getState().projects.map((p) => [p.id, p]))
    const visible = projects
      .filter((p) => !p.deletedAt)
      .map((p) => {
        const old = shown.get(p.id)
        const same =
          old?.thumbnail !== undefined &&
          p.thumbnail !== undefined &&
          old.updatedAt.getTime() === p.updatedAt.getTime() &&
          old.thumbnail.data.byteLength === p.thumbnail.data.byteLength
        return same ? { ...p, thumbnail: old.thumbnail } : p
      })
    this.store.setState({ projects: visible, stacks })
  }

  // ── Opening and closing ───────────────────────────────────────────

  /** Create a project and open it, after saving and closing the open one. */
  createProject(config: NewProjectConfig): Promise<boolean> {
    return this.run(async () => {
      if (this.unsaved) {
        if (!this.unsavedChanged) {
          this.openUnsaved(config)
          return true
        }
        this.toast("The open canvas can't be saved in this browser, so starting a new one loses it", 'error', {
          durationMs: 10000,
          action: { label: 'Start anyway', run: () => this.openUnsaved(config) },
        })
        return false
      }
      if (!(await this.closeCurrent())) return false
      try {
        await this.createAndOpen(config)
        return true
      } catch (err) {
        // The open project was saved and closed: show the Gallery rather than
        // leave its canvas on screen with nothing saving it.
        this.store.getState().clearCurrentProject()
        await this.refresh().catch(() => undefined)
        this.toast(`Couldn't create ${q(config.name)}: ${describe(err)}`, 'error')
        return false
      }
    })
  }

  /** Open a saved project, after saving and closing the open one. */
  openProject(id: string): Promise<boolean> {
    return this.run(async () => {
      const { view } = this.store.getState()
      if (this.session?.projectId === id && view === 'canvas') return true
      if (!(await this.closeCurrent())) return false

      const project = this.store.getState().projects.find((p) => p.id === id)
      const name = project ? q(project.name) : 'the project'
      this.store.setState({ view: 'loading' })
      try {
        const doc = await this.loadDocument(id)
        if (!doc) {
          this.store.getState().clearCurrentProject()
          await this.refresh()
          this.toast(`${name} no longer exists`, 'error')
          return false
        }
        // Its tiles load once the canvas is up (`attachEngine`).
        this.beginSession(doc.project, doc)
        await this.rememberLast(id)
        return true
      } catch (err) {
        this.store.getState().clearCurrentProject()
        this.toast(`Couldn't open ${name}: ${describe(err)}`, 'error')
        return false
      }
    })
  }

  /** Save and close the open project, then show the Gallery. */
  goToGallery(): Promise<boolean> {
    return this.run(async () => {
      if (this.unsaved) {
        this.toast("Your work can't be saved in this browser, so it stays open", 'error')
        return false
      }
      if (!(await this.closeCurrent())) return false
      this.store.getState().clearCurrentProject()
      await this.refresh()
      return true
    })
  }

  /** Save the open project now (Ctrl+S) and say how it went. */
  async saveNow(): Promise<boolean> {
    // Nothing can have changed in a document still opening.
    if (this.store.getState().view !== 'canvas' || this.store.getState().openProgress !== null) return true
    const session = this.session
    const name = q(this.store.getState().currentProjectName)
    if (!session) {
      this.toast(`${name} can't be saved in this browser`, 'error')
      return false
    }
    const ok = await this.reported(() => session.saveNow())
    if (ok) this.toast(`Saved ${name}`, 'success')
    else if (isStorageFull(session.lastError)) this.storageFull(name)
    else this.toast(`Couldn't save ${name}: ${describe(session.lastError)}`, 'error')
    return ok
  }

  /** Whether the open project has changes not saved yet. */
  get hasUnsavedChanges(): boolean {
    return this.session?.hasUnsavedChanges ?? (this.unsaved && this.unsavedChanged)
  }

  /**
   * Save the open project's unsaved changes, reading them now: for when its
   * canvas may go any moment (the page is hidden, or the app crashed).
   * Resolves true when nothing is left unsaved.
   */
  capture(): Promise<boolean> {
    if (this.session) return this.session.capture()
    return Promise.resolve(!(this.unsaved && this.unsavedChanged))
  }

  /**
   * Save when the page is hidden or put away, and ask before leaving it with
   * changes not saved yet (plan M1.3). Returns the function that stops it.
   */
  watchPage(
    win: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
    doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> = document,
  ): () => void {
    const save = () => {
      void this.capture()
    }
    const onVisibility = () => {
      if (doc.visibilityState === 'hidden') save()
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!this.hasUnsavedChanges) return
      // Save meanwhile: the browser asks whether to leave, and the save may be done by then.
      save()
      event.preventDefault()
      // Browsers from before preventDefault asked want this too.
      event.returnValue = true
    }
    doc.addEventListener('visibilitychange', onVisibility)
    win.addEventListener('pagehide', save)
    win.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      doc.removeEventListener('visibilitychange', onVisibility)
      win.removeEventListener('pagehide', save)
      win.removeEventListener('beforeunload', onBeforeUnload)
    }
  }

  /**
   * Hand the open document's engine over once it is running: the document is
   * loaded into it and saved from then on. Returns the function that hands it back.
   */
  attachEngine(engine: DocumentEngine): () => void {
    const session = this.session
    if (!session) {
      // Nothing is saved without storage, but note changes: replacing the canvas would lose them.
      if (!this.unsaved) return () => {}
      this.engine = engine
      engine.setDocumentChangeCallback(() => {
        this.unsavedChanged = true
      })
      return () => {
        if (this.engine !== engine) return
        this.engine = null
        engine.setDocumentChangeCallback(null)
      }
    }

    const pending = this.pending
    if (pending && pending.sessionId === this.store.getState().sessionId) {
      // The document the session opened with: load it, then save from it.
      this.pending = null
      this.startLoad(session, engine, pending.doc)
    } else if (this.loadingInto === engine) {
      // Back while its document loads (React runs effects twice in
      // development): the load saves from it once it is all in.
    } else if (session.isNewEngine(engine)) {
      // The canvas restarted with a new, empty engine. What the old one had
      // since the last save went with it: bring the last save back first.
      session.forgetUnsaved()
      this.startLoad(session, engine, null)
    } else {
      session.attach(engine)
    }
    this.engine = engine

    return () => {
      if (this.engine !== engine) return
      this.engine = null
      session.detach()
    }
  }

  /** Load a document into an engine, after the lifecycle steps before. `doc` null reads the last save again. */
  private startLoad(session: DocumentSession, engine: DocumentEngine, doc: LoadedDocument | null) {
    session.beginLoad(engine)
    this.loadingInto = engine
    // Every load keeps the canvas from being used until it is all in, a
    // restarted canvas loading the last save again too: what it took would be
    // replaced by the load, and never saved.
    this.store.getState().setOpenProgress(0)
    void this.run(() => this.loadInto(session, engine, doc))
  }

  /** Whether the session is still the open one, shown by this engine. */
  private current(session: DocumentSession, engine: DocumentEngine): boolean {
    return this.session === session && this.engine === engine
  }

  /**
   * Load the session's document into its engine, then save from it (plan
   * M1.4). The layers are made first, empty, and the saved tiles go into them
   * a batch at a time while the canvas shows how far it has got. Without
   * `given`, the last save is read again: the canvas restarted, and what the
   * old engine had since went with it.
   *
   * Nothing is saved from the engine until the document is all in: saving it
   * half-loaded would lose the rest. If it can't be loaded, the project is
   * left as saved and the Gallery shows.
   */
  private async loadInto(session: DocumentSession, engine: DocumentEngine, given: LoadedDocument | null) {
    const reopening = given === null
    const name = () => q(this.store.getState().currentProjectName)
    try {
      for (let attempt = 0; ; attempt++) {
        if (!this.current(session, engine)) return
        let doc = given
        given = null
        if (!doc) {
          // A save of what an old engine had may still be running: load what it leaves.
          await session.settled()
          if (!this.current(session, engine)) return
          doc = await this.loadDocument(session.projectId)
          if (!this.current(session, engine)) return
          if (!doc) {
            await this.closeFailed(session, `${name()} no longer exists`)
            return
          }
        }

        const size = engine.getDocumentSize()
        if (size.width !== doc.project.width || size.height !== doc.project.height) {
          // The canvas has another size than the save (a Canvas Size not saved
          // yet, or another tab resized it): open it again at the saved size.
          session.discard()
          this.beginSession(doc.project, doc)
          return
        }

        const made = engine.loadDocument(doc.layers, doc.activeLayerId)
        let unreadable = 0
        if (doc.outline) {
          try {
            const result = await this.streamTiles(session, engine, doc.outline, made)
            if (result === null) return
            unreadable = result
          } catch (err) {
            // Saved again meanwhile (another tab), so its tiles may be gone: start over from that save.
            if (isStaleLoad(err) && attempt < 2) continue
            throw err
          }
        }
        engine.finishLoading()
        session.setBase(baseOf(doc, made, unreadable))
        this.store.getState().setOpenProgress(null)
        session.attach(engine)
        this.reportUnreadable(doc.project.name, unreadable)
        return
      }
    } catch (err) {
      if (!this.current(session, engine)) return
      await this.closeFailed(
        session,
        reopening ? `Couldn't reopen ${name()} after the canvas restarted: ${describe(err)}` : `Couldn't open ${name()}: ${describe(err)}`,
      )
    } finally {
      if (this.loadingInto === engine) this.loadingInto = null
    }
  }

  /**
   * Put an outline's tiles into the layers the engine made for it, a batch at
   * a time, reading the next batch while one goes in: only two batches of
   * pixels are ever held, never the whole document. Returns how many tiles
   * couldn't be read (they stay transparent), or null when the session or
   * its engine went meanwhile.
   */
  private async streamTiles(
    session: DocumentSession,
    engine: DocumentEngine,
    outline: DocumentOutline,
    made: readonly string[],
  ): Promise<number | null> {
    const batches: { layerId: string; request: TileRequest }[] = []
    outline.layers.forEach((layer, i) => {
      // Past the layer limit, the engine made none.
      const layerId = made[i]
      if (layerId === undefined) return
      for (let start = 0; start < layer.tiles.length; start += this.loadBatchTiles) {
        const tiles = layer.tiles.slice(start, start + this.loadBatchTiles)
        batches.push({ layerId, request: { seq: outline.seq, backend: outline.backend, layerId: layer.info.id, tiles } })
      }
    })
    const total = batches.reduce((n, b) => n + b.request.tiles.length, 0)
    const read = (b: number) => {
      const reading = this.tiles.readTiles(session.projectId, batches[b].request)
      // Awaited below, unless loading stops first: then its failure doesn't matter.
      reading.catch(() => undefined)
      return reading
    }

    let unreadable = 0
    let done = 0
    let next = batches.length > 0 ? read(0) : null
    for (let b = 0; b < batches.length; b++) {
      const tiles = await next!
      next = b + 1 < batches.length ? read(b + 1) : null
      if (!this.current(session, engine)) return null
      const { layerId, request } = batches[b]
      const placed: PlacedTile[] = []
      request.tiles.forEach(({ x, y }, t) => {
        const data = tiles[t]
        if (data) placed.push({ x, y, data })
        else unreadable++
      })
      engine.placeTiles(layerId, placed)
      done += request.tiles.length
      this.store.getState().setOpenProgress(done / total)
    }
    return unreadable
  }

  /** A document that couldn't be loaded closes without saving, leaving the project as saved, and the Gallery says why. */
  private async closeFailed(session: DocumentSession, message: string) {
    session.discard()
    if (this.session === session) {
      this.session = null
      this.pending = null
    }
    this.store.getState().clearCurrentProject()
    await this.refresh().catch(() => undefined)
    this.toast(message, 'error')
  }

  /** Say so when part of a document couldn't be read: it opened with those tiles transparent. */
  private reportUnreadable(name: string, n: number) {
    if (n === 0) return
    const tiles = `${n} ${n === 1 ? 'tile' : 'tiles'} of ${TILE_SIZE} × ${TILE_SIZE} px`
    this.toast(`Part of ${q(name)} couldn't be read and shows as transparent (${tiles})`, 'error', {
      durationMs: 15000,
    })
  }

  private async createAndOpen(config: NewProjectConfig) {
    const { view, openStackId } = this.store.getState()
    const stackId = view === 'gallery' && openStackId ? openStackId : undefined
    const id = await this.db.createProject(config.name, config.width, config.height, config.dpi, {
      colorSpace: config.colorSpace,
      ...(stackId ? { stackId } : {}),
    })
    this.beginSession({ id, ...config }, null)
    await this.rememberLast(id)
    // The project is open: a Gallery list that couldn't be read again isn't worth failing for.
    await this.refresh().catch(() => undefined)
  }

  private beginSession(
    project: Pick<ProjectRecord, 'id' | 'name' | 'width' | 'height' | 'dpi' | 'colorSpace' | 'view' | 'guides' | 'activeLayerId'>,
    doc: LoadedDocument | null,
  ) {
    this.saveErrorShown = false
    this.loadingInto = null
    // Its guides, or fresh ones centred on it (plan M1.4), before the session: showing them isn't a change.
    this.showGuides(project.guides, project.width, project.height)
    const session = new DocumentSession(
      project.id,
      this.db,
      this.tiles,
      (status, error) => this.onSaveStatus(status, error),
      this.debounceMs,
    )
    // The guides as shown (checked, or fresh ones): a project left as it opened writes nothing when it closes.
    session.setSettingsSource(() => ({ guides: documentGuides(useGuideStore.getState()) }), {
      view: project.view,
      guides: documentGuides(useGuideStore.getState()),
      activeLayerId: project.activeLayerId,
    })
    this.session = session
    this.store.getState().openDocument({
      id: project.id,
      name: project.name,
      width: project.width,
      height: project.height,
      dpi: project.dpi,
      colorSpace: project.colorSpace ?? 'srgb',
      view: project.view ?? null,
      // Until it is in, the canvas can't be used: whatever was done on it would be lost.
      loadsSaved: doc !== null,
    })
    const sessionId = this.store.getState().sessionId
    this.pending = doc && sessionId ? { sessionId, doc } : null
  }

  /** Show a document's guides: the ones it saved, or none, centred on it. */
  private showGuides(saved: unknown, width: number, height: number) {
    this.showingGuides = true
    try {
      useGuideStore.getState().loadGuides(savedGuides(saved, width, height))
    } finally {
      this.showingGuides = false
    }
  }

  private openUnsaved(config: NewProjectConfig) {
    this.session = null
    this.pending = null
    this.loadingInto = null
    this.unsavedChanged = false
    this.showGuides(undefined, config.width, config.height)
    this.store.getState().openDocument({ id: null, ...config })
  }

  /** Save and end the open session. False, with the session still open, when saving failed. */
  private async closeCurrent(): Promise<boolean> {
    const session = this.session
    if (!session) return true
    if (!(await this.reported(() => session.close()))) {
      const name = q(this.store.getState().currentProjectName)
      if (isStorageFull(session.lastError)) this.storageFull(name, true)
      else this.toast(`Couldn't save ${name}, so it stays open: ${describe(session.lastError)}`, 'error')
      return false
    }
    this.session = null
    this.pending = null
    this.engine = null
    return true
  }

  private onSaveStatus(status: SaveStatus, error: unknown) {
    this.store.getState().setSaveStatus(status)
    if (status === 'saved') {
      this.saveErrorShown = false
      this.askToPersist()
    }
    if (status !== 'error') return
    if (!this.saveErrorShown && this.reporting === 0) {
      const name = q(this.store.getState().currentProjectName)
      if (isStorageFull(error)) this.storageFull(name)
      else this.toast(`Couldn't save ${name}: ${describe(error)}`, 'error')
    }
    this.saveErrorShown = true
  }

  /**
   * A saved project, ready to load: its record and the outline of its saved
   * document, whose tiles load into the canvas once it is up (plan M1.4).
   * Null when the project is gone.
   */
  private async loadDocument(id: string): Promise<LoadedDocument | null> {
    const project = await this.db.getProject(id)
    if (!project || project.deletedAt) return null
    const activeLayerId = project.activeLayerId ?? null
    // A project saved the old way can move to tiles, in another tab, between the two reads: then read again.
    for (let attempt = 0; attempt < 3; attempt++) {
      const outline = await this.tiles.outline(id)
      if (outline) {
        // The saved document's size wins over the record's, which a failed save may not have updated.
        const { width, height } = outline
        const layers = outline.layers.map(({ info }) => ({ info, pixels: null }))
        return { project: { ...project, width, height }, layers, activeLayerId, outline }
      }
      // Saved before the tile store, as whole layers: its next save moves it to tiles.
      const layers = await this.db.loadLegacyLayers(id, project.width, project.height)
      if (layers) return { project, layers, activeLayerId, outline: null }
    }
    throw new Error('another tab kept saving it while it opened')
  }

  /**
   * Saving stopped because the browser's storage is full: say how to keep
   * the work and make room. `staysOpen` for a project that couldn't close.
   */
  private storageFull(name: string, staysOpen = false) {
    const what = staysOpen ? `${name} can't be saved, so it stays open` : `${name} isn't being saved`
    this.toast(
      `The browser's storage is full: ${what}. Export it to keep a copy, and make room by deleting projects you don't need from the Gallery in another tab.`,
      'error',
      { durationMs: 20000, action: { label: 'Export…', run: () => useUIStore.getState().setShowExportDialog(true) } },
    )
  }

  /**
   * Ask the browser to keep this site's storage rather than clear it when
   * space runs low (Safari also clears it after 7 days without a visit), once
   * a save has worked: by then there is work worth keeping (plan M1.3).
   */
  private askToPersist() {
    if (this.persistAsked) return
    this.persistAsked = true
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
    if (!storage?.persist || !storage.persisted) return
    storage
      .persisted()
      .then((already) => already || storage.persist())
      .catch(() => false)
  }

  /**
   * Remove saved documents whose project record is gone: left by a delete,
   * import or duplicate that stopped halfway (plan M1.3). The documents are
   * listed before the records: a project gets its record before anything is
   * saved for it, so one made meanwhile is never taken for an orphan.
   */
  private async sweepOrphans() {
    const stored = await this.tiles.storedProjects()
    if (stored.length === 0) return
    const known = new Set((await this.db.getAllProjects()).map((p) => p.id))
    for (const id of stored) {
      if (known.has(id)) continue
      await this.tiles.delete(id).catch((err) => console.warn('[QUAR] A saved document without a project could not be removed:', err))
    }
  }

  /** Remove a project and its saved document. */
  private async removeProject(id: string) {
    await this.tiles.delete(id)
    await this.db.deleteProject(id)
  }

  private async rememberLast(id: string) {
    this.store.getState().setLastProjectId(id)
    await this.db.setSetting(SETTING_LAST_PROJECT, id).catch(() => undefined)
  }

  // ── Gallery ───────────────────────────────────────────────────────

  async renameProject(id: string, name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    await this.db.updateProject(id, { name: trimmed }, { touch: false })
    if (this.store.getState().currentProjectId === id) this.store.getState().setProjectName(trimmed)
    await this.refresh()
  }

  async duplicateProject(id: string): Promise<void> {
    const original = this.store.getState().projects.find((p) => p.id === id)
    if (!original) return
    try {
      const copyId = await this.db.duplicateProject(id, `${original.name} copy`)
      try {
        await this.tiles.copy(id, copyId)
      } catch (err) {
        // Leave no half-made copy in the Gallery.
        await this.removeProject(copyId).catch(() => undefined)
        throw err
      }
      await this.refresh()
      this.toast(`Duplicated ${q(original.name)}`, 'success')
    } catch (err) {
      this.toast(`Couldn't duplicate ${q(original.name)}: ${describe(err)}`, 'error')
    }
  }

  /**
   * Delete a project, with an Undo on the toast. The Gallery hides it at once;
   * the data goes when the toast does, or at the next start if the tab closes first.
   */
  async deleteProject(id: string): Promise<void> {
    const project = this.store.getState().projects.find((p) => p.id === id)
    if (!project) return
    await this.db.updateProject(id, { deletedAt: new Date() }, { touch: false })
    await this.refresh()
    this.toast(`Deleted ${q(project.name)}`, 'info', {
      durationMs: DELETE_UNDO_MS,
      action: { label: 'Undo', run: () => void this.restoreProject(id, project.name) },
      onClose: (reason) => {
        // If that fails, it stays deleted and the next start tries again.
        if (reason !== 'action') void this.purgeProject(id).catch((err) => warnPurge(err))
      },
    })
  }

  async restoreProject(id: string, name?: string): Promise<void> {
    const found = await this.db.updateProject(id, { deletedAt: undefined }, { touch: false })
    await this.refresh()
    // Another tab started after the Undo window: its start-up made the delete final.
    if (!found) this.toast(`${name ? q(name) : 'The project'} was already deleted for good`, 'error')
  }

  /** Make a delete final, unless it was undone. */
  async purgeProject(id: string): Promise<void> {
    const project = await this.db.getProject(id)
    if (!project?.deletedAt) return
    await this.removeProject(id)
    await this.removeStackIfEmpty(project.stackId)
    await this.refresh()
  }

  /**
   * Make deletes final that no tab can still undo. A recent one may still
   * have its Undo toast in another tab: it is purged when that window ends,
   * unless it was undone by then.
   */
  private async purgeDeleted() {
    const stacks = new Set<string>()
    const now = Date.now()
    for (const project of await this.db.getAllProjects()) {
      if (!project.deletedAt) continue
      const undoLeft = project.deletedAt.getTime() + DELETE_UNDO_MS + PURGE_GRACE_MS - now
      if (undoLeft > 0) {
        setTimeout(() => void this.purgeProject(project.id).catch((err) => warnPurge(err)), undoLeft)
        continue
      }
      // A delete that can't be finished now doesn't stop the app: the project
      // stays deleted, out of the Gallery, and the next start tries again.
      try {
        await this.removeProject(project.id)
        if (project.stackId) stacks.add(project.stackId)
      } catch (err) {
        warnPurge(err)
      }
    }
    for (const stackId of stacks) await this.removeStackIfEmpty(stackId).catch((err) => warnPurge(err))
  }

  async setSort(sort: GallerySort): Promise<void> {
    this.store.getState().setGallerySort(sort)
    await this.db.setSetting(SETTING_SORT, sort).catch(() => undefined)
  }

  openStack(stackId: string | null): void {
    this.store.getState().setOpenStack(stackId)
  }

  // ── Stacks ────────────────────────────────────────────────────────

  /** Put projects into a new stack. Stacks they leave empty go away. */
  async createStack(name: string, projectIds: readonly string[]): Promise<string> {
    const stackId = await this.db.createStack(name.trim() || 'Stack')
    const left = new Set<string>()
    for (const projectId of projectIds) {
      const project = await this.db.getProject(projectId)
      if (!project) continue
      if (project.stackId) left.add(project.stackId)
      await this.db.updateProject(projectId, { stackId }, { touch: false })
    }
    for (const id of left) await this.removeStackIfEmpty(id)
    await this.refresh()
    return stackId
  }

  /** Move a project into a stack, or out to the top level with null. */
  async moveToStack(projectId: string, stackId: string | null): Promise<void> {
    const project = await this.db.getProject(projectId)
    if (!project) return
    await this.db.updateProject(projectId, { stackId: stackId ?? undefined }, { touch: false })
    if (project.stackId && project.stackId !== stackId) await this.removeStackIfEmpty(project.stackId)
    await this.refresh()
  }

  async renameStack(id: string, name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    await this.db.updateStack(id, { name: trimmed })
    await this.refresh()
  }

  /** Dissolve a stack: its projects go back to the top level. */
  async unstack(id: string): Promise<void> {
    for (const project of await this.db.getAllProjects()) {
      if (project.stackId === id) await this.db.updateProject(project.id, { stackId: undefined }, { touch: false })
    }
    await this.db.deleteStack(id)
    if (this.store.getState().openStackId === id) this.store.getState().setOpenStack(null)
    await this.refresh()
  }

  private async removeStackIfEmpty(stackId: string | undefined) {
    if (!stackId) return
    const projects = await this.db.getAllProjects()
    if (projects.some((p) => p.stackId === stackId)) return
    await this.db.deleteStack(stackId)
    if (this.store.getState().openStackId === stackId) this.store.getState().setOpenStack(null)
  }

  // ── Import ────────────────────────────────────────────────────────

  /**
   * Add files to the Gallery as new projects, in the open stack: .qart files
   * and images. Each file succeeds or fails on its own.
   */
  async importFiles(files: readonly File[]): Promise<void> {
    const imported: string[] = []
    for (const file of files) {
      const kind = importKind(file)
      if (kind === 'psd') {
        this.toast(`${q(file.name)}: PSD files can't be opened yet`, 'error')
        continue
      }
      if (kind === 'other') {
        this.toast(`${q(file.name)} isn't a .qart file or an image`, 'error')
        continue
      }
      try {
        if (kind === 'qart') await this.importQart(file)
        else await this.importImage(file)
        imported.push(baseName(file.name))
      } catch (err) {
        this.toast(`Couldn't import ${q(file.name)}: ${describe(err)}`, 'error')
      }
    }
    if (imported.length === 0) return
    await this.refresh()
    this.toast(imported.length === 1 ? `Imported ${q(imported[0])}` : `Imported ${imported.length} files`, 'success')
  }

  private async importImage(file: File) {
    const { pixels, width, height } = await decodeImageBlob(file)
    const problem = canvasSizeProblem(width, height)
    if (problem) throw new Error(`it is ${width} × ${height} px. ${problem}`)
    const name = baseName(file.name)
    const info = newLayerInfo(name)
    const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)
    await this.addProject({ name, width, height, dpi: 72, colorSpace: 'srgb' }, [{ info, pixels: bytes }], info.id)
  }

  private async importQart(file: File) {
    const { manifest, layers } = await readQart(file)
    const { width, height, dpi } = manifest.canvas
    const problem = canvasSizeProblem(width, height)
    if (problem) throw new Error(problem)

    // Fresh ids: the same file imported twice makes two independent projects.
    const ids = new Map<string, string>()
    const stored: SaveLayer[] = [...layers]
      .sort((a, b) => a.manifest.order - b.manifest.order)
      .slice(0, MAX_LAYERS)
      .map(({ manifest: layer, pixels }) => {
        if (pixels.length !== width * height * 4) throw new Error(`layer ${q(layer.name)} has the wrong size`)
        const info = savedLayerInfo({
          ...newLayerInfo(String(layer.name)),
          blendMode: layer.blendMode as BlendMode,
          opacity: layer.opacity,
          visible: layer.visible,
          locked: layer.locked,
          alphaLock: layer.alphaLock,
          clippingMask: layer.clippingMask,
        })
        if (!ids.has(layer.id)) ids.set(layer.id, info.id)
        return { info, pixels }
      })
    if (stored.length === 0) throw new Error('it has no layers')

    const active = ids.get(manifest.activeLayerId) ?? stored[stored.length - 1].info.id
    const config = { name: baseName(file.name), width, height, dpi: dpi > 0 ? dpi : 72, colorSpace: 'srgb' as const }
    await this.addProject(config, stored, active)
  }

  /** Create a project record with these layers and a thumbnail, in the open stack. */
  private async addProject(config: NewProjectConfig, layers: SaveLayer[], activeLayerId: string) {
    const stackId = this.store.getState().openStackId ?? undefined
    // Before saving: the save hands the pixels over to the persistence worker.
    const thumbnail = await encodeLayersThumbnail(
      layers.flatMap(({ info, pixels }) =>
        pixels ? [{ pixels, opacity: info.opacity, visible: info.visible, blendMode: info.blendMode }] : [],
      ),
      config.width,
      config.height,
    ).catch(() => null)
    const id = await this.db.createProject(config.name, config.width, config.height, config.dpi, {
      colorSpace: config.colorSpace,
      ...(stackId ? { stackId } : {}),
    })
    try {
      await this.tiles.save(id, { width: config.width, height: config.height, layers })
      await this.db.updateProject(id, { activeLayerId, ...(thumbnail ? { thumbnail } : {}) })
    } catch (err) {
      // Leave no half-imported project in the Gallery.
      await this.removeProject(id).catch(() => undefined)
      throw err
    }
    return id
  }
}

/** The app's project service. */
export const projectService = new ProjectService()
