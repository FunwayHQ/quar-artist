import { useEffect, useState } from 'react'
import { HardDrive } from 'lucide-react'
import { formatBytes } from '../../utils/formatBytes.ts'
import styles from './StorageUsage.module.css'

interface Estimate {
  usage: number
  quota: number
  /** Whether the browser keeps the storage when space runs low. Null when it can't say. */
  persisted: boolean | null
}

/** From this share of the quota on, the readout warns that space is running out. */
const STORAGE_WARNING_SHARE = 0.8

/**
 * How much of the storage the browser allows this site the projects use
 * (plan M1.3), and whether the browser may clear it. Shows nothing where the
 * browser can't say. `refreshKey` changing reads it again.
 */
export function StorageUsage({ refreshKey }: { refreshKey: unknown }) {
  const [estimate, setEstimate] = useState<Estimate | null>(null)

  useEffect(() => {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
    if (!storage?.estimate) return
    let current = true
    const persisted = storage.persisted ? storage.persisted().catch(() => null) : Promise.resolve(null)
    Promise.all([storage.estimate(), persisted])
      .then(([{ usage = 0, quota = 0 }, kept]) => {
        if (current) setEstimate({ usage, quota, persisted: kept })
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [refreshKey])

  if (!estimate || estimate.quota <= 0) return null
  const { usage, quota, persisted } = estimate
  const share = Math.min(1, usage / quota)
  const summary = `${formatBytes(usage)} of ${formatBytes(quota)}`
  const title = [
    `Projects and settings use ${summary}, the space this browser allows QUAR Artist on this device.`,
    persisted === false
      ? 'The browser may clear it when the device runs low on space: export the projects you want to keep.'
      : persisted
        ? 'The browser keeps it until you clear the site’s data.'
        : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={styles.usage}
      data-full={share >= STORAGE_WARNING_SHARE || undefined}
      title={title}
      aria-label={`Storage: ${summary} used`}
      data-testid="storage-usage"
    >
      <HardDrive size={14} strokeWidth={1.5} aria-hidden />
      <span className={styles.numbers}>{summary}</span>
      <span className={styles.meter} aria-hidden>
        <span className={styles.fill} style={{ width: `${Math.max(share * 100, usage > 0 ? 2 : 0)}%` }} />
      </span>
    </div>
  )
}
