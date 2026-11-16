/**
 * Web Locks as browsers have them, for tests (jsdom has none): locks are
 * granted in the order asked for, exclusive ones alone, shared ones together.
 */
export class FakeLocks {
  /** Every request made, in order. */
  readonly requests: { name: string; mode: LockMode }[] = []
  private readonly locks = new Map<string, { exclusive: boolean; holders: number; waiting: { mode: LockMode; grant: () => void }[] }>()

  request<T>(name: string, options: { mode?: LockMode }, work: () => Promise<T>): Promise<T> {
    const mode = options.mode ?? 'exclusive'
    this.requests.push({ name, mode })
    let lock = this.locks.get(name)
    if (!lock) {
      lock = { exclusive: false, holders: 0, waiting: [] }
      this.locks.set(name, lock)
    }
    const held = lock
    return new Promise<void>((grant) => {
      held.waiting.push({ mode, grant })
      this.grant(held)
    })
      .then(work)
      .finally(() => {
        held.holders--
        if (held.holders === 0) held.exclusive = false
        this.grant(held)
      })
  }

  private grant(lock: { exclusive: boolean; holders: number; waiting: { mode: LockMode; grant: () => void }[] }) {
    while (lock.waiting.length > 0) {
      const next = lock.waiting[0]
      if (next.mode === 'exclusive' ? lock.holders > 0 : lock.exclusive) return
      lock.waiting.shift()
      lock.holders++
      lock.exclusive = next.mode === 'exclusive'
      next.grant()
      if (lock.exclusive) return
    }
  }
}
