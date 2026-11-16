import { afterEach, describe, it, expect, vi } from 'vitest'
import { createId } from './id.ts'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('createId', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a version 4 UUID', () => {
    expect(createId()).toMatch(UUID_V4)
  })

  it('returns a different id each time', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => createId()))
    expect(ids.size).toBe(1000)
  })

  it('builds a version 4 UUID itself outside a secure context', () => {
    // Outside a secure context the browser doesn't define randomUUID at all.
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    const ids = Array.from({ length: 50 }, () => createId())
    for (const id of ids) expect(id).toMatch(UUID_V4)
    expect(new Set(ids).size).toBe(50)
  })
})
