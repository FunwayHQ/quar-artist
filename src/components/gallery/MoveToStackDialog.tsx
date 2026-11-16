import { useEffect, useState } from 'react'
import type { ProjectRecord, StackRecord } from '../../db/schema.ts'
import styles from './MoveToStackDialog.module.css'

interface MoveToStackDialogProps {
  project: ProjectRecord
  stacks: readonly StackRecord[]
  /** Move to this stack, or to the top level with null. */
  onMove: (stackId: string | null) => void
  /** Make a new stack with this name and move the project into it. */
  onCreate: (name: string) => void
  onClose: () => void
}

export function MoveToStackDialog({ project, stacks, onMove, onCreate, onClose }: MoveToStackDialogProps) {
  const [name, setName] = useState('')
  const others = stacks.filter((s) => s.id !== project.stackId)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const create = () => {
    const trimmed = name.trim()
    if (trimmed) onCreate(trimmed)
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Move to Stack"
      >
        <h2 className={styles.title}>Move {project.name} to a stack</h2>

        {(others.length > 0 || project.stackId) && (
          <ul className={styles.list}>
            {project.stackId && (
              <li>
                <button className={styles.choice} type="button" onClick={() => onMove(null)}>
                  Top level (no stack)
                </button>
              </li>
            )}
            {others.map((stack) => (
              <li key={stack.id}>
                <button className={styles.choice} type="button" onClick={() => onMove(stack.id)}>
                  {stack.name}
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          className={styles.newStack}
          onSubmit={(e) => {
            e.preventDefault()
            create()
          }}
        >
          <input
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New stack name"
            aria-label="New stack name"
            autoFocus
          />
          <button className={styles.createBtn} type="submit" disabled={!name.trim()}>
            New Stack
          </button>
        </form>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
