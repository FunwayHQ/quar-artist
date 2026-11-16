/**
 * A size in bytes as people read it: 840 KB, 4.2 MB, 61 GB. Counts in 1024s,
 * as the rest of the app does, with one decimal below 10.
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const shown = unit > 0 && value < 10 ? value.toFixed(1) : String(Math.round(value))
  return `${shown} ${units[unit]}`
}
