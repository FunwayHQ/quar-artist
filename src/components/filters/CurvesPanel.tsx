import { useState } from 'react'
import type { CurvesParams, CurveChannel } from '@app-types/filter.ts'
import { CurvesEditor } from './CurvesEditor.tsx'
import styles from './CurvesPanel.module.css'

interface CurvesPanelProps {
  params: CurvesParams
  onChange: (params: CurvesParams) => void
}

const CHANNELS: { key: CurveChannel; label: string; color: string }[] = [
  { key: 'rgb', label: 'RGB', color: '#F59E0B' },
  { key: 'red', label: 'R', color: '#EF4444' },
  { key: 'green', label: 'G', color: '#22C55E' },
  { key: 'blue', label: 'B', color: '#3B82F6' },
]

export function CurvesPanel({ params, onChange }: CurvesPanelProps) {
  const [activeChannel, setActiveChannel] = useState<CurveChannel>('rgb')

  const channelInfo = CHANNELS.find((c) => c.key === activeChannel) ?? CHANNELS[0]

  return (
    <div className={styles.container}>
      <div className={styles.tabs}>
        {CHANNELS.map(({ key, label }) => (
          <button
            key={key}
            className={styles.tab}
            data-active={activeChannel === key}
            onClick={() => setActiveChannel(key)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <CurvesEditor
        points={params.channels[activeChannel]}
        channelColor={channelInfo.color}
        onChange={(points) => {
          onChange({
            ...params,
            channels: { ...params.channels, [activeChannel]: points },
          })
        }}
      />
    </div>
  )
}
