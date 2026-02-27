import type { BrushPreset } from '../types/brush.ts'
import { getDB } from '../db/schema.ts'

const SETTINGS_KEY = 'customBrushPresets'

// ── IndexedDB persistence ──

export async function loadCustomPresets(): Promise<BrushPreset[]> {
  try {
    const db = await getDB()
    const record = await db.get('settings', SETTINGS_KEY)
    if (!record) return []
    return JSON.parse(record.value) as BrushPreset[]
  } catch {
    return []
  }
}

export async function saveCustomPresets(presets: BrushPreset[]): Promise<void> {
  try {
    const db = await getDB()
    await db.put('settings', { key: SETTINGS_KEY, value: JSON.stringify(presets) })
  } catch (err) {
    console.error('Failed to save custom brush presets:', err)
  }
}

// ── .qbrush file export/import ──

interface QBrushFile {
  version: 1
  preset: BrushPreset
}

export function exportBrushPreset(preset: BrushPreset): void {
  const data: QBrushFile = { version: 1, preset }
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${preset.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.qbrush`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importBrushPreset(): Promise<BrushPreset | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.qbrush,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      try {
        const text = await file.text()
        const data = JSON.parse(text) as QBrushFile
        if (data.version !== 1 || !data.preset?.id || !data.preset?.name) {
          console.error('Invalid .qbrush file format')
          resolve(null)
          return
        }
        // Assign a new ID to avoid collisions
        const preset: BrushPreset = {
          ...data.preset,
          id: `imported-${Date.now()}`,
        }
        resolve(preset)
      } catch (err) {
        console.error('Failed to parse .qbrush file:', err)
        resolve(null)
      }
    }
    input.click()
  })
}
