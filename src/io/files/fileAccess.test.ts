import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  canPickSaveFile,
  describeFileError,
  fileNameFor,
  isFileGone,
  lastModified,
  mayWrite,
  pickOpenFile,
  pickSaveFile,
  pickWithInput,
  sameFile,
  writeFile,
  type FileHandle,
} from './fileAccess.ts'

type Pickers = Partial<Record<'showSaveFilePicker' | 'showOpenFilePicker', unknown>>

function setPickers(pickers: Pickers) {
  Object.assign(globalThis, pickers)
}

function abort() {
  return new DOMException('The user aborted a request.', 'AbortError')
}

/** A handle with the parts a test gives it. */
function handle(parts: Partial<FileHandle> & { name?: string } = {}): FileHandle {
  return { kind: 'file', name: 'Painting.qart', ...parts } as FileHandle
}

/** The file input a picker put in the page. */
function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('no file input')
  return input
}

/** Give a file input a file and say it changed, as the browser does when one is picked. */
function choose(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change'))
}

afterEach(() => {
  for (const name of ['showSaveFilePicker', 'showOpenFilePicker']) Reflect.deleteProperty(globalThis, name)
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('pickers (plan M1.5)', () => {
  it('can pick a file to save to only where the browser has the save picker', () => {
    expect(canPickSaveFile()).toBe(false)
    setPickers({ showSaveFilePicker: vi.fn() })
    expect(canPickSaveFile()).toBe(true)
  })

  it('asks where to save a .qart file, suggesting its name, in the folder used last', async () => {
    const picked = handle()
    const showSaveFilePicker = vi.fn(async () => picked)
    setPickers({ showSaveFilePicker })

    expect(await pickSaveFile('Painting.qart')).toBe(picked)

    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: 'Painting.qart',
      types: [{ description: 'QUAR Artist project', accept: { 'application/x-quar-artist': ['.qart'] } }],
      id: 'quar-artist',
      excludeAcceptAllOption: true,
    })
  })

  it('takes closing the save picker for no file, and passes other failures on', async () => {
    setPickers({ showSaveFilePicker: vi.fn(async () => Promise.reject(abort())) })
    expect(await pickSaveFile('Painting.qart')).toBeNull()

    const refused = new DOMException('Must be handling a user gesture to show a file picker.', 'SecurityError')
    setPickers({ showSaveFilePicker: vi.fn(async () => Promise.reject(refused)) })
    await expect(pickSaveFile('Painting.qart')).rejects.toBe(refused)
  })

  it('says so when there is no save picker to ask with', async () => {
    await expect(pickSaveFile('Painting.qart')).rejects.toThrow("this browser can't save to a file of your choice")
  })

  it('opens one .qart file, PSD file or image with the open picker, with its handle', async () => {
    const file = new File(['zip'], 'Painting.qart')
    const picked = handle({ getFile: async () => file })
    const showOpenFilePicker = vi.fn(async () => [picked])
    setPickers({ showOpenFilePicker })

    expect(await pickOpenFile()).toEqual({ file, handle: picked })

    const [[options]] = showOpenFilePicker.mock.calls as unknown as [[{ types: { accept: Record<string, string[]> }[]; multiple: boolean; id: string }]]
    expect(options.multiple).toBe(false)
    expect(options.id).toBe('quar-artist')
    expect(options.types[0].accept).toEqual({
      'application/x-quar-artist': ['.qart'],
      // PSB files are PSD files for canvases over 30,000 px (plan M1.7).
      'image/vnd.adobe.photoshop': ['.psd', '.psb'],
      'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'],
    })
  })

  it('takes closing the open picker for no file', async () => {
    setPickers({ showOpenFilePicker: vi.fn(async () => Promise.reject(abort())) })
    expect(await pickOpenFile()).toBeNull()
  })

  it('opens a file through a file input where there is no open picker, without a handle', async () => {
    const opening = pickOpenFile()
    const input = fileInput()
    expect(input.accept).toBe('.qart,.psd,.psb,image/*')
    const file = new File(['png'], 'cat.png', { type: 'image/png' })
    choose(input, file)

    expect(await opening).toEqual({ file, handle: null })
    // Gone from the page once it has given its file.
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })
})

describe('pickWithInput', () => {
  it('opens the picker of a hidden input in the page', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    const picking = pickWithInput('image/png')
    const input = fileInput()
    expect(input).toMatchObject({ accept: 'image/png', hidden: true })
    expect(click).toHaveBeenCalledOnce()
    input.dispatchEvent(new Event('cancel'))
    expect(await picking).toBeNull()
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it('keeps a file that comes a while after the picker closed and focus came back (a cloud drive, the photo library)', async () => {
    vi.useFakeTimers()
    const picking = pickWithInput('.qart,.psd,.psb,image/*')
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(5000)
    const file = new File(['png'], 'cat.png', { type: 'image/png' })
    choose(fileInput(), file)
    expect(await picking).toBe(file)
  })

  it('ends a pick the browser never said was cancelled when the next starts, leaving one input in the page', async () => {
    const first = pickWithInput('image/png')
    const second = pickWithInput('image/png')
    expect(await first).toBeNull()
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1)
    const file = new File(['png'], 'cat.png', { type: 'image/png' })
    choose(fileInput(), file)
    expect(await second).toBe(file)
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })
})

describe('writing files', () => {
  it('may write where the browser has no permissions to ask for', async () => {
    expect(await mayWrite(handle())).toBe(true)
  })

  it('writes without asking when writing is allowed already', async () => {
    const requestPermission = vi.fn()
    const allowed = handle({ queryPermission: vi.fn(async () => 'granted' as const), requestPermission })
    expect(await mayWrite(allowed)).toBe(true)
    expect(allowed.queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('asks the user otherwise, and writes only if they allow it', async () => {
    const asked = (answer: PermissionState) =>
      handle({ queryPermission: vi.fn(async () => 'prompt' as const), requestPermission: vi.fn(async () => answer) })
    const allowing = asked('granted')
    expect(await mayWrite(allowing)).toBe(true)
    expect(allowing.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(await mayWrite(asked('denied'))).toBe(false)
  })

  it('writes the data and closes the file, which puts it in place', async () => {
    const writable = { write: vi.fn(async () => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) }
    const file = handle({ createWritable: vi.fn(async () => writable) as unknown as FileHandle['createWritable'] })
    const data = new Blob(['zip'])

    await writeFile(file, data)

    expect(writable.write).toHaveBeenCalledWith(data)
    expect(writable.close).toHaveBeenCalledOnce()
    expect(writable.abort).not.toHaveBeenCalled()
  })

  it('drops a write that fails part-way, leaving the file as it was', async () => {
    const full = new DOMException('no room', 'QuotaExceededError')
    const writable = { write: vi.fn(async () => Promise.reject(full)), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) }
    const file = handle({ createWritable: vi.fn(async () => writable) as unknown as FileHandle['createWritable'] })

    await expect(writeFile(file, new Blob(['zip']))).rejects.toBe(full)

    expect(writable.close).not.toHaveBeenCalled()
    expect(writable.abort).toHaveBeenCalledOnce()
  })

  it('reads when a file was last written', async () => {
    const file = new File(['zip'], 'Painting.qart', { lastModified: 1234 })
    expect(await lastModified(handle({ getFile: async () => file }))).toBe(1234)
  })

  it('tells handles of the same file apart from others', async () => {
    const a = handle({ isSameEntry: vi.fn(async (other) => other === b) })
    const b = handle()
    expect(await sameFile(a, b)).toBe(true)
    expect(await sameFile(a, handle())).toBe(false)
    expect(await sameFile(handle({ isSameEntry: vi.fn(async () => Promise.reject(new Error('gone'))) }), b)).toBe(false)
  })
})

describe('file names and errors', () => {
  it('names a file after its project, without what file systems refuse', () => {
    expect(fileNameFor('Painting', '.qart')).toBe('Painting.qart')
    expect(fileNameFor('Sky: v2/final?', '.qart')).toBe('Sky v2 final.qart')
    expect(fileNameFor('a\u0000b\tc', '.qart')).toBe('a b c.qart')
    expect(fileNameFor('...hidden', '.qart')).toBe('hidden.qart')
    expect(fileNameFor(' / ', '.qart')).toBe('Untitled.qart')
    expect(fileNameFor('x'.repeat(300), '.qart')).toBe(`${'x'.repeat(120)}.qart`)
  })

  it('says why writing a file failed in words', () => {
    expect(describeFileError(new DOMException('x', 'NotFoundError'))).toBe('it was moved or deleted')
    expect(describeFileError(new DOMException('x', 'NotAllowedError'))).toBe("the browser didn't allow writing to it")
    expect(describeFileError(new DOMException('x', 'NoModificationAllowedError'))).toBe('another program is using it')
    expect(describeFileError(new DOMException('x', 'QuotaExceededError'))).toBe('the disk is full')
    expect(describeFileError(new Error('the layer “Ink” can’t be read right now'))).toBe('the layer “Ink” can’t be read right now')
    expect(describeFileError('odd')).toBe('odd')
  })

  it('knows a file that is gone', () => {
    expect(isFileGone(new DOMException('x', 'NotFoundError'))).toBe(true)
    expect(isFileGone(new DOMException('x', 'NotAllowedError'))).toBe(false)
    expect(isFileGone(null)).toBe(false)
  })
})
