/**
 * Files on the user's disk (plan M1.5). Chromium's File System Access API
 * picks a file to save to and writes it again later, through its handle.
 * Where the browser doesn't have it (Firefox, Safari), saving is a download
 * and opening goes through a file input.
 */
import { downloadBlob } from '../formats/image/ImageExporter.ts'

/** A file the user picked: a standard handle, with Chromium's permission methods when it has them. */
export interface FileHandle extends FileSystemFileHandle {
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}

interface FilePickerType {
  description: string
  accept: Record<string, string[]>
}

/** The pickers, where the browser has them. */
interface PickerWindow {
  showSaveFilePicker?(options: {
    suggestedName?: string
    types?: FilePickerType[]
    id?: string
    excludeAcceptAllOption?: boolean
  }): Promise<FileHandle>
  showOpenFilePicker?(options: { types?: FilePickerType[]; id?: string; multiple?: boolean }): Promise<FileHandle[]>
}

export const QART_EXTENSION = '.qart'
const QART_MIME = 'application/x-quar-artist'
const QART_TYPE: FilePickerType = { description: 'QUAR Artist project', accept: { [QART_MIME]: [QART_EXTENSION] } }
const OPEN_TYPES: FilePickerType[] = [
  {
    description: 'QUAR Artist projects, PSD files and images',
    accept: {
      [QART_MIME]: [QART_EXTENSION],
      'image/vnd.adobe.photoshop': ['.psd'],
      'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'],
    },
  },
]
/** The files File › Open… offers, where it has to use a file input. */
export const OPEN_ACCEPT = '.qart,.psd,image/*'
/** The pickers start in the folder last used with this id. */
const PICKER_ID = 'quar-artist'
/** Longest project name kept in a file name: file systems allow 255 bytes. */
const MAX_NAME = 120

function pickers(): PickerWindow {
  return globalThis as PickerWindow
}

/** Whether the user closed a picker without choosing. */
function cancelled(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
}

/** Whether a file can be picked to save to, and written again later (Chromium). */
export function canPickSaveFile(): boolean {
  return typeof pickers().showSaveFilePicker === 'function'
}

/**
 * Ask where to save a .qart file. Call it while handling the user's key
 * press or click: browsers show pickers only then. Null when they cancel.
 */
export async function pickSaveFile(suggestedName: string): Promise<FileHandle | null> {
  const w = pickers()
  if (!w.showSaveFilePicker) throw new Error("this browser can't save to a file of your choice")
  try {
    return await w.showSaveFilePicker({ suggestedName, types: [QART_TYPE], id: PICKER_ID, excludeAcceptAllOption: true })
  } catch (err) {
    if (cancelled(err)) return null
    throw err
  }
}

/** A file picked to open, with its handle where the browser gives one. */
export interface PickedFile {
  file: File
  handle: FileHandle | null
}

/**
 * Ask for a file to open: a .qart file, a PSD file or an image. Call it
 * while handling the user's key press or click. Null when they cancel.
 */
export async function pickOpenFile(): Promise<PickedFile | null> {
  const w = pickers()
  if (!w.showOpenFilePicker) {
    const file = await pickWithInput(OPEN_ACCEPT)
    return file ? { file, handle: null } : null
  }
  let handles: FileHandle[]
  try {
    handles = await w.showOpenFilePicker({ types: OPEN_TYPES, id: PICKER_ID, multiple: false })
  } catch (err) {
    if (cancelled(err)) return null
    throw err
  }
  const [handle] = handles
  return handle ? { file: await handle.getFile(), handle } : null
}

/** Ends the file input still waiting for the user, if there is one. */
let endWaitingInput: (() => void) | null = null

/**
 * Ask for a file with a file input. Null when the user cancels, which every
 * browser the app supports says with the input's cancel event (plan Q9).
 * Nothing else counts as cancelling: a file can come a while after the
 * picker closes (from a cloud drive or the photo library). A browser that
 * says nothing leaves its input waiting, and the next pick ends it.
 */
export function pickWithInput(accept: string): Promise<File | null> {
  endWaitingInput?.()
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.hidden = true
    let done = false
    const finish = (file: File | null) => {
      if (done) return
      done = true
      if (endWaitingInput === end) endWaitingInput = null
      input.remove()
      resolve(file)
    }
    const end = () => finish(null)
    endWaitingInput = end
    input.onchange = () => finish(input.files?.[0] ?? null)
    input.oncancel = end
    // Some browsers only open the picker of an input that is in the page.
    document.body.append(input)
    input.click()
  })
}

/**
 * Whether the page may write to a file, asking the user if it has to. Call
 * it while handling their key press or click: the browser asks only then.
 */
export async function mayWrite(handle: FileHandle): Promise<boolean> {
  if (!handle.queryPermission || !handle.requestPermission) return true
  const mode = { mode: 'readwrite' } as const
  if ((await handle.queryPermission(mode)) === 'granted') return true
  return (await handle.requestPermission(mode)) === 'granted'
}

/**
 * Write a file through its handle. The browser writes a copy and puts it in
 * the file's place once it is all written, so a write that fails leaves the
 * file as it was.
 */
export async function writeFile(handle: FileHandle, data: Blob): Promise<void> {
  const writable = await handle.createWritable()
  try {
    await writable.write(data)
    await writable.close()
  } catch (err) {
    await writable.abort().catch(() => undefined)
    throw err
  }
}

/** When a file was last written, as its file system says. */
export async function lastModified(handle: FileHandle): Promise<number> {
  return (await handle.getFile()).lastModified
}

/** Whether two handles are of the same file. */
export async function sameFile(a: FileHandle, b: FileHandle): Promise<boolean> {
  try {
    return await a.isSameEntry(b)
  } catch {
    return false
  }
}

/** Save data as a download: where a file can't be picked to save to. */
export function downloadFile(data: Blob, fileName: string): void {
  downloadBlob(data, fileName)
}

/** A file name for a project: its name, without what file systems refuse, and an extension. */
export function fileNameFor(name: string, extension: string): string {
  const safe = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, MAX_NAME)
    .trim()
  return `${safe || 'Untitled'}${extension}`
}

/** Why writing a file failed, as toasts show it. */
export function describeFileError(err: unknown): string {
  const { name, message } = (typeof err === 'object' && err !== null ? err : {}) as { name?: unknown; message?: unknown }
  switch (name) {
    case 'NotFoundError':
      return 'it was moved or deleted'
    case 'NotAllowedError':
    case 'SecurityError':
      return "the browser didn't allow writing to it"
    case 'NoModificationAllowedError':
      return 'another program is using it'
    case 'QuotaExceededError':
      return 'the disk is full'
  }
  if (typeof message === 'string' && message) return message
  return String(err)
}

/** Whether a file error means the file is gone, so writing it again is pointless. */
export function isFileGone(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'NotFoundError'
}
