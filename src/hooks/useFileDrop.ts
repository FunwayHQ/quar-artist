import { useEffect } from 'react'

/** Whether a drag carries files. */
export function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

/**
 * Files dropped anywhere on the page never open in the browser in the app's
 * place (plan M1.5). `onDrop` gets the files of every drop that no drop zone
 * on the page (the Gallery's) took; without it, files can't be dropped.
 */
export function useFileDrop(onDrop: ((files: File[]) => void) | null): void {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = onDrop ? 'copy' : 'none'
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return
      e.preventDefault()
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (onDrop && files.length > 0) onDrop(files)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [onDrop])
}
