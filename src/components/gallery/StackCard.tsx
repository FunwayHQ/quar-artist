import { memo, useState } from 'react'
import { Ellipsis } from 'lucide-react'
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu.tsx'
import { ThumbnailImage } from './ThumbnailImage.tsx'
import { InlineName } from './InlineName.tsx'
import type { StackEntry } from './gallerySort.ts'
import cardStyles from './ProjectCard.module.css'
import styles from './StackCard.module.css'

interface StackCardProps {
  entry: StackEntry
  onOpen: () => void
  onRename: (name: string) => void
  /** Dissolves the stack, moving its projects to the top level. */
  onUnstack: () => void
}

/** A Gallery stack: up to four of its projects' thumbnails, its name and size. */
export const StackCard = memo(function StackCard({ entry, onOpen, onRename, onUnstack }: StackCardProps) {
  const [renaming, setRenaming] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const { stack, projects } = entry
  const count = projects.length

  const menuItems: ContextMenuItem[] = [
    { label: 'Rename', action: () => setRenaming(true) },
    { label: 'Unstack', action: onUnstack },
  ]

  return (
    <article
      className={cardStyles.card}
      aria-label={`Stack ${stack.name}`}
      onContextMenu={(e) => {
        // The menu is portalled out of the card, but its events still bubble here.
        if (!e.currentTarget.contains(e.target as Node)) return
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <button className={cardStyles.open} onClick={onOpen} type="button" title={`Open stack ${stack.name}`}>
        <span className={styles.mosaic}>
          {[0, 1, 2, 3].map((i) => {
            const thumb = projects[i]?.thumbnail
            return thumb
              ? <ThumbnailImage key={i} image={thumb} alt="" className={styles.tile} />
              : <span key={i} className={styles.empty} />
          })}
        </span>
      </button>
      <div className={cardStyles.info}>
        <div className={cardStyles.text}>
          <InlineName
            value={stack.name}
            editing={renaming}
            onEditingChange={setRenaming}
            onCommit={onRename}
            label="Stack name"
            className={cardStyles.name}
            inputClassName={cardStyles.nameInput}
          />
          <span className={cardStyles.meta}>
            {count} {count === 1 ? 'project' : 'projects'}
          </span>
        </div>
        <button
          className={cardStyles.menuBtn}
          type="button"
          aria-label={`Actions for stack ${stack.name}`}
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
