import { useRef } from 'react'

interface InlineNameProps {
  value: string
  editing: boolean
  onEditingChange: (editing: boolean) => void
  /** Called with the new name when it changed and isn't blank. */
  onCommit: (name: string) => void
  /** Accessible name of the text field, such as "Project name". */
  label: string
  className?: string
  inputClassName?: string
}

/**
 * A name that becomes a text field to rename it: on double-click, or when the
 * parent sets `editing`. Enter or leaving the field keeps the new name, Escape
 * keeps the old one.
 */
export function InlineName({
  value,
  editing,
  onEditingChange,
  onCommit,
  label,
  className,
  inputClassName,
}: InlineNameProps) {
  const cancelled = useRef(false)

  if (!editing) {
    return (
      <span className={className} onDoubleClick={() => onEditingChange(true)} title={value}>
        {value}
      </span>
    )
  }

  return (
    <input
      className={inputClassName}
      defaultValue={value}
      aria-label={label}
      ref={(input) => {
        if (input && document.activeElement !== input) {
          input.focus()
          input.select()
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          cancelled.current = true
          e.currentTarget.blur()
        }
      }}
      onBlur={(e) => {
        const name = e.currentTarget.value.trim()
        const keep = !cancelled.current
        cancelled.current = false
        onEditingChange(false)
        if (keep && name && name !== value) onCommit(name)
      }}
    />
  )
}
