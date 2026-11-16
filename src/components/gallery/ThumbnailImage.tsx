import { useEffect, useRef, type ImgHTMLAttributes } from 'react'
import type { StoredImage } from '../../types/project.ts'

interface ThumbnailImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  image: StoredImage
}

/**
 * A stored image, shown through an object URL that lives as long as the
 * image shows it. The URL is set on the element directly, so React StrictMode
 * running the effect twice can't revoke a URL still in use.
 */
export function ThumbnailImage({ image, alt, ...props }: ThumbnailImageProps) {
  const ref = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const img = ref.current
    if (!img || typeof URL.createObjectURL !== 'function') return
    const url = URL.createObjectURL(new Blob([image.data], { type: image.type }))
    img.src = url
    return () => {
      img.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [image])

  return <img ref={ref} alt={alt} draggable={false} {...props} />
}
