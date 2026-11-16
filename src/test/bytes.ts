/**
 * Whether two byte arrays hold the same bytes. Far faster than `toEqual` on
 * large arrays, which diffs them element by element.
 */
export function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
