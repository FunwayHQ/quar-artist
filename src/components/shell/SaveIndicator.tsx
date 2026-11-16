import { AlertTriangle, Check } from 'lucide-react'
import { useProjectStore } from '@stores/projectStore.ts'
import { projectService } from '../../io/persistence/ProjectService.ts'
import styles from './SaveIndicator.module.css'

/**
 * Whether the open project is saved, beside its name in the title bar (plan
 * M1.3): Edited while changes wait for the next save, Saving…, Saved, or Not
 * saved with a Retry. Not a live region: it changes after every stroke, and
 * a failed save is announced by its toast.
 */
export function SaveIndicator() {
  const status = useProjectStore((s) => s.saveStatus)
  const lastSaved = useProjectStore((s) => s.lastSaved)
  const projectId = useProjectStore((s) => s.currentProjectId)

  if (projectId === null) {
    return (
      <div
        className={styles.indicator}
        data-status="unavailable"
        data-testid="save-status"
        title="This browser can't save your work: export it to keep it"
      >
        <AlertTriangle size={12} strokeWidth={1.5} aria-hidden />
        <span>Not saving</span>
      </div>
    )
  }
  if (status === 'idle') return null
  if (status === 'error') {
    return (
      <div className={styles.indicator} data-status="error" data-testid="save-status">
        <AlertTriangle size={12} strokeWidth={1.5} aria-hidden />
        <span>Not saved</span>
        <button type="button" className={styles.retry} onClick={() => void projectService.saveNow()}>
          Retry
        </button>
      </div>
    )
  }
  const label = status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : 'Edited'
  const title =
    status === 'saved'
      ? `Saved${lastSaved ? ` at ${lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`
      : status === 'saving'
        ? 'Saving your changes'
        : 'Your changes are saved a moment after you stop'
  return (
    <div className={styles.indicator} data-status={status} data-testid="save-status" title={title}>
      {status === 'saved' && <Check size={12} strokeWidth={1.5} aria-hidden />}
      <span>{label}</span>
    </div>
  )
}
