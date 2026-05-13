import type { ImageHistoryItem } from '@shared/types'

const imageExtensionPattern = /\.(png|jpe?g|webp)$/i

function isHandPosterDraft(item: ImageHistoryItem): boolean {
  return item.workspaceType === 'hand-poster' && item.prompt.includes('彩色确认稿')
}

function isHandPosterLineArt(item: ImageHistoryItem): boolean {
  return item.workspaceType === 'hand-poster'
    && !item.prompt.includes('彩色确认稿')
    && item.prompt.includes('线稿版')
}

function referenceSourceCandidates(item: ImageHistoryItem): string[] {
  return item.referenceImages.flatMap((reference) => {
    const names = [reference.name]
    if (reference.filePath) names.push(reference.filePath.split(/[/\\]/).pop() || '')
    return names
      .filter(Boolean)
      .map((name) => name.replace(imageExtensionPattern, ''))
  })
}

function lineArtVariantOrder(item: ImageHistoryItem): number {
  if (item.prompt.includes('黑白')) return 0
  if (item.prompt.includes('浅线稿')) return 1
  return 2
}

function compareLineArt(left: ImageHistoryItem, right: ImageHistoryItem): number {
  const variantOrder = lineArtVariantOrder(left) - lineArtVariantOrder(right)
  if (variantOrder !== 0) return variantOrder
  return left.createdAt.localeCompare(right.createdAt)
}

export function orderHandPosterDerivatives<T>(
  entries: T[],
  getItem: (entry: T) => ImageHistoryItem | null
): T[] {
  const parentIds = new Set(
    entries
      .map(getItem)
      .filter((item): item is ImageHistoryItem => item != null && isHandPosterDraft(item))
      .map((item) => item.id)
  )
  if (parentIds.size === 0) return entries

  const childrenByParent = new Map<string, T[]>()
  const groupedChildEntries = new Set<T>()
  for (const entry of entries) {
    const item = getItem(entry)
    if (!item || !isHandPosterLineArt(item)) continue
    const parentId = referenceSourceCandidates(item).find((candidate) => parentIds.has(candidate))
    if (!parentId) continue
    const siblings = childrenByParent.get(parentId) || []
    siblings.push(entry)
    childrenByParent.set(parentId, siblings)
    groupedChildEntries.add(entry)
  }

  if (groupedChildEntries.size === 0) return entries

  const ordered: T[] = []
  for (const entry of entries) {
    if (groupedChildEntries.has(entry)) continue
    ordered.push(entry)
    const item = getItem(entry)
    if (!item) continue
    const children = childrenByParent.get(item.id)
    if (!children) continue
    ordered.push(...children.sort((left, right) => {
      const leftItem = getItem(left)
      const rightItem = getItem(right)
      if (!leftItem || !rightItem) return 0
      return compareLineArt(leftItem, rightItem)
    }))
  }
  return ordered
}
