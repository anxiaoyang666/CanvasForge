import type { ImageHistoryItem } from '@shared/types'

export type GalleryDownloadPlan = {
  ids: string[]
  skipped: number
}

export function getGalleryDownloadPlan(items: ImageHistoryItem[]): GalleryDownloadPlan {
  const ids = items.filter((item) => item.status === 'succeeded').map((item) => item.id)
  return {
    ids,
    skipped: items.length - ids.length
  }
}
