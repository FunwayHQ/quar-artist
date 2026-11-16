import type { ProjectRecord, StackRecord } from '../../db/schema.ts'
import type { GallerySort } from '../../types/project.ts'

/** A stack as the Gallery shows it: with its projects, in Gallery order. */
export interface StackEntry {
  stack: StackRecord
  projects: ProjectRecord[]
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Projects in Gallery order: newest first by date, A to Z by name. Ties go by id, so the order never jumps. */
export function sortProjects(projects: readonly ProjectRecord[], sort: GallerySort): ProjectRecord[] {
  const byId = (a: ProjectRecord, b: ProjectRecord) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const compare =
    sort === 'name'
      ? (a: ProjectRecord, b: ProjectRecord) => byName.compare(a.name, b.name)
      : sort === 'created'
        ? (a: ProjectRecord, b: ProjectRecord) => b.createdAt.getTime() - a.createdAt.getTime()
        : (a: ProjectRecord, b: ProjectRecord) => b.updatedAt.getTime() - a.updatedAt.getTime()
  return [...projects].sort((a, b) => compare(a, b) || byId(a, b))
}

/**
 * The stacks with their projects, in Gallery order. A stack sorts by its name,
 * when it was made, or its most recently modified project. Stacks whose
 * projects are all deleted are left out.
 */
export function stackEntries(
  stacks: readonly StackRecord[],
  projects: readonly ProjectRecord[],
  sort: GallerySort,
): StackEntry[] {
  const entries = stacks
    .map((stack) => ({ stack, projects: sortProjects(projects.filter((p) => p.stackId === stack.id), sort) }))
    .filter((entry) => entry.projects.length > 0)
  const latest = (entry: StackEntry) => Math.max(...entry.projects.map((p) => p.updatedAt.getTime()))
  if (sort === 'name') entries.sort((a, b) => byName.compare(a.stack.name, b.stack.name))
  else if (sort === 'created') entries.sort((a, b) => b.stack.createdAt.getTime() - a.stack.createdAt.getTime())
  else entries.sort((a, b) => latest(b) - latest(a))
  return entries
}

/** Projects shown at the top level: those in no stack, or in a stack that no longer exists. */
export function unstackedProjects(projects: readonly ProjectRecord[], stacks: readonly StackRecord[]): ProjectRecord[] {
  const ids = new Set(stacks.map((s) => s.id))
  return projects.filter((p) => !p.stackId || !ids.has(p.stackId))
}
