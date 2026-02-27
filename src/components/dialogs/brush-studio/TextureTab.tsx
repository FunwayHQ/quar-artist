import type { BrushPreset, GrainTextureId } from '@app-types/brush.ts'
import styles from '../BrushStudio.module.css'

const GRAIN_TEXTURES: { id: GrainTextureId; label: string }[] = [
  { id: 'paper-fine', label: 'Paper Fine' },
  { id: 'paper-rough', label: 'Paper Rough' },
  { id: 'canvas-weave', label: 'Canvas Weave' },
  { id: 'noise-perlin', label: 'Perlin Noise' },
]

interface TextureTabProps {
  preset: BrushPreset
  onChange: (updates: Partial<BrushPreset>) => void
}

export function TextureTab({ preset, onChange }: TextureTabProps) {
  return (
    <div>
      <div className={styles.paramGroup}>
        <span className={styles.paramLabel}>Grain Texture</span>
        <div className={styles.textureGrid}>
          <button
            className={styles.textureBtn}
            data-active={!preset.grainTextureId}
            onClick={() => onChange({ grainTextureId: undefined })}
            type="button"
          >
            None
          </button>
          {GRAIN_TEXTURES.map((tex) => (
            <button
              key={tex.id}
              className={styles.textureBtn}
              data-active={preset.grainTextureId === tex.id}
              onClick={() => onChange({ grainTextureId: tex.id })}
              type="button"
            >
              {tex.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
