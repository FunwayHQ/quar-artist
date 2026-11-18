import { useProjectStore } from '../../stores/projectStore.ts'
import { useUIStore, type ToastOptions } from '../../stores/uiStore.ts'
import { documentGuides, savedGuides, useGuideStore } from '../../stores/guideStore.ts'
import { MetadataDB } from './MetadataDB.ts'
import { DocumentSession, type DocumentEngine, type PlacedTile, type SavedBase } from './DocumentSession.ts'
import { isStaleLoad, type DocumentOutline, type DocumentStore, type TileRequest } from '../tiles/TileStore.ts'
import { createDocumentStore } from '../tiles/WorkerDocumentStore.ts'
import { TILE_SIZE, savedLayerInfo } from '../tiles/tileFormat.ts'
import type { SaveStatus } from './AutoSave.ts'
import { encodeLayersThumbnail } from './thumbnail.ts'
import { appFileLimits, openPsd, openQart, writePsd, writeQart } from '../formats/fileCodec.ts'
import type { QartWriterInput } from '../formats/qart/QartWriter.ts'
import type { PsdNotes } from '../formats/psd/PsdReader.ts'
import type { PsdWriterInput } from '../formats/psd/PsdWriter.ts'
import {
  PSD_EXTENSION,
  QART_EXTENSION,
  canPickSaveFile,
  describeFileError,
  downloadFile,
  fileNameFor,
  isFileGone,
  lastModified,
  mayWrite,
  pickOpenFile,
  pickSaveFile,
  sameFile,
  writeFile,
  type FileHandle,
  type PickedFile,
} from '../files/fileAccess.ts'
import { decodeImageBlob } from '../importImage.ts'
import { canvasSizeProblem } from '../../utils/deviceLimits.ts'
import { createId } from '../../utils/id.ts'
import { setDatabaseEventListener, type DatabaseEvent, type ProjectRecord } from '../../db/schema.ts'
import type { GallerySort, NewProjectConfig, StoredImage } from '../../types/project.ts'
import type { LayerInfo, StoredLayer } from '../../types/layer.ts'

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

/** What kind of file the Gallery was given to import. PSB files are large PSD files. */
export function importKind(file: Pick<File, 'name' | 'type'>): 'qart' | 'psd' | 'image' | 'other' {
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'qart') return 'qart'
  if (ext === 'psd' || ext === 'psb' || file.type === 'image/vnd.adobe.photoshop') return 'psd'
  if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'].includes(ext)) {
    return 'image'
  }
  return 'other'
}

/** Why a file can't be opened or imported, or null when it can. */
function refusal(file: Pick<File, 'name' | 'type'>): string | null {
  if (importKind(file) === 'other') return `${q(file.name)} isn't a .qart or PSD file, or an image`
  return null
}

/**
 * Files dropped on the canvas, by what becomes of them (plans M1.5, M1.7):
 * images are added as layers, the first .qart or PSD file opens as a
 * project, and the rest are refused, each with the reason.
 */
export function sortDroppedFiles(files: readonly File[]): { images: File[]; project: File | null; refused: string[] } {
  const images: File[] = []
  let project: File | null = null
  const refused: string[] = []
  for (const file of files) {
    const kind = importKind(file)
    if (kind === 'image') images.push(file)
    else if ((kind === 'qart' || kind === 'psd') && !project) project = file
    else refused.push(refusal(file) ?? `${q(file.name)} wasn't opened: one project opens at a time`)
  }
  return { images, project, refused }
}

/** A file name without its extension, as a project name. */
export function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim() || 'Untitled'
}

/** `n` things, as toasts say it: "1 group", "3 groups". */
function count(n: number, thing: string): string {
  return `${n} ${thing}${n === 1 ? '' : 's'}`
}

/** Words as a list: "a", "a and b", "a, b and c". */
function listed(words: readonly string[]): string {
  return words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

/**
 * What a PSD file had that didn't come with it, as the toast after opening
 * it says (plan M1.7), or null when it had nothing of the kind.
 */
export function psdNotice(fileName: string, notes: PsdNotes): string | null {
  const parts: string[] = []
  if (notes.groups > 0) parts.push(`its ${notes.groups === 1 ? 'group' : count(notes.groups, 'group')} became plain layers`)
  // Each with whether it is one thing: "1 adjustment layer was left out", "the layer effects of 1 layer were".
  const left: [text: string, one: boolean][] = []
  if (notes.adjustments > 0) left.push([count(notes.adjustments, 'adjustment layer'), notes.adjustments === 1])
  if (notes.groupMasks > 0) left.push([count(notes.groupMasks, 'group mask'), notes.groupMasks === 1])
  if (notes.effects > 0) left.push([`the layer effects of ${count(notes.effects, 'layer')}`, false])
  if (notes.vectorMasks > 0) left.push([`the vector masks of ${count(notes.vectorMasks, 'layer')}`, false])
  if (left.length > 0) parts.push(`${listed(left.map(([text]) => text))} ${left.length === 1 && left[0][1] ? 'was' : 'were'} left out`)
  if (notes.blendModes.length > 0) {
    const modes = notes.blendModes.map((m) => m.replace(/\b\w/g, (c) => c.toUpperCase()))
    parts.push(`its ${listed(modes)} layers became Normal`)
  }
  if (parts.length === 0) return null
  return `Some of ${q(fileName)} isn't in QUAR Artist yet: ${parts.join('; ')}`
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

/** A document read from a .qart file or an image, to import or open (plan M1.5). */
interface FileDocument {
  config: NewProjectConfig
  /** Bottom first, at the document's size. */
  layers: StoredLayer[]
  activeLayerId: string
  /** The guides the file has, for `savedGuides` to check. */
  guides?: unknown
  /** Tiles of 256 × 256 px the file has but that couldn't be read: they are transparent. */
  unreadableTiles?: number
  /** The Gallery's thumbnail, drawn where the file was read; made from the layers when there is none. */
  thumbnail?: StoredImage | null
  /** What the file had that didn't come with it, as a toast says it once it opens (PSD files). */
  notice?: string | null
}

/** A document opened from a file without storage, waiting for the canvas made for it. */
interface UnsavedDocument {
  sessionId: string
  layers: StoredLayer[]
  activeLayerId: string
}

/** A document waiting for its engine. */
interface PendingDocument {
  sessionId: string
  doc: LoadedDocument
}

/**
 * The file the open document writes to with Ctrl+S (plan M1.5): the one it
 * was saved as or opened from, where the browser lets it be written again.
 */
interface FileLink {
  handle: FileHandle
  /** The project the file belongs to; null for the canvas that can't be saved in the browser. */
  projectId: string | null
  /**
   * The file's last-modified time as the document last wrote it, or as it
   * was when the document was made from it or opened. Null when that isn't
   * known: the file may have work the document doesn't, and Ctrl+S leaves it.
   */
  modified: number | null
  /** Whether the project's record has the link, so another tab or project taking the file shows there. */
  kept: boolean
}

/** One write of the open document to a file, with its pixels as read from the canvas at a key press. */
interface FileJob {
  handle: FileHandle
  /** The link Ctrl+S writes through, checked before writing; null for a file just picked to save to. */
  link: FileLink | null
  /** Let go of once written, or once a later Ctrl+S's pixels take their place. */
  input: QartWriterInput | null
  allowed: Promise<boolean>
  sessionId: string | null
  /** Without storage: how many changes the canvas had, and how many times it had restarted. */
  edits: number
  epoch: number
}

/** A write waiting for the one running. A later Ctrl+S's pixels take the place of an earlier one's. */
interface QueuedWrite {
  job: FileJob
  waiting: { job: FileJob; resolve: (written: FileWritten) => void; reject: (err: unknown) => void }[]
}

/** A write that worked: the file's last-modified time after it, and whether the file has the caller's pixels or a later Ctrl+S's. */
interface FileWritten {
  modified: number | null
  own: boolean
}

/** Why Ctrl+S left a file as it was: it may have work the document doesn't, or another project has it now. */
class FileConflict extends Error {
  readonly reason: 'changed' | 'taken'

  constructor(reason: 'changed' | 'taken') {
    super(reason === 'changed' ? 'the file changed since it was last saved to' : 'the file belongs to another project')
    this.name = 'FileConflict'
    this.reason = reason
  }
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
  /** Changes made to the canvas that can't be saved in the browser, and how many of them its file has. */
  private unsavedEdits = 0
  private unsavedEditsWritten = 0
  /** A document opened from a file without storage, until its canvas is up. */
  private unsavedDoc: UnsavedDocument | null = null
  /** The engine showing the canvas that can't be saved, and the document (its session) it shows. */
  private unsavedShownBy: { engine: DocumentEngine; sessionId: string | null } | null = null
  /**
   * The file the open document was saved as or opened from, where the
   * browser lets it be written again (Chromium): Ctrl+S writes it too (plan M1.5).
   */
  private link: FileLink | null = null
  /** Writes to files, one at a time, in order. */
  private fileWrites: Promise<unknown> = Promise.resolve()
  /** The write waiting for the one running, if there is one. */
  private queuedWrite: QueuedWrite | null = null
  /** How many times the canvas that can't be saved restarted: a write of what it had before says nothing about what it has now. */
  private unsavedEpoch = 0
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

  /** The canvas that can't be saved has changes its file doesn't have, which replacing it would lose. */
  private get unsavedChanged(): boolean {
    return this.unsavedEdits !== this.unsavedEditsWritten
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

  /**
   * Save the open project now (Ctrl+S) and say how it went. A project saved
   * as a file, or opened from one, is written to it too (plan M1.5). Call it
   * while handling the user's key press or click: the browser asks then
   * whether the file may be written, if it has to.
   */
  async saveNow(): Promise<boolean> {
    const state = this.store.getState()
    // Nothing can have changed in a document still opening.
    if (state.view !== 'canvas' || state.openProgress !== null) return true
    const session = this.session
    const link = this.link
    const name = q(state.currentProjectName)
    if (!session && !link) {
      this.toast(`${name} can't be saved in this browser. Save it as a .qart file to keep it.`, 'error', {
        durationMs: 10000,
        action: this.saveAsAction(),
      })
      return false
    }
    // The file gets the document as it is at the key press, whatever happens meanwhile.
    const written = link ? this.writeOpenDocument(link.handle, mayWrite(link.handle), link) : null
    written?.catch(() => undefined)
    let saved = true
    if (session) {
      saved = await this.reported(() => session.saveNow())
      if (!saved) this.saveFailed(session, name)
    }
    if (!link || !written) {
      if (saved) this.toast(`Saved ${name}`, 'success')
      return saved
    }
    const fileName = q(link.handle.name)
    let result: FileWritten
    try {
      result = await written
    } catch (err) {
      const reason = this.fileFailed(link, err, name)
      this.toast(
        session && saved
          ? `Saved ${name} in the browser, but not to ${fileName}: ${reason}`
          : `Couldn't save ${name} to ${fileName}: ${reason}`,
        'error',
        { durationMs: 10000, action: this.saveAsAction() },
      )
      return false
    }
    // The browser's copy has what the file has: when the project opens again, Ctrl+S may write the file.
    if (session && saved && result.own) await this.confirmLink(link, result.modified)
    this.toast(`Saved ${name} to ${fileName}`, 'success')
    return saved
  }

  /** Say why a save of the open project failed. */
  private saveFailed(session: DocumentSession, name: string) {
    if (isStorageFull(session.lastError)) this.storageFull(name)
    else this.toast(`Couldn't save ${name}: ${describe(session.lastError)}`, 'error')
  }

  /**
   * File › Save as .qart… (plan M1.5). Where the browser can, the user picks
   * a file, which Ctrl+S writes again from then on; elsewhere the file is a
   * download. Call it while handling the user's key press or click: the
   * browser shows the picker only then.
   */
  async saveAsFile(): Promise<boolean> {
    const state = this.store.getState()
    if (state.view !== 'canvas' || state.openProgress !== null) return false
    const name = q(state.currentProjectName)
    const fileName = fileNameFor(state.currentProjectName, QART_EXTENSION)
    if (!canPickSaveFile()) {
      try {
        downloadFile(await writeQart(this.qartInput()), fileName)
      } catch (err) {
        this.toast(`Couldn't save ${name} as a .qart file: ${describe(err)}`, 'error')
        return false
      }
      this.toast(`Downloaded ${q(fileName)}`, 'success')
      return true
    }
    let handle: FileHandle | null
    try {
      handle = await pickSaveFile(fileName)
    } catch (err) {
      this.toast(`Couldn't save ${name} as a .qart file: ${describe(err)}`, 'error')
      return false
    }
    // Cancelled, or another document opened while the picker was up.
    if (!handle || this.store.getState().sessionId !== state.sessionId) return false
    const session = this.session
    // A file just picked to save to can be written. What the browser's copy
    // doesn't have yet is saved too: once it has what the file has, the
    // project can write the file again when it next opens.
    const written = this.writeOpenDocument(handle, Promise.resolve(true), null)
    written.catch(() => undefined)
    const browserSaved = session ? this.reported(() => session.flush()).catch(() => false) : Promise.resolve(false)
    let result: FileWritten
    try {
      result = await written
    } catch (err) {
      this.toast(`Couldn't save ${name} to ${q(handle.name)}: ${describeFileError(err)}`, 'error')
      return false
    }
    // Ctrl+S writes it from now on, and so does the project when it opens again, even if it closed meanwhile.
    const link: FileLink = { handle, projectId: session?.projectId ?? null, modified: result.modified, kept: false }
    if (link.projectId) {
      const confirmed = result.own && result.modified !== null && (await browserSaved)
      link.kept = await this.rememberFile(link.projectId, handle, confirmed ? (result.modified ?? undefined) : undefined)
    }
    if (this.store.getState().sessionId === state.sessionId) this.link = link
    this.toast(`Saved ${name} to ${q(handle.name)}`, 'success')
    return true
  }

  /**
   * Export › PSD (plan M1.7): every layer, with its blend mode, opacity,
   * visibility, clipping and locks, the resolution, and the composite image
   * other apps show, written off the main thread and downloaded.
   */
  async exportPsd(): Promise<boolean> {
    const state = this.store.getState()
    if (state.view !== 'canvas' || state.openProgress !== null) return false
    const fileName = fileNameFor(state.currentProjectName, PSD_EXTENSION)
    try {
      downloadFile(await writePsd(this.psdInput()), fileName)
    } catch (err) {
      this.toast(`Couldn't export ${q(state.currentProjectName)} as a PSD file: ${describe(err)}`, 'error')
      return false
    }
    this.toast(`Exported ${q(fileName)}`, 'success')
    return true
  }

  /** The open document as a PSD file has it, read from its canvas now: the layers, and what they make together. */
  private psdInput(): PsdWriterInput {
    // The layers would be written without the preview, and the composite with it.
    if (this.engine?.isPreviewing()) throw new Error("a transform or filter isn't applied yet. Apply or cancel it, then export again")
    const { width, height, dpi, layers, activeLayerId } = this.qartInput()
    const composite = this.engine?.getCompositePixels() ?? null
    if (!composite || composite.width !== width || composite.height !== height) {
      throw new Error("the canvas can't be read right now. Try again in a moment")
    }
    const { pixels } = composite
    return { width, height, dpi, layers, activeLayerId, composite: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength) }
  }

  /** Toasts' way to keep a copy of the open project: save it as a .qart file. */
  private saveAsAction(): ToastOptions['action'] {
    return { label: 'Save as .qart…', run: () => void this.saveAsFile() }
  }

  /**
   * Write the open document to a file as a .qart: read from the canvas now,
   * then written once `allowed` says it may be and the writes before are
   * done. Through `link` (Ctrl+S), only while the file is still the
   * project's and as the document last wrote it (`checkLink`). A Ctrl+S
   * that comes while an earlier one's write waits takes its place, so one
   * copy of the document waits however often the key is pressed. Rejects
   * with what went wrong. Without storage, a canvas whose file has its
   * changes can be replaced without asking.
   */
  private writeOpenDocument(handle: FileHandle, allowed: Promise<boolean>, link: FileLink | null): Promise<FileWritten> {
    // Awaited in the write: a refusal is its failure.
    allowed.catch(() => undefined)
    let input: QartWriterInput
    try {
      input = this.qartInput()
    } catch (err) {
      return Promise.reject(err)
    }
    const job: FileJob = {
      handle,
      link,
      input,
      allowed,
      sessionId: this.store.getState().sessionId,
      edits: this.unsavedEdits,
      epoch: this.unsavedEpoch,
    }
    return new Promise((resolve, reject) => {
      const queued = this.queuedWrite
      if (queued && queued.job.handle === handle && queued.job.link === link && queued.job.sessionId === job.sessionId) {
        // Its pixels are older: let them go, and write these in their place.
        queued.job.input = null
        queued.job = job
        queued.waiting.push({ job, resolve, reject })
        return
      }
      const entry: QueuedWrite = { job, waiting: [{ job, resolve, reject }] }
      this.queuedWrite = entry
      this.fileWrites = this.fileWrites.then(async () => {
        // Running: a Ctrl+S from now on waits for it.
        if (this.queuedWrite === entry) this.queuedWrite = null
        try {
          const modified = await this.runWrite(entry.job)
          for (const w of entry.waiting) w.resolve({ modified, own: w.job === entry.job })
        } catch (err) {
          for (const w of entry.waiting) w.reject(err)
        }
      })
    })
  }

  /** Write a job's pixels to its file. Returns the file's last-modified time after it, or null when that can't be read. */
  private async runWrite(job: FileJob): Promise<number | null> {
    const input = job.input
    if (!input) throw new Error("the canvas couldn't be read")
    if (!(await job.allowed)) throw new DOMException('Writing to the file was not allowed', 'NotAllowedError')
    if (job.link) await this.checkLink(job.link)
    await writeFile(job.handle, await writeQart(input))
    job.input = null
    const modified = await lastModified(job.handle).catch(() => null)
    if (job.link) job.link.modified = modified
    if (!this.session && this.store.getState().sessionId === job.sessionId && this.unsavedEpoch === job.epoch) {
      this.unsavedEditsWritten = Math.max(this.unsavedEditsWritten, job.edits)
    }
    return modified
  }

  /**
   * Before Ctrl+S writes a file: it must still be the project's, and as the
   * document last wrote it. Otherwise it may have work the document doesn't:
   * another tab or program wrote it, or Ctrl+S wrote it while the browser's
   * storage was full and the project then opened from the older copy there.
   */
  private async checkLink(link: FileLink) {
    if (link.projectId && link.kept) {
      // Storage that can't be read doesn't keep the file from being written: it may be all there is.
      const record = await this.db.getProject(link.projectId).catch(() => null)
      if (record !== null && !(record?.fileHandle && (await sameFile(record.fileHandle, link.handle)))) {
        throw new FileConflict('taken')
      }
    }
    if (link.modified === null || (await lastModified(link.handle)) !== link.modified) throw new FileConflict('changed')
  }

  /** Why a write through the open document's link failed, as its toast says. A file gone, or that may have other work, is let go. */
  private fileFailed(link: FileLink, err: unknown, name: string): string {
    if (err instanceof FileConflict) {
      // Nor do the writes still waiting go through.
      link.modified = null
      this.dropLink(link)
      return err.reason === 'changed'
        ? `it may have changed since ${name} was last saved to it. Open it with File › Open… to keep what it has, or Save as .qart… to replace it`
        : 'it belongs to another project now. Save as .qart… to write to it anyway'
    }
    if (isFileGone(err)) this.dropLink(link)
    return describeFileError(err)
  }

  /** The open document as a .qart file has it, read from its canvas now. */
  private qartInput(): QartWriterInput {
    const engine = this.engine
    if (!engine || this.loadingInto === engine) throw new Error("the canvas isn't ready yet")
    const { width, height } = engine.getDocumentSize()
    const { currentProjectName: name, dpi, colorSpace } = this.store.getState()
    const layers = engine.getLayerInfos().map((raw) => {
      const pixels = engine.getLayerPixels(raw.id)
      if (!pixels) throw new Error(`the layer ${q(raw.name)} can't be read right now. Try again in a moment`)
      return { info: savedLayerInfo(raw), pixels }
    })
    const guides = documentGuides(useGuideStore.getState())
    return { name, width, height, dpi, colorSpace, layers, activeLayerId: engine.getActiveLayerId(), guides }
  }

  /**
   * Keep a project's file with it, with `modified` when the project's
   * browser copy has what the file has (`ProjectRecord.fileModified`). One
   * project per file: another that had it lets it go. Returns whether it was kept.
   */
  private async rememberFile(projectId: string, handle: FileHandle, modified: number | undefined): Promise<boolean> {
    try {
      for (const project of await this.db.getAllProjects()) {
        if (project.id === projectId || !project.fileHandle) continue
        if (await sameFile(project.fileHandle, handle)) {
          await this.db.updateProject(project.id, { fileHandle: undefined, fileModified: undefined }, { touch: false })
        }
      }
      return await this.db.updateProject(projectId, { fileHandle: handle, fileModified: modified }, { touch: false })
    } catch (err) {
      // Ctrl+S still writes it while the project is open.
      console.warn('[QUAR] The file a project was saved to could not be kept with it:', err)
      return false
    }
  }

  /**
   * The project's browser copy has what its file has, as last written: when
   * the project opens again, Ctrl+S may write the file while it still has
   * this last-modified time.
   */
  private async confirmLink(link: FileLink, modified: number | null) {
    const { projectId, handle } = link
    // A write since has its own say.
    if (!projectId || !link.kept || modified === null || link.modified !== modified) return
    try {
      const record = await this.db.getProject(projectId)
      if (record?.fileHandle && (await sameFile(record.fileHandle, handle))) {
        await this.db.updateProject(projectId, { fileModified: modified }, { touch: false })
      }
    } catch (err) {
      console.warn('[QUAR] A project could not note that its file has its work:', err)
    }
  }

  /** Ctrl+S no longer writes the link's file, and its project lets it go, unless it has another file by now. */
  private dropLink(link: FileLink) {
    if (this.link === link) this.link = null
    const { projectId, handle } = link
    if (!projectId || !link.kept) return
    link.kept = false
    void (async () => {
      const record = await this.db.getProject(projectId)
      if (record?.fileHandle && (await sameFile(record.fileHandle, handle))) {
        await this.db.updateProject(projectId, { fileHandle: undefined, fileModified: undefined }, { touch: false })
      }
    })().catch((err) => console.warn('[QUAR] A project could not let go of its file:', err))
  }

  /**
   * File › Open… (plan M1.5): a .qart file or an image, opened as a new
   * project once the open one is saved and closed. Call it while handling
   * the user's key press or click: the browser shows the picker only then.
   */
  async openFile(): Promise<boolean> {
    if (this.store.getState().openProgress !== null) return false
    let picked: PickedFile | null
    try {
      picked = await pickOpenFile()
    } catch (err) {
      this.toast(`Couldn't open a file: ${describe(err)}`, 'error')
      return false
    }
    return picked ? this.openFromFile(picked.file, picked.handle) : false
  }

  /**
   * Open a file as a new project, after saving and closing the open one: a
   * .qart file, which Ctrl+S then writes to when it came with its handle, or
   * an image. Without storage, it takes the canvas's place.
   */
  async openFromFile(file: File, handle: FileHandle | null = null): Promise<boolean> {
    const refused = refusal(file)
    if (refused) {
      this.toast(refused, 'error')
      return false
    }
    // Ctrl+S writes .qart files only: the project of a PSD file or an image saves in the browser.
    const linked = importKind(file) === 'qart' ? handle : null
    let doc: FileDocument
    let id: string
    try {
      doc = await this.fileDocument(file)
      if (this.unsaved) return this.openUnsavedFile(file, doc, linked)
      id = await this.addProject(doc)
    } catch (err) {
      this.toast(`Couldn't open ${q(file.name)}: ${describe(err)}`, 'error')
      return false
    }
    const unreadable = doc.unreadableTiles ?? 0
    // The project is made from the file as it is: Ctrl+S may write it while it stays so. Not over tiles it couldn't read.
    if (linked && unreadable === 0) await this.rememberFile(id, linked, file.lastModified)
    // In the Gallery even if the open project can't close for it.
    await this.refresh().catch(() => undefined)
    const opened = await this.openProject(id)
    this.reportUnreadableFile(file, unreadable, linked !== null)
    this.reportNotice(doc)
    return opened
  }

  /** Say what a file had that didn't come with it, once its project is made. */
  private reportNotice(doc: FileDocument) {
    if (doc.notice) this.toast(doc.notice, 'info', { durationMs: 15000 })
  }

  /** Say so when part of a file couldn't be read: its document opened with those tiles transparent. */
  private reportUnreadableFile(file: File, n: number, linked: boolean) {
    if (n === 0) return
    const tiles = `${n} ${n === 1 ? 'tile' : 'tiles'} of ${TILE_SIZE} × ${TILE_SIZE} px`
    const writes = linked ? '. Ctrl+S won\'t write to the file, which may still have it' : ''
    this.toast(`Part of ${q(file.name)} couldn't be read and shows as transparent (${tiles})${writes}`, 'error', {
      durationMs: 15000,
    })
  }

  /** Without storage, a file opens in the canvas's place: asking first, when that loses changes. */
  private openUnsavedFile(file: File, doc: FileDocument, handle: FileHandle | null): boolean {
    const unreadable = doc.unreadableTiles ?? 0
    // Not over tiles it couldn't read.
    const link: FileLink | null =
      handle && unreadable === 0 ? { handle, projectId: null, modified: file.lastModified, kept: false } : null
    const open = () => {
      this.openUnsaved(doc.config, doc, link)
      this.reportUnreadableFile(file, unreadable, handle !== null)
      this.reportNotice(doc)
    }
    if (this.unsavedChanged) {
      this.toast(`The open canvas can't be saved in this browser, so opening ${q(file.name)} loses it`, 'error', {
        durationMs: 10000,
        action: { label: 'Open anyway', run: open },
      })
      return false
    }
    open()
    return true
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
      const sessionId = this.store.getState().sessionId
      const doc = this.unsavedDoc
      const shown = this.unsavedShownBy
      if (doc && doc.sessionId === sessionId) {
        this.unsavedDoc = null
        this.loadUnsaved(engine, doc)
      } else if (shown && shown.sessionId === sessionId && shown.engine !== engine) {
        this.unsavedRestarted()
      }
      this.unsavedShownBy = { engine, sessionId }
      engine.setDocumentChangeCallback(() => {
        this.unsavedEdits++
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

  /**
   * A canvas that can't be saved restarted (a lost GPU context), empty: what
   * it showed went with the old engine. Ctrl+S mustn't write the empty
   * canvas over the file that has the last save of it.
   */
  private unsavedRestarted() {
    this.unsavedEpoch++
    this.unsavedEdits = 0
    this.unsavedEditsWritten = 0
    const link = this.link
    if (!link) return
    this.dropLink(link)
    this.toast(
      `The canvas restarted and lost what it showed. ${q(link.handle.name)} still has it as last saved: open it again with File › Open…`,
      'error',
      { durationMs: 15000 },
    )
  }

  /** Put a document opened from a file without storage into the canvas made for it. */
  private loadUnsaved(engine: DocumentEngine, doc: UnsavedDocument) {
    try {
      engine.loadDocument(doc.layers, doc.activeLayerId)
      engine.finishLoading()
    } catch (err) {
      console.error('[QUAR] A file could not be put into the canvas:', err)
      // The canvas stays empty: Ctrl+S mustn't write it over the file.
      if (this.link) this.dropLink(this.link)
      this.toast(`Couldn't open ${q(this.store.getState().currentProjectName)}: ${describe(err)}`, 'error')
    } finally {
      this.store.getState().setOpenProgress(null)
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
        // Its file may still have what the browser lost: Ctrl+S mustn't write the holes over it.
        const link = unreadable > 0 ? this.link : null
        if (link) this.dropLink(link)
        this.reportUnreadable(doc.project.name, unreadable, link)
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
      this.link = null
    }
    this.store.getState().clearCurrentProject()
    await this.refresh().catch(() => undefined)
    this.toast(message, 'error')
  }

  /** Say so when part of a document couldn't be read: it opened with those tiles transparent. */
  private reportUnreadable(name: string, n: number, link: FileLink | null) {
    if (n === 0) return
    const tiles = `${n} ${n === 1 ? 'tile' : 'tiles'} of ${TILE_SIZE} × ${TILE_SIZE} px`
    const file = link
      ? `. ${q(link.handle.name)} may still have it, so Ctrl+S no longer writes to it: open it with File › Open…`
      : ''
    this.toast(`Part of ${q(name)} couldn't be read and shows as transparent (${tiles})${file}`, 'error', {
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
    project: Pick<
      ProjectRecord,
      | 'id'
      | 'name'
      | 'width'
      | 'height'
      | 'dpi'
      | 'colorSpace'
      | 'view'
      | 'guides'
      | 'activeLayerId'
      | 'fileHandle'
      | 'fileModified'
    >,
    doc: LoadedDocument | null,
  ) {
    this.saveErrorShown = false
    this.loadingInto = null
    this.unsavedDoc = null
    // Ctrl+S writes the file it was saved as or opened from (plan M1.5), while it is as the project last wrote it.
    this.link = project.fileHandle
      ? { handle: project.fileHandle, projectId: project.id, modified: project.fileModified ?? null, kept: true }
      : null
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

  /**
   * A canvas that can't be saved in the browser: empty, or with a document
   * opened from a file, which Ctrl+S writes to when it came with its handle.
   */
  private openUnsaved(
    config: NewProjectConfig,
    doc: Pick<FileDocument, 'layers' | 'activeLayerId' | 'guides'> | null = null,
    link: FileLink | null = null,
  ) {
    this.session = null
    this.pending = null
    this.loadingInto = null
    this.unsavedEdits = 0
    this.unsavedEditsWritten = 0
    this.link = link
    this.showGuides(doc?.guides, config.width, config.height)
    this.store.getState().openDocument({ id: null, ...config, loadsSaved: doc !== null })
    const sessionId = this.store.getState().sessionId
    this.unsavedDoc = doc && sessionId ? { sessionId, layers: doc.layers, activeLayerId: doc.activeLayerId } : null
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
    this.link = null
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
      `The browser's storage is full: ${what}. Save it as a .qart file to keep a copy, and make room by deleting projects you don't need from the Gallery in another tab.`,
      'error',
      { durationMs: 20000, action: this.saveAsAction() },
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
      const refused = refusal(file)
      if (refused) {
        this.toast(refused, 'error')
        continue
      }
      try {
        const doc = await this.fileDocument(file)
        await this.addProject(doc)
        imported.push(baseName(file.name))
        this.reportUnreadableFile(file, doc.unreadableTiles ?? 0, false)
        this.reportNotice(doc)
      } catch (err) {
        this.toast(`Couldn't import ${q(file.name)}: ${describe(err)}`, 'error')
      }
    }
    if (imported.length === 0) return
    await this.refresh()
    this.toast(imported.length === 1 ? `Imported ${q(imported[0])}` : `Imported ${imported.length} files`, 'success')
  }

  /** A file's document, by its kind: a .qart or PSD file, or an image. */
  private fileDocument(file: File): Promise<FileDocument> {
    const kind = importKind(file)
    if (kind === 'qart') return this.qartDocument(file)
    if (kind === 'psd') return this.psdDocument(file)
    return this.imageDocument(file)
  }

  /**
   * A PSD file's document, named after its file (plan M1.7): read off the
   * main thread, its groups flattened, and refused before any pixels are
   * read when it is larger than this device opens or has more layers than
   * the app. Its notice says what didn't come with it.
   */
  private async psdDocument(file: File): Promise<FileDocument> {
    // Without storage there is no Gallery to show a thumbnail.
    const { document: doc, thumbnail } = await openPsd(file, appFileLimits(), { thumbnail: !this.unsaved })
    let activeLayerId = ''
    const layers: StoredLayer[] = doc.layers.map(({ pixels, name, ...props }, i) => {
      const info = savedLayerInfo({ ...newLayerInfo(name), ...props })
      if (i === doc.activeLayer) activeLayerId = info.id
      return { info, pixels }
    })
    return {
      config: { name: baseName(file.name), width: doc.width, height: doc.height, dpi: doc.dpi, colorSpace: 'srgb' },
      layers,
      activeLayerId: activeLayerId || layers[layers.length - 1].info.id,
      thumbnail,
      notice: psdNotice(file.name, doc.notes),
    }
  }

  /** An image as a one-layer document named after its file. */
  private async imageDocument(file: File): Promise<FileDocument> {
    const { pixels, width, height } = await decodeImageBlob(file)
    const problem = canvasSizeProblem(width, height)
    if (problem) throw new Error(`it is ${width} × ${height} px. ${problem}`)
    const name = baseName(file.name)
    const info = newLayerInfo(name)
    const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)
    return { config: { name, width, height, dpi: 72, colorSpace: 'srgb' }, layers: [{ info, pixels: bytes }], activeLayerId: info.id }
  }

  /**
   * A .qart file's document, named after its file (plan M1.6): read off the
   * main thread, and refused before any pixels are read when it is larger
   * than this device opens or has more layers than the app.
   */
  private async qartDocument(file: File): Promise<FileDocument> {
    // Without storage there is no Gallery to show a thumbnail.
    const { document: doc, thumbnail } = await openQart(file, appFileLimits(), { thumbnail: !this.unsaved })
    // Fresh ids: the same file imported twice makes two independent projects.
    let activeLayerId = ''
    const layers: StoredLayer[] = doc.layers.map(({ info: layer, pixels }) => {
      const info = savedLayerInfo({
        ...newLayerInfo(layer.name),
        blendMode: layer.blendMode,
        opacity: layer.opacity,
        visible: layer.visible,
        locked: layer.locked,
        alphaLock: layer.alphaLock,
        clippingMask: layer.clippingMask,
      })
      if (layer.id === doc.activeLayerId) activeLayerId = info.id
      return { info, pixels }
    })
    const { width, height, dpi, colorSpace } = doc
    return {
      config: { name: baseName(file.name), width, height, dpi, colorSpace },
      layers,
      activeLayerId,
      guides: doc.guides,
      unreadableTiles: doc.unreadableTiles,
      thumbnail,
    }
  }

  /**
   * Make a project of a document read from a file: its record, with a
   * thumbnail, and its layers saved. In the stack open in the Gallery, if
   * there is one. Returns its id.
   */
  private async addProject({ config, layers, activeLayerId, guides, thumbnail: drawn }: FileDocument): Promise<string> {
    const { view, openStackId } = this.store.getState()
    const stackId = view === 'gallery' && openStackId ? openStackId : undefined
    // Before saving: the save hands the pixels over to the persistence worker.
    const thumbnail =
      drawn ??
      (await encodeLayersThumbnail(
        layers.flatMap(({ info, pixels }) =>
          pixels ? [{ pixels, opacity: info.opacity, visible: info.visible, blendMode: info.blendMode }] : [],
        ),
        config.width,
        config.height,
      ).catch(() => null))
    const id = await this.db.createProject(config.name, config.width, config.height, config.dpi, {
      colorSpace: config.colorSpace,
      ...(stackId ? { stackId } : {}),
    })
    try {
      await this.tiles.save(id, { width: config.width, height: config.height, layers })
      await this.db.updateProject(id, {
        activeLayerId,
        ...(thumbnail ? { thumbnail } : {}),
        // The guides the file had, checked; without any, the project opens with fresh ones.
        ...(guides !== undefined && guides !== null ? { guides: savedGuides(guides, config.width, config.height) } : {}),
      })
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
