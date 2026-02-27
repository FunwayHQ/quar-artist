import { describe, it, expect } from 'vitest'
import { normalizeKeyEvent, formatShortcutDisplay } from './keyMatcher.ts'

function makeKeyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as KeyboardEvent
}

describe('normalizeKeyEvent', () => {
  it('normalizes simple key press', () => {
    expect(normalizeKeyEvent(makeKeyEvent({ key: 'b' }))).toBe('b')
  })

  it('normalizes ctrl+key', () => {
    expect(normalizeKeyEvent(makeKeyEvent({ key: 'z', ctrlKey: true }))).toBe('ctrl+z')
  })

  it('normalizes meta+key as ctrl', () => {
    expect(normalizeKeyEvent(makeKeyEvent({ key: 'z', metaKey: true }))).toBe('ctrl+z')
  })

  it('normalizes ctrl+shift+key', () => {
    expect(normalizeKeyEvent(makeKeyEvent({ key: 'n', ctrlKey: true, shiftKey: true }))).toBe('ctrl+shift+n')
  })

  it('normalizes bracket keys', () => {
    expect(normalizeKeyEvent(makeKeyEvent({ key: '[' }))).toBe('bracketleft')
    expect(normalizeKeyEvent(makeKeyEvent({ key: ']' }))).toBe('bracketright')
  })

  it('normalizes ? with shift', () => {
    expect(normalizeKeyEvent(makeKeyEvent({ key: '?', shiftKey: true }))).toBe('shift+question')
  })

  it('normalizes Tab key', () => {
    expect(normalizeKeyEvent(makeKeyEvent({ key: 'Tab' }))).toBe('tab')
  })

  it('returns empty string for bare modifier keys', () => {
    expect(normalizeKeyEvent(makeKeyEvent({ key: 'Control', ctrlKey: true }))).toBe('')
    expect(normalizeKeyEvent(makeKeyEvent({ key: 'Shift', shiftKey: true }))).toBe('')
    expect(normalizeKeyEvent(makeKeyEvent({ key: 'Alt', altKey: true }))).toBe('')
  })

  it('normalizes number keys', () => {
    expect(normalizeKeyEvent(makeKeyEvent({ key: '1' }))).toBe('1')
    expect(normalizeKeyEvent(makeKeyEvent({ key: '0' }))).toBe('0')
  })

  it('normalizes ctrl+0', () => {
    expect(normalizeKeyEvent(makeKeyEvent({ key: '0', ctrlKey: true }))).toBe('ctrl+0')
  })
})

describe('formatShortcutDisplay', () => {
  it('formats simple key', () => {
    expect(formatShortcutDisplay('b')).toBe('B')
  })

  it('formats ctrl+key on non-Mac', () => {
    expect(formatShortcutDisplay('ctrl+z')).toBe('Ctrl+Z')
  })

  it('formats ctrl+shift+key on non-Mac', () => {
    expect(formatShortcutDisplay('ctrl+shift+n')).toBe('Ctrl+Shift+N')
  })

  it('formats bracket keys', () => {
    expect(formatShortcutDisplay('bracketleft')).toBe('[')
    expect(formatShortcutDisplay('bracketright')).toBe(']')
  })

  it('formats tab', () => {
    expect(formatShortcutDisplay('tab')).toBe('Tab')
  })
})
