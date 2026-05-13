import { describe, expect, it } from 'vitest'
import type { ImageHistoryItem } from '@shared/types'
import { orderHandPosterDerivatives } from './hand-poster-history'

function item(input: Partial<ImageHistoryItem> & Pick<ImageHistoryItem, 'id' | 'prompt' | 'createdAt'>): ImageHistoryItem {
  return {
    workspaceType: 'hand-poster',
    conversationId: 'conversation-1',
    runId: null,
    model: 'gpt-image-2',
    ratio: '4:3',
    size: '2048x1536',
    quality: 'auto',
    requestIndex: null,
    durationMs: null,
    filePath: null,
    fileSizeBytes: null,
    status: 'succeeded',
    errorMessage: null,
    errorDetails: null,
    retryAttempt: 0,
    favorite: false,
    generationMode: 'text-to-image',
    referenceImages: [],
    ...input
  }
}

describe('orderHandPosterDerivatives', () => {
  it('keeps line art next to the selected confirmation draft', () => {
    const unrelated = item({ id: 'unrelated', prompt: '其他图片', createdAt: '2026-05-13T10:04:00.000Z', workspaceType: 'canvas' })
    const blackLine = item({
      id: 'black-line',
      prompt: '以参考确认稿为唯一底图，逐线描摹生成手抄报黑白无字线稿版。',
      createdAt: '2026-05-13T10:03:00.000Z',
      referenceImages: [{ id: 'ref-1', name: 'draft-a.png', mimeType: 'image/png', filePath: null, fileSizeBytes: 1, createdAt: '2026-05-13T10:01:00.000Z' }]
    })
    const lightLine = item({
      id: 'light-line',
      prompt: '以参考确认稿为唯一底图，逐线描摹生成手抄报浅线稿版。',
      createdAt: '2026-05-13T10:02:00.000Z',
      referenceImages: [{ id: 'ref-2', name: 'draft-a.png', mimeType: 'image/png', filePath: null, fileSizeBytes: 1, createdAt: '2026-05-13T10:01:00.000Z' }]
    })
    const draft = item({ id: 'draft-a', prompt: '生成一张适合3年级学生手抄报的横版A4彩色确认稿。', createdAt: '2026-05-13T10:01:00.000Z' })
    const otherDraft = item({ id: 'draft-b', prompt: '生成一张适合3年级学生手抄报的横版A4彩色确认稿。', createdAt: '2026-05-13T10:00:00.000Z' })

    const ordered = orderHandPosterDerivatives([unrelated, blackLine, lightLine, draft, otherDraft], (entry) => entry)

    expect(ordered.map((entry) => entry.id)).toEqual(['unrelated', 'draft-a', 'black-line', 'light-line', 'draft-b'])
  })
})
