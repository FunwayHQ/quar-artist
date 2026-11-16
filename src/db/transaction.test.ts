import { describe, it, expect, vi } from 'vitest'
import { inTransaction } from './transaction.ts'

/** A transaction whose outcome the test decides, as idb's `tx.done` would report it. */
function scriptedTransaction() {
  let commit!: () => void
  let fail!: (err: unknown) => void
  const done = new Promise<void>((resolve, reject) => {
    commit = resolve
    fail = reject
  })
  return { done, abort: vi.fn(), commit, fail }
}

/** Collect unhandled rejections while `run` runs, and a little after. */
async function unhandledDuring(run: () => Promise<void>): Promise<unknown[]> {
  const unhandled: unknown[] = []
  const listener = (reason: unknown) => unhandled.push(reason)
  process.on('unhandledRejection', listener)
  try {
    await run()
    await new Promise((resolve) => setTimeout(resolve, 20))
  } finally {
    process.off('unhandledRejection', listener)
  }
  return unhandled
}

describe('inTransaction', () => {
  it('resolves with the work\'s result once the transaction commits', async () => {
    const tx = scriptedTransaction()
    let settled = false
    const result = inTransaction(tx, async () => 42).then((value) => {
      settled = true
      return value
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(settled).toBe(false)

    tx.commit()
    expect(await result).toBe(42)
    expect(tx.abort).not.toHaveBeenCalled()
  })

  it('reports a failed request once, though the transaction aborts after it', async () => {
    // What Safari does with a Blob in a private window: the put fails, then the transaction aborts.
    const tx = scriptedTransaction()
    const requestError = new DOMException('Error preparing Blob/File data to be stored in object store', 'UnknownError')

    const unhandled = await unhandledDuring(async () => {
      const result = inTransaction(tx, async () => {
        throw requestError
      })
      await expect(result).rejects.toBe(requestError)
      tx.fail(new DOMException('', 'AbortError'))
    })

    expect(unhandled).toEqual([])
  })

  it('aborts the transaction when the work fails, so none of its writes are kept', async () => {
    const tx = scriptedTransaction()
    await expect(inTransaction(tx, async () => Promise.reject(new TypeError('bug')))).rejects.toThrow('bug')
    expect(tx.abort).toHaveBeenCalledOnce()
  })

  it('reports a transaction that fails to commit', async () => {
    const tx = scriptedTransaction()
    const quota = new DOMException('', 'QuotaExceededError')
    const result = inTransaction(tx, async () => 'written')
    tx.fail(quota)
    await expect(result).rejects.toBe(quota)
  })

  it('copes with a transaction that has already finished when it aborts', async () => {
    const tx = scriptedTransaction()
    tx.abort.mockImplementation(() => {
      throw new DOMException('', 'InvalidStateError')
    })
    const error = new Error('late')
    await expect(inTransaction(tx, async () => Promise.reject(error))).rejects.toBe(error)
  })
})
