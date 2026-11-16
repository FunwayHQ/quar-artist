/**
 * Known bugs are recorded as expected failures, so the suite stays green while
 * they are open and the fix turns the test into an "unexpected pass" that
 * must be cleaned up. IDs refer to docs/completion-plan.md, Appendix A.
 */
import { test } from '@playwright/test'
import type { HarnessInfo } from '../harness/protocol.ts'

export interface KnownBug {
  /** Finding ID, e.g. 'F20'. */
  id: string
  /** Work package expected to fix it, e.g. 'M2.4'. */
  fixedIn: string
  summary: string
  /** Backends the bug shows on. Default: all. */
  backends?: HarnessInfo['backend'][]
}

/** Mark the running test as an expected failure if `bug` applies to this backend. */
export function expectKnownBug(bug: KnownBug | undefined, info: Pick<HarnessInfo, 'backend'>): void {
  if (!bug) return
  const applies = !bug.backends || bug.backends.includes(info.backend)
  if (!applies) return
  test.fail(true, `${bug.id}: ${bug.summary} (fix planned in ${bug.fixedIn})`)
}
