import { useRef, useState, type DragEvent } from 'react'
import { ChevronLeft, Upload } from 'lucide-react'
import { useProjectStore } from '@stores/projectStore.ts'
import type { ProjectRecord } from '../../db/schema.ts'
import type { GallerySort } from '../../types/project.ts'
import { ProjectCard } from './ProjectCard.tsx'
import { StackCard } from './StackCard.tsx'
import { MoveToStackDialog } from './MoveToStackDialog.tsx'
import { sortProjects, stackEntries, unstackedProjects } from './gallerySort.ts'
import styles from './GalleryView.module.css'

/** What the Gallery asks the app to do. ProjectService implements most of it. */
export interface GalleryActions {
  openProject: (id: string) => void
  /** Opens the New Project dialog. */
  newProject: () => void
  renameProject: (id: string, name: string) => void
  duplicateProject: (id: string) => void
  deleteProject: (id: string) => void
  moveToStack: (projectId: string, stackId: string | null) => void
  createStack: (name: string, projectIds: string[]) => void
  renameStack: (id: string, name: string) => void
  unstack: (id: string) => void
  /** Show a stack's projects, or the top level with null. */
  openStack: (id: string | null) => void
  setSort: (sort: GallerySort) => void
  importFiles: (files: File[]) => void
}

const SORT_LABELS: Record<GallerySort, string> = {
  updated: 'Last modified',
  created: 'Date created',
  name: 'Name',
}

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')

export function GalleryView({ actions }: { actions: GalleryActions }) {
  const projects = useProjectStore((s) => s.projects)
  const stacks = useProjectStore((s) => s.stacks)
  const sort = useProjectStore((s) => s.gallerySort)
  const openStackId = useProjectStore((s) => s.openStackId)
  const lastProjectId = useProjectStore((s) => s.lastProjectId)
  const [moving, setMoving] = useState<ProjectRecord | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const openStack = stacks.find((s) => s.id === openStackId) ?? null
  const shown = sortProjects(
    openStack ? projects.filter((p) => p.stackId === openStack.id) : unstackedProjects(projects, stacks),
    sort,
  )
  const shownStacks = openStack ? [] : stackEntries(stacks, projects, sort)
  const continueProject = openStack ? null : projects.find((p) => p.id === lastProjectId) ?? null

  return (
    <div
      className={styles.gallery}
      data-dragging={dragging || undefined}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setDragging(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length > 0) actions.importFiles(files)
      }}
    >
      <header className={styles.header}>
        <h1 className={styles.title}>
          <img src="/logo.svg" alt="QUAR Artist" className={styles.logo} />
        </h1>
        <p className={styles.subtitle}>Your Projects</p>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.toolbarStart}>
          {openStack ? (
            <nav className={styles.breadcrumb} aria-label="Gallery location">
              <button className={styles.backBtn} type="button" onClick={() => actions.openStack(null)}>
                <ChevronLeft size={16} strokeWidth={1.5} />
                Gallery
              </button>
              <span className={styles.crumbSep}>/</span>
              <span className={styles.crumb}>{openStack.name}</span>
            </nav>
          ) : continueProject && (
            <button
              className={styles.continueBtn}
              type="button"
              onClick={() => actions.openProject(continueProject.id)}
            >
              Continue {continueProject.name}
            </button>
          )}
        </div>
        <div className={styles.toolbarEnd}>
          <label className={styles.sortLabel}>
            Sort
            <select
              className={styles.sortSelect}
              value={sort}
              onChange={(e) => actions.setSort(e.target.value as GallerySort)}
              aria-label="Sort projects"
            >
              {(Object.keys(SORT_LABELS) as GallerySort[]).map((key) => (
                <option key={key} value={key}>{SORT_LABELS[key]}</option>
              ))}
            </select>
          </label>
          <button className={styles.importBtn} type="button" onClick={() => fileInput.current?.click()}>
            <Upload size={14} strokeWidth={1.5} />
            Import…
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept=".qart,.psd,image/*"
            aria-label="Import files"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (files.length > 0) actions.importFiles(files)
            }}
          />
        </div>
      </div>

      <div className={styles.grid}>
        <button
          className={styles.newCard}
          onClick={actions.newProject}
          type="button"
          title="New Project"
        >
          <span className={styles.newIcon}>+</span>
          <span className={styles.newLabel}>New Project</span>
        </button>
        {shownStacks.map((entry) => (
          <StackCard
            key={entry.stack.id}
            entry={entry}
            onOpen={() => actions.openStack(entry.stack.id)}
            onRename={(name) => actions.renameStack(entry.stack.id, name)}
            onUnstack={() => actions.unstack(entry.stack.id)}
          />
        ))}
        {shown.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            onOpen={() => actions.openProject(p.id)}
            onRename={(name) => actions.renameProject(p.id, name)}
            onDuplicate={() => actions.duplicateProject(p.id)}
            onDelete={() => actions.deleteProject(p.id)}
            onMoveToStack={() => setMoving(p)}
            onRemoveFromStack={openStack ? () => actions.moveToStack(p.id, null) : undefined}
          />
        ))}
      </div>
      {openStack && shown.length === 0 && <p className={styles.empty}>This stack is empty.</p>}

      {dragging && (
        <div className={styles.dropOverlay} aria-hidden="true">
          Drop .qart files or images to add them as projects
        </div>
      )}

      {moving && (
        <MoveToStackDialog
          project={moving}
          stacks={stacks}
          onMove={(stackId) => {
            actions.moveToStack(moving.id, stackId)
            setMoving(null)
          }}
          onCreate={(name) => {
            actions.createStack(name, [moving.id])
            setMoving(null)
          }}
          onClose={() => setMoving(null)}
        />
      )}
    </div>
  )
}
