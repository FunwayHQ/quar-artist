import { useMemo, useEffect, useRef } from 'react'
import styles from './TimelapseExportDialog.module.css'

interface TimelapseExportDialogProps {
  open: boolean
  videoBlob: Blob
  frameCount: number
  onDownload: () => void
  onDiscard: () => void
  onClose: () => void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function TimelapseExportDialog({
  open,
  videoBlob,
  frameCount,
  onDownload,
  onDiscard,
  onClose,
}: TimelapseExportDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoUrl = useMemo(() => URL.createObjectURL(videoBlob), [videoBlob])

  useEffect(() => {
    return () => URL.revokeObjectURL(videoUrl)
  }, [videoUrl])

  if (!open) return null

  // Estimate duration: ~10fps playback assumption
  const estimatedDuration = frameCount > 0 ? (frameCount / 10).toFixed(1) : '0'

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className={styles.overlay} onKeyDown={(e) => e.stopPropagation()} onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Timelapse Export">
        <h2 className={styles.title}>Timelapse Recording</h2>

        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          className={styles.videoPreview}
          src={videoUrl}
          controls
          autoPlay
          loop
          data-testid="timelapse-video"
        />

        <div className={styles.details}>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Frames</span>
            <span className={styles.detailValue}>{frameCount}</span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Duration (est.)</span>
            <span className={styles.detailValue}>{estimatedDuration}s</span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>File Size</span>
            <span className={styles.detailValue}>{formatFileSize(videoBlob.size)}</span>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.discardBtn} onClick={onDiscard} type="button">
            Discard
          </button>
          <button className={styles.downloadBtn} onClick={onDownload} type="button" data-testid="timelapse-download">
            Download WebM
          </button>
        </div>
      </div>
    </div>
  )
}
