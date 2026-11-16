/**
 * A new random id: an RFC 4122 version 4 UUID (plan D12). Ids stay unique
 * across page loads, devices and imported files, unlike a per-session counter.
 */
export function createId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()

  // randomUUID only exists in secure contexts; getRandomValues works everywhere,
  // for example when testing on a tablet over plain HTTP on the local network.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
