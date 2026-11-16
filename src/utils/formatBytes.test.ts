import { describe, it, expect } from 'vitest'
import { formatBytes } from './formatBytes.ts'

describe('formatBytes', () => {
  it('reads sizes as people do, in 1024s', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(840 * 1024)).toBe('840 KB')
    expect(formatBytes(4.2 * 1024 ** 2)).toBe('4.2 MB')
    expect(formatBytes(61 * 1024 ** 3)).toBe('61 GB')
    expect(formatBytes(-5)).toBe('0 B')
  })
})
