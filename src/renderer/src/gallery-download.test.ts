import { describe, expect, it } from 'vitest'
import type { ImageHistoryItem } from '@shared/types'
import { getGalleryDownloadPlan } from './gallery-download'

function historyItem(id: string, status: ImageHistoryItem['status']): ImageHistoryItem {
  return {
    id,
    conversationId: 'conversation-1',
    runId: 'run-1',
    requestIndex: 0,
    workspaceType: 'canvas',
    prompt: 'test prompt',
    model: 'gpt-image-2',
    ratio: '1:1',
    size: '1024x1024',
    quality: 'auto',
    status,
    filePath: status === 'succeeded' ? `/tmp/${id}.png` : null,
    fileSizeBytes: status === 'succeeded' ? 1024 : null,
    errorMessage: status === 'failed' ? 'failed' : null,
    errorDetails: null,
    durationMs: null,
    retryAttempt: 0,
    favorite: false,
    generationMode: 'text-to-image',
    referenceImages: [],
    createdAt: '2026-05-19T00:00:00.000Z'
  }
}

describe('getGalleryDownloadPlan', () => {
  it('downloads only succeeded history items and reports skipped failures', () => {
    const plan = getGalleryDownloadPlan([
      historyItem('ok-1', 'succeeded'),
      historyItem('failed-1', 'failed'),
      historyItem('ok-2', 'succeeded')
    ])

    expect(plan).toEqual({
      ids: ['ok-1', 'ok-2'],
      skipped: 1
    })
  })
})
