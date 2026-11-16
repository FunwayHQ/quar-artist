import { useProjectStore } from '../../stores/projectStore.ts'
import { useUIStore, type ToastOptions } from '../../stores/uiStore.ts'
import { MetadataDB } from './MetadataDB.ts'
import { DocumentSession, type DocumentEngine } from './DocumentSession.ts'
import type { DocumentStore, SaveLayer } from '../tiles/TileStore.ts'
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

/** An error as toasts show it. DOMExceptions aren't Errors everywhere, so any message will do. */
function describe(err: unknown): string {
  const { name, message } = (typeof err === 'object' && err !== null ? err : {}) as { name?: unknown; message?: unknown }
  if (name === 'QuotaExceededError') return "the browser's storage is full"
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

/** A saved document: the project record, at the document's size, and its layers, bottom first. */
interface LoadedDocument {
  project: ProjectRecord
  layers: StoredLayer[]
  activeLayerId: string | null
  /** Tiles that couldn't be read, which show as transparent. */
  unreadableTiles: number
}

/** A document waiting for its engine. */
interface PendingDocument {
  sessionId: string
  layers: StoredLayer[]
  activeLayerId: string | null
}

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

  constructor(db = new MetadataDB(), options: { debounceMs?: number; store?: DocumentStore } = {}) {
    this.db = db
    this.tiles = options.store ?? createDocumentStore()
    this.debounceMs = options.debounceMs
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
        this.beginSession(doc.project, doc)
        this.reportUnreadable(doc)
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
    if (this.store.getState().view !== 'canvas') return true
    const session = this.session
    const name = q(this.store.getState().currentProjectName)
    if (!session) {
      this.toast(`${name} can't be saved in this browser`, 'error')
      return false
    }
    const ok = await this.reported(() => session.saveNow())
    if (ok) this.toast(`Saved ${name}`, 'success')
    else this.toast(`Couldn't save ${name}: ${describe(session.lastError)}`, 'error')
    return ok
  }

  /** Whether the open project has changes not saved yet. */
  get hasUnsavedChanges(): boolean {
    return this.session?.hasUnsavedChanges ?? (this.unsaved && this.unsavedChanged)
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
      engine.loadDocument(pending.layers, pending.activeLayerId)
      this.pending = null
      session.attach(engine)
    } else if (session.isNewEngine(engine)) {
      // The canvas restarted with a new, empty engine. What the old one had
      // since the last save went with it: bring the last save back first.
      session.forgetUnsaved()
      void this.run(() => this.reloadInto(session, engine))
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

  /**
   * Load the last save into a restarted canvas's engine, then save from it.
   * If that fails, the project is left as saved: saving the empty engine would wipe it.
   */
  private async reloadInto(session: DocumentSession, engine: DocumentEngine) {
    if (this.session !== session || this.engine !== engine) return
    const name = q(this.store.getState().currentProjectName)
    let doc: LoadedDocument | null = null
    let failure: unknown = null
    try {
      doc = await this.loadDocument(session.projectId)
    } catch (err) {
      failure = err
    }
    if (this.session !== session || this.engine !== engine) return

    if (!doc) {
      session.discard()
      this.session = null
      this.pending = null
      this.store.getState().clearCurrentProject()
      await this.refresh().catch(() => undefined)
      this.toast(
        failure ? `Couldn't reopen ${name} after the canvas restarted: ${describe(failure)}` : `${name} no longer exists`,
        'error',
      )
      return
    }

    const size = engine.getDocumentSize()
    if (size.width !== doc.project.width || size.height !== doc.project.height) {
      // The canvas restarted at a size the project wasn't saved at (a Canvas
      // Size not saved yet): open it again at its saved size.
      session.discard()
      this.beginSession(doc.project, doc)
      this.reportUnreadable(doc)
      return
    }
    engine.loadDocument(doc.layers, doc.activeLayerId)
    session.attach(engine)
    this.reportUnreadable(doc)
  }

  /** Say so when part of a document couldn't be read: it opened with those tiles transparent. */
  private reportUnreadable({ project, unreadableTiles: n }: LoadedDocument) {
    if (n === 0) return
    const tiles = `${n} ${n === 1 ? 'tile' : 'tiles'} of ${TILE_SIZE} × ${TILE_SIZE} px`
    this.toast(`Part of ${q(project.name)} couldn't be read and shows as transparent (${tiles})`, 'error', {
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
    project: Pick<ProjectRecord, 'id' | 'name' | 'width' | 'height' | 'dpi' | 'colorSpace'>,
    doc: Omit<PendingDocument, 'sessionId'> | null,
  ) {
    this.saveErrorShown = false
    this.session = new DocumentSession(
      project.id,
      this.db,
      this.tiles,
      (status, error) => this.onSaveStatus(status, error),
      this.debounceMs,
    )
    this.store.getState().openDocument({
      id: project.id,
      name: project.name,
      width: project.width,
      height: project.height,
      dpi: project.dpi,
      colorSpace: project.colorSpace ?? 'srgb',
    })
    const sessionId = this.store.getState().sessionId
    this.pending = doc && sessionId ? { sessionId, ...doc } : null
  }

  private openUnsaved(config: NewProjectConfig) {
    this.session = null
    this.pending = null
    this.unsavedChanged = false
    this.store.getState().openDocument({ id: null, ...config })
  }

  /** Save and end the open session. False, with the session still open, when saving failed. */
  private async closeCurrent(): Promise<boolean> {
    const session = this.session
    if (!session) return true
    if (!(await this.reported(() => session.close()))) {
      const name = q(this.store.getState().currentProjectName)
      this.toast(`Couldn't save ${name}, so it stays open: ${describe(session.lastError)}`, 'error')
      return false
    }
    this.session = null
    this.pending = null
    this.engine = null
    return true
  }

  private onSaveStatus(status: SaveStatus, error: unknown) {
    this.store.getState().setSaveStatus(status)
    if (status === 'saved') this.saveErrorShown = false
    if (status !== 'error') return
    if (!this.saveErrorShown && this.reporting === 0) {
      this.toast(`Couldn't save ${q(this.store.getState().currentProjectName)}: ${describe(error)}`, 'error')
    }
    this.saveErrorShown = true
  }

  private async loadDocument(id: string): Promise<LoadedDocument | null> {
    const project = await this.db.getProject(id)
    if (!project || project.deletedAt) return null
    const activeLayerId = project.activeLayerId ?? null
    // A project saved the old way can move to tiles, in another tab, between the two reads: then read again.
    for (let attempt = 0; attempt < 3; attempt++) {
      const saved = await this.tiles.load(id)
      if (saved) {
        // The saved document's size wins over the record's, which a failed save may not have updated.
        const { width, height, layers, unreadableTiles } = saved
        return { project: { ...project, width, height }, layers, activeLayerId, unreadableTiles }
      }
      // Saved before the tile store, as whole layers: its next save moves it to tiles.
      const layers = await this.db.loadLegacyLayers(id, project.width, project.height)
      if (layers) return { project, layers, activeLayerId, unreadableTiles: 0 }
    }
    throw new Error('another tab kept saving it while it opened')
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
