export interface ShortcutDef {
  id: string
  label: string
  category: 'tools' | 'view' | 'edit' | 'layers' | 'selection' | 'filters' | 'file'
  keys: string
  action: string
}

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  // ── Tools ──
  { id: 'tool-brush',       label: 'Brush',           category: 'tools', keys: 'b',     action: 'tool:brush' },
  { id: 'tool-eraser',      label: 'Eraser',          category: 'tools', keys: 'e',     action: 'tool:eraser' },
  { id: 'tool-fill',        label: 'Fill',            category: 'tools', keys: 'g',     action: 'tool:fill' },
  { id: 'tool-eyedropper',  label: 'Eyedropper',      category: 'tools', keys: 'i',     action: 'tool:eyedropper' },
  { id: 'tool-move',        label: 'Move',            category: 'tools', keys: 'v',     action: 'tool:move' },
  { id: 'tool-selection',   label: 'Selection',       category: 'tools', keys: 'm',     action: 'tool:selection' },
  { id: 'tool-transform',   label: 'Transform',       category: 'tools', keys: 't',     action: 'tool:transform' },
  { id: 'swap-colors',      label: 'Swap colors',     category: 'tools', keys: 'x',     action: 'swap-colors' },
  { id: 'reset-colors',     label: 'Reset colors',    category: 'tools', keys: 'd',     action: 'reset-colors' },
  { id: 'size-up',          label: 'Brush size +',     category: 'tools', keys: 'bracketright', action: 'size-up' },
  { id: 'size-down',        label: 'Brush size -',     category: 'tools', keys: 'bracketleft',  action: 'size-down' },
  { id: 'opacity-10',       label: 'Opacity 10%',     category: 'tools', keys: '1',     action: 'opacity:10' },
  { id: 'opacity-20',       label: 'Opacity 20%',     category: 'tools', keys: '2',     action: 'opacity:20' },
  { id: 'opacity-30',       label: 'Opacity 30%',     category: 'tools', keys: '3',     action: 'opacity:30' },
  { id: 'opacity-40',       label: 'Opacity 40%',     category: 'tools', keys: '4',     action: 'opacity:40' },
  { id: 'opacity-50',       label: 'Opacity 50%',     category: 'tools', keys: '5',     action: 'opacity:50' },
  { id: 'opacity-60',       label: 'Opacity 60%',     category: 'tools', keys: '6',     action: 'opacity:60' },
  { id: 'opacity-70',       label: 'Opacity 70%',     category: 'tools', keys: '7',     action: 'opacity:70' },
  { id: 'opacity-80',       label: 'Opacity 80%',     category: 'tools', keys: '8',     action: 'opacity:80' },
  { id: 'opacity-90',       label: 'Opacity 90%',     category: 'tools', keys: '9',     action: 'opacity:90' },
  { id: 'opacity-100',      label: 'Opacity 100%',    category: 'tools', keys: '0',     action: 'opacity:100' },

  // ── Edit ──
  { id: 'undo',             label: 'Undo',            category: 'edit', keys: 'ctrl+z',       action: 'undo' },
  { id: 'redo',             label: 'Redo',            category: 'edit', keys: 'ctrl+shift+z', action: 'redo' },
  { id: 'redo-y',           label: 'Redo',            category: 'edit', keys: 'ctrl+y',       action: 'redo' },

  // ── Selection ──
  { id: 'select-all',       label: 'Select All',      category: 'selection', keys: 'ctrl+a',       action: 'select-all' },
  { id: 'deselect',         label: 'Deselect',        category: 'selection', keys: 'ctrl+d',       action: 'deselect' },
  { id: 'invert-selection',  label: 'Invert Selection', category: 'selection', keys: 'ctrl+shift+i', action: 'invert-selection' },

  // ── View ──
  { id: 'toggle-panels',    label: 'Toggle panels',   category: 'view', keys: 'tab',          action: 'toggle-panels' },
  { id: 'fullscreen',       label: 'Fullscreen',      category: 'view', keys: 'f',            action: 'fullscreen' },
  { id: 'shortcuts-modal',  label: 'Shortcuts',       category: 'view', keys: 'shift+question', action: 'shortcuts-modal' },
  { id: 'fit-to-document',  label: 'Fit to document', category: 'view', keys: 'ctrl+0',       action: 'fit-to-document' },

  // ── File ──
  { id: 'export',           label: 'Export',           category: 'file', keys: 'ctrl+e',       action: 'export' },
  { id: 'new-project',      label: 'New project',      category: 'file', keys: 'ctrl+n',       action: 'new-project' },
  { id: 'save',             label: 'Save',             category: 'file', keys: 'ctrl+s',       action: 'save' },

  // ── Filters ──
  { id: 'curves',           label: 'Curves',           category: 'filters', keys: 'ctrl+m',    action: 'open-filter:curves' },

  // ── Layers ──
  { id: 'new-layer',        label: 'New layer',        category: 'layers', keys: 'ctrl+shift+n', action: 'new-layer' },
]

/** Shortcut category display labels */
export const CATEGORY_LABELS: Record<ShortcutDef['category'], string> = {
  tools: 'Tools',
  edit: 'Edit',
  selection: 'Selection',
  view: 'View',
  file: 'File',
  filters: 'Filters',
  layers: 'Layers',
}

/** Build a lookup map from key combo to shortcut definition. */
export function buildShortcutMap(shortcuts: ShortcutDef[]): Map<string, ShortcutDef> {
  const map = new Map<string, ShortcutDef>()
  for (const def of shortcuts) {
    map.set(def.keys, def)
  }
  return map
}

/** Get the shortcut keys string for a given tool id. */
export function getToolShortcutKeys(toolId: string): string | undefined {
  const def = DEFAULT_SHORTCUTS.find((s) => s.action === `tool:${toolId}`)
  return def?.keys
}
