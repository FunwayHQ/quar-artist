import { memo, useState } from 'react'
import { Ellipsis } from 'lucide-react'
import type { ProjectRecord } from '../../db/schema.ts'
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu.tsx'
import { ThumbnailImage } from './ThumbnailImage.tsx'
import { InlineName } from './InlineName.tsx'
import styles from './ProjectCard.module.css'

interface ProjectCardProps {
  project: ProjectRecord
  onOpen: () => void
  onRename: (name: string) => void
  onDuplicate: () => void
  onDelete: () => void
  /** Opens the choice of stack to move the project to. */
  onMoveToStack: () => void
  /** Shown inside a stack: moves the project back to the top level. */
  onRemoveFromStack?: () => void
}

export const ProjectCard = memo(function ProjectCard({
  project,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onMoveToStack,
  onRemoveFromStack,
}: ProjectCardProps) {
  const [renaming, setRenaming] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const dateStr = project.updatedAt.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  const menuItems: ContextMenuItem[] = [
    { label: 'Rename', action: () => setRenaming(true) },
    { label: 'Duplicate', action: onDuplicate },
    { label: 'Move to Stack…', action: onMoveToStack },
    ...(onRemoveFromStack ? [{ label: 'Remove from Stack', action: onRemoveFromStack }] : []),
    { label: '', separator: true },
    { label: 'Delete', action: onDelete },
  ]

  return (
    <article
      className={styles.card}
      aria-label={project.name}
      onContextMenu={(e) => {
        // The menu is portalled out of the card, but its events still bubble here.
        if (!e.currentTarget.contains(e.target as Node)) return
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <button className={styles.open} onClick={onOpen} type="button" title={`Open ${project.name}`}>
        <span className={styles.thumbnail}>
          {project.thumbnail
            ? <ThumbnailImage image={project.thumbnail} alt="" className={styles.thumbImg} />
            : <span className={styles.thumbPlaceholder} />}
        </span>
      </button>
      <div className={styles.info}>
        <div className={styles.text}>
          <InlineName
            value={project.name}
            editing={renaming}
            onEditingChange={setRenaming}
            onCommit={onRename}
            label="Project name"
            className={styles.name}
            inputClassName={styles.nameInput}
          />
          <span className={styles.meta}>
            {project.width}×{project.height} · {dateStr}
          </span>
        </div>
        <button
          className={styles.menuBtn}
          type="button"
          aria-label={`Actions for ${project.name}`}
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setMenu({ x: r.left, y: r.bottom + 4 })
          }}
        >
          <Ellipsis size={16} strokeWidth={1.5} />
        </button>
      </div>
      {menu && <ContextMenu items={menuItems} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </article>
  )
})
