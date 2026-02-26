import { useProjectStore } from '@stores/projectStore.ts'
import { ProjectCard } from './ProjectCard.tsx'
import styles from './GalleryView.module.css'

interface GalleryViewProps {
  onOpenProject: (id: number) => void
  onNewProject: () => void
  onDeleteProject: (id: number) => void
  onDuplicateProject: (id: number) => void
  onRenameProject: (id: number, name: string) => void
}

export function GalleryView({
  onOpenProject,
  onNewProject,
  onDeleteProject,
  onDuplicateProject,
  onRenameProject,
}: GalleryViewProps) {
  const projects = useProjectStore((s) => s.projects)

  return (
    <div className={styles.gallery}>
      <header className={styles.header}>
        <h1 className={styles.title}>QUAR Artist</h1>
        <p className={styles.subtitle}>Your Projects</p>
      </header>
      <div className={styles.grid}>
        <button
          className={styles.newCard}
          onClick={onNewProject}
          type="button"
          title="New Project"
        >
          <span className={styles.newIcon}>+</span>
          <span className={styles.newLabel}>New Project</span>
        </button>
        {projects.map((p) => (
          <ProjectCard
            key={p.id}
            id={p.id!}
            name={p.name}
            width={p.width}
            height={p.height}
            updatedAt={p.updatedAt}
            onClick={() => onOpenProject(p.id!)}
            onDelete={() => onDeleteProject(p.id!)}
            onDuplicate={() => onDuplicateProject(p.id!)}
            onRename={(name) => onRenameProject(p.id!, name)}
          />
        ))}
      </div>
    </div>
  )
}
