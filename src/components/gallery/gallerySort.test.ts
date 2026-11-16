import { describe, it, expect } from 'vitest'
import { sortProjects, stackEntries, unstackedProjects } from './gallerySort.ts'
import type { ProjectRecord, StackRecord } from '../../db/schema.ts'

const day = (n: number) => new Date(2025, 0, n)

function project(id: string, name: string, created: number, updated: number, stackId?: string): ProjectRecord {
  return { id, name, width: 1, height: 1, dpi: 72, createdAt: day(created), updatedAt: day(updated), stackId }
}

function stack(id: string, name: string, created: number): StackRecord {
  return { id, name, createdAt: day(created), updatedAt: day(created) }
}

describe('sortProjects', () => {
  const projects = [project('a', 'b', 1, 5), project('b', 'A', 3, 2), project('c', 'c', 2, 9)]

  it('sorts newest first by modified or created date, and A to Z by name', () => {
    expect(sortProjects(projects, 'updated').map((p) => p.id)).toEqual(['c', 'a', 'b'])
    expect(sortProjects(projects, 'created').map((p) => p.id)).toEqual(['b', 'c', 'a'])
    expect(sortProjects(projects, 'name').map((p) => p.id)).toEqual(['b', 'a', 'c'])
  })

  it('breaks ties by id, so equal projects never swap places', () => {
    const tied = [project('z', 'Same', 1, 1), project('m', 'Same', 1, 1), project('q', 'Same', 1, 1)]
    for (const sort of ['updated', 'created', 'name'] as const) {
      expect(sortProjects(tied, sort).map((p) => p.id)).toEqual(['m', 'q', 'z'])
    }
  })

  it('leaves the list it was given alone', () => {
    const copy = [...projects]
    sortProjects(projects, 'name')
    expect(projects).toEqual(copy)
  })
})

describe('stackEntries', () => {
  const stacks = [stack('s1', 'Zoo', 1), stack('s2', 'Apples', 5), stack('s3', 'Empty', 9)]
  const projects = [
    project('a', 'One', 1, 3, 's1'),
    project('b', 'Two', 1, 8, 's1'),
    project('c', 'Three', 1, 6, 's2'),
    project('d', 'Loose', 1, 9),
  ]

  it('gives each stack its projects in Gallery order, leaving out empty stacks', () => {
    const entries = stackEntries(stacks, projects, 'updated')
    expect(entries.map((e) => e.stack.id)).toEqual(['s1', 's2'])
    expect(entries[0].projects.map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('orders stacks by their newest project, their creation, or their name', () => {
    expect(stackEntries(stacks, projects, 'updated').map((e) => e.stack.name)).toEqual(['Zoo', 'Apples'])
    expect(stackEntries(stacks, projects, 'created').map((e) => e.stack.name)).toEqual(['Apples', 'Zoo'])
    expect(stackEntries(stacks, projects, 'name').map((e) => e.stack.name)).toEqual(['Apples', 'Zoo'])
  })
})

describe('unstackedProjects', () => {
  it('keeps projects in no stack, or in one that no longer exists', () => {
    const projects = [project('a', 'A', 1, 1, 's1'), project('b', 'B', 1, 1), project('c', 'C', 1, 1, 'gone')]
    expect(unstackedProjects(projects, [stack('s1', 'S', 1)]).map((p) => p.id)).toEqual(['b', 'c'])
  })
})
