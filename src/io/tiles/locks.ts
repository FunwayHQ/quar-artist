/**
 * Run `work` holding a lock on one project's saved document, so a save,
 * copy or delete never runs alongside another one on the same project, in
 * this tab or another (Web Locks). Loads share the lock with each other.
 * Without Web Locks, the work is ordered within this context only.
 */
export function withDocumentLock<T>(projectId: string, mode: 'exclusive' | 'shared', work: () => Promise<T>): Promise<T> {
  const name = `quar-artist:document:${projectId}`
  const locks = (globalThis.navigator as Navigator | undefined)?.locks
  if (typeof locks?.request === 'function') return locks.request(name, { mode }, work) as Promise<T>
  return inOrder(name, work)
}

const tails = new Map<string, Promise<unknown>>()

function inOrder<T>(name: string, work: () => Promise<T>): Promise<T> {
  const result = (tails.get(name) ?? Promise.resolve()).then(work, work)
  const tail = result.catch(() => undefined)
  tails.set(name, tail)
  void tail.then(() => {
    if (tails.get(name) === tail) tails.delete(name)
  })
  return result
}
