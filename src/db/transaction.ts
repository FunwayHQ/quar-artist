/** The parts of an idb transaction that `inTransaction` uses. */
export interface FinishableTransaction {
  readonly done: Promise<void>
  abort(): void
}

/**
 * Run `work` in the transaction `tx` and wait until the transaction finishes.
 * Call it right after creating the transaction.
 *
 * A failed request aborts its transaction, and idb rejects `tx.done` with an
 * AbortError some time after the request's own error. Without a handler, that
 * second rejection is reported as unhandled. If `work` fails for any other
 * reason, the transaction is aborted, so none of its writes are kept.
 */
export async function inTransaction<T>(tx: FinishableTransaction, work: () => Promise<T>): Promise<T> {
  tx.done.catch(() => {})
  try {
    const result = await work()
    await tx.done
    return result
  } catch (err) {
    try {
      tx.abort()
    } catch {
      // Already committed or aborted.
    }
    throw err
  }
}
