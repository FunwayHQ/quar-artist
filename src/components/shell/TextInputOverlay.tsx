import { useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTextStore } from '@stores/textStore.ts'
import styles from './TextInputOverlay.module.css'

interface TextInputOverlayProps {
  onCommit: (text: string) => void
  onCancel: () => void
}

export function TextInputOverlay({ onCommit, onCancel }: TextInputOverlayProps) {
  const isEditing = useTextStore((s) => s.isEditing)
  const editPosition = useTextStore((s) => s.editPosition)
  const properties = useTextStore((s) => s.properties)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isEditing])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const text = textareaRef.current?.value ?? ''
        if (text.trim()) {
          onCommit(text)
        } else {
          onCancel()
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    },
    [onCommit, onCancel],
  )

  if (!isEditing || !editPosition) return null

  const fontString = `${properties.fontStyle === 'italic' ? 'italic' : 'normal'} ${properties.fontWeight === 'bold' ? 'bold' : 'normal'} ${properties.fontSize}px "${properties.fontFamily}"`

  return createPortal(
    <div className={styles.overlay}>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        style={{
          left: editPosition.screenX,
          top: editPosition.screenY,
          font: fontString,
          color: properties.color,
          textAlign: properties.textAlign,
        }}
        placeholder="Type here..."
        onKeyDown={handleKeyDown}
        data-testid="text-input-overlay"
      />
    </div>,
    document.body,
  )
}
