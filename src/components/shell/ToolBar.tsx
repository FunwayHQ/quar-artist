import React from 'react'
import {
  Brush,
  Eraser,
  Move,
  MousePointer2,
  Pipette,
  PaintBucket,
  Hand,
} from 'lucide-react'
import { useToolStore } from '@stores/toolStore.ts'
import type { ToolType } from '@app-types/engine.ts'
import styles from './ToolBar.module.css'

const tools: { id: ToolType; icon: typeof Brush; label: string }[] = [
  { id: 'brush', icon: Brush, label: 'Brush' },
  { id: 'eraser', icon: Eraser, label: 'Eraser' },
  { id: 'fill', icon: PaintBucket, label: 'Fill' },
  { id: 'eyedropper', icon: Pipette, label: 'Eyedropper' },
  { id: 'selection', icon: MousePointer2, label: 'Selection' },
  { id: 'transform', icon: Move, label: 'Transform' },
  { id: 'move', icon: Hand, label: 'Move' },
]

export function ToolBar() {
  const activeTool = useToolStore((s) => s.activeTool)
  const setTool = useToolStore((s) => s.setTool)

  return (
    <nav className={styles.toolBar} role="toolbar" aria-label="Drawing tools">
      {tools.map((tool, i) => (
        <React.Fragment key={tool.id}>
          {i === 4 && <div className={styles.divider} />}
          <button
            className={styles.tool}
            data-active={activeTool === tool.id}
            onClick={() => setTool(tool.id)}
            aria-label={tool.label}
            title={tool.label}
          >
            <tool.icon size={20} />
          </button>
        </React.Fragment>
      ))}
    </nav>
  )
}
