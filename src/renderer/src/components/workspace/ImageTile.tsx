import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react'
import { Check, Copy, Download, Heart, RefreshCcw, RotateCcw, SquarePen, Trash2 } from 'lucide-react'
import type { ImageHistoryItem } from '@shared/types'
import { useAppStore } from '@renderer/store/app-store'
import { PreviewModal } from '@renderer/components/preview/PreviewModal'
import { shouldShowFailedImageRetryChip } from '@renderer/generation-retry-display'
import { ErrorDetailsModal } from './ErrorDetailsModal'

export function ImageTile({
  item,
  previewItems,
  selectable = false,
  selected = false,
  showReuseAction = false,
  lockAspectRatio = false,
  onSelectedChange
}: {
  item: ImageHistoryItem
  previewItems: ImageHistoryItem[]
  selectable?: boolean
  selected?: boolean
  showReuseAction?: boolean
  lockAspectRatio?: boolean
  onSelectedChange?: (selected: boolean) => void
}): JSX.Element {
  const { addHistoryAsReference, deleteHistory, retryFailedImage, toggleFavorite, reuseHistory, notify } = useAppStore()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [errorDetailsOpen, setErrorDetailsOpen] = useState(false)
  const tileRef = useRef<HTMLElement | null>(null)
  const [lockedHeight, setLockedHeight] = useState<number | null>(null)
  const src = useMemo(() => (item.status === 'succeeded' ? window.canvasForge.image.url(item.id) : ''), [item.id, item.status])
  const openPreview = () => {
    if (item.status === 'succeeded') setPreviewOpen(true)
  }
  const tileClassName = `art-card ${item.status === 'failed' ? 'failed' : 'image-card'}${selected ? ' selected' : ''}${selectable ? ' selectable' : ''}`
  const tileStyle = useMemo<CSSProperties | undefined>(() => (
    lockAspectRatio && lockedHeight != null ? { height: `${lockedHeight}px` } : undefined
  ), [lockAspectRatio, lockedHeight])
  const showFailedRetryChip = shouldShowFailedImageRetryChip(item.retryAttempt)
  const selectionControl = selectable ? (
    <button
      type="button"
      className={`tile-select ${selected ? 'selected' : ''}`}
      title={selected ? '取消选择' : '选择'}
      onClick={(event) => {
        event.stopPropagation()
        onSelectedChange?.(!selected)
      }}
    >
      {selected ? <Check size={13} /> : null}
    </button>
  ) : null

  useEffect(() => {
    if (!lockAspectRatio) return
    const element = tileRef.current
    if (!element) return

    const updateHeight = () => {
      const width = element.getBoundingClientRect().width
      if (width > 0) setLockedHeight(Math.round(width * 4 / 3))
    }
    updateHeight()

    const ResizeObserverCtor = window.ResizeObserver
    if (!ResizeObserverCtor) return

    const observer = new ResizeObserverCtor(updateHeight)
    observer.observe(element)
    return () => observer.disconnect()
  }, [lockAspectRatio])

  if (item.status === 'failed') {
    return (
      <article
        ref={tileRef}
        className={tileClassName}
        style={tileStyle}
        role="button"
        tabIndex={0}
        title="点击查看错误详情"
        onClick={() => setErrorDetailsOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setErrorDetailsOpen(true)
          }
        }}
      >
        {selectionControl}
        <div className="art-tools">
          <button
            title="重试生成"
            onClick={(event) => {
              event.stopPropagation()
              void retryFailedImage(item)
            }}
          >
            <RefreshCcw size={14} />
          </button>
          <button
            title="删除"
            onClick={(event) => {
              event.stopPropagation()
              void deleteHistory(item.id)
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className="fail-content">
          <strong>{item.errorMessage || '生成失败'}</strong>
          {showFailedRetryChip ? <span className="retry-chip">{`重试第 ${item.retryAttempt} 次`}</span> : null}
        </div>
        {errorDetailsOpen ? <ErrorDetailsModal item={item} onClose={() => setErrorDetailsOpen(false)} /> : null}
      </article>
    )
  }

  return (
    <article
      ref={tileRef}
      className={tileClassName}
      style={tileStyle}
      role="button"
      tabIndex={0}
      onClick={openPreview}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openPreview()
        }
      }}
    >
      {selectionControl}
      <img src={src} alt={item.prompt} />
      <div className="art-tools">
        <button
          title="复制"
          onClick={(event) => {
            event.stopPropagation()
            notify('正在复制图片...')
            void window.canvasForge.image.copy(item.id)
              .then(() => notify('已复制到剪贴板'))
              .catch((error) => notify(error instanceof Error ? `复制失败：${error.message}` : '复制失败'))
          }}
        >
          <Copy size={14} />
        </button>
        <button
          title="下载"
          onClick={(event) => {
            event.stopPropagation()
            void window.canvasForge.image.download(item.id).then((path) => path && notify('已保存图片'))
          }}
        >
          <Download size={14} />
        </button>
        <button
          title="收藏"
          onClick={(event) => {
            event.stopPropagation()
            void toggleFavorite(item)
          }}
        >
          <Heart className={item.favorite ? 'filled' : ''} size={14} />
        </button>
        <button
          title="编辑"
          onClick={(event) => {
            event.stopPropagation()
            void addHistoryAsReference(item.id)
          }}
        >
          <SquarePen size={14} />
        </button>
        {showReuseAction ? (
          <button
            title="回填参数"
            onClick={(event) => {
              event.stopPropagation()
              void reuseHistory(item)
            }}
          >
            <RotateCcw size={14} />
          </button>
        ) : null}
        <button
          title="删除"
          onClick={(event) => {
            event.stopPropagation()
            void deleteHistory(item.id)
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
      {previewOpen ? <PreviewModal initialItem={item} items={previewItems} onClose={() => setPreviewOpen(false)} /> : null}
    </article>
  )
}
