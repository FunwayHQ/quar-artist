/**
 * An in-memory stand-in for the parts of the origin private file system the
 * tile store uses, with sync access handles as in a worker.
 */

function domError(name: string, message = name): DOMException {
  return new DOMException(message, name)
}

export interface FakeOpfsFaults {
  /** Called before each file write: an error it returns fails the write. */
  write?: (name: string) => Error | null
}

type Entry = FakeDirectory | FakeFile

export class FakeDirectory {
  readonly kind = 'directory' as const
  readonly name: string
  readonly children = new Map<string, Entry>()
  readonly faults: FakeOpfsFaults

  constructor(name = '', faults: FakeOpfsFaults = {}) {
    this.name = name
    this.faults = faults
  }

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<FakeDirectory> {
    const entry = this.children.get(name)
    if (entry) {
      if (entry.kind !== 'directory') throw domError('TypeMismatchError')
      return entry
    }
    if (!options.create) throw domError('NotFoundError', `${name} not found`)
    const dir = new FakeDirectory(name, this.faults)
    this.children.set(name, dir)
    return dir
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<FakeFile> {
    const entry = this.children.get(name)
    if (entry) {
      if (entry.kind !== 'file') throw domError('TypeMismatchError')
      return entry
    }
    if (!options.create) throw domError('NotFoundError', `${name} not found`)
    const file = new FakeFile(name, this.faults)
    this.children.set(name, file)
    return file
  }

  async removeEntry(name: string, options: { recursive?: boolean } = {}): Promise<void> {
    const entry = this.children.get(name)
    if (!entry) throw domError('NotFoundError', `${name} not found`)
    if (entry.kind === 'directory' && entry.children.size > 0 && !options.recursive) {
      throw domError('InvalidModificationError')
    }
    this.children.delete(name)
  }

  async *entries(): AsyncGenerator<[string, Entry]> {
    for (const entry of [...this.children]) yield entry
  }

  /** Every file below this folder, by path. */
  files(prefix = ''): Map<string, Uint8Array> {
    const all = new Map<string, Uint8Array>()
    for (const [name, entry] of this.children) {
      if (entry.kind === 'file') all.set(prefix + name, entry.data)
      else for (const [path, data] of entry.files(`${prefix}${name}/`)) all.set(path, data)
    }
    return all
  }

  /** As the tile store sees it. */
  asHandle(): FileSystemDirectoryHandle {
    return this as unknown as FileSystemDirectoryHandle
  }
}

export class FakeFile {
  readonly kind = 'file' as const
  readonly name: string
  data = new Uint8Array(0)
  private open = false
  private readonly faults: FakeOpfsFaults

  constructor(name: string, faults: FakeOpfsFaults) {
    this.name = name
    this.faults = faults
  }

  async getFile(): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> }> {
    const copy = this.data.slice()
    return { size: copy.byteLength, arrayBuffer: async () => copy.buffer }
  }

  async createSyncAccessHandle() {
    if (this.open) throw domError('NoModificationAllowedError', 'the file is open elsewhere')
    this.open = true
    return {
      write: (buffer: ArrayBufferView, options: { at?: number } = {}) => {
        const failure = this.faults.write?.(this.name)
        if (failure) throw failure
        const at = options.at ?? 0
        const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        if (at + bytes.byteLength > this.data.byteLength) {
          const grown = new Uint8Array(at + bytes.byteLength)
          grown.set(this.data)
          this.data = grown
        }
        this.data.set(bytes, at)
        return bytes.byteLength
      },
      truncate: (size: number) => {
        this.data = this.data.slice(0, size)
      },
      flush: () => {},
      close: () => {
        this.open = false
      },
    }
  }
}
