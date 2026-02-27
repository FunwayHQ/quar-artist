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
import { Tooltip } from '@components/ui/Tooltip.tsx'
import { getToolShortcutKeys } from '@hooks/shortcuts/shortcutRegistry.ts'
import { formatShortcutDisplay } from '@hooks/shortcuts/keyMatcher.ts'
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
      {tools.map((tool, i) => {
        const shortcutKeys = getToolShortcutKeys(tool.id)
        const shortcutDisplay = shortcutKeys ? formatShortcutDisplay(shortcutKeys) : undefined
        return (
          <React.Fragment key={tool.id}>
            {i === 4 && <div className={styles.divider} />}
            <Tooltip content={tool.label} shortcut={shortcutDisplay} position="right">
              <button
                className={styles.tool}
                data-active={activeTool === tool.id}
                onClick={() => setTool(tool.id)}
                aria-label={tool.label}
                data-testid={`tool-${tool.id}`}
              >
                <tool.icon size={20} />
              </button>
            </Tooltip>
          </React.Fragment>
        )
      })}
    </nav>
  )
}
