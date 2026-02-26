import styles from './ProjectCard.module.css'

interface ProjectCardProps {
  id: number
  name: string
  width: number
  height: number
  updatedAt: Date
  thumbnailUrl?: string
  onClick: () => void
  onDelete: () => void
  onDuplicate: () => void
  onRename: (name: string) => void
}

export function ProjectCard({
  name,
  width,
  height,
  updatedAt,
  thumbnailUrl,
  onClick,
  onDelete,
  onDuplicate,
}: ProjectCardProps) {
  const dateStr = updatedAt.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div
      className={styles.card}
      onClick={onClick}
      title={`Open ${name}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick() }}
    >
      <div className={styles.thumbnail}>
        {thumbnailUrl
          ? <img src={thumbnailUrl} alt={name} className={styles.thumbImg} />
          : <div className={styles.thumbPlaceholder} />}
      </div>
      <div className={styles.info}>
        <span className={styles.name}>{name}</span>
        <span className={styles.meta}>
          {width}×{height} · {dateStr}
        </span>
      </div>
      <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
        <button className={styles.actionBtn} onClick={onDuplicate} title="Duplicate" type="button">⧉</button>
        <button className={styles.actionBtn} onClick={onDelete} title="Delete" type="button">✕</button>
      </div>
    </div>
  )
}
