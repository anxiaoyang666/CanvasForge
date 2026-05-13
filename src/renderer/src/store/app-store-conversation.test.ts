import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Conversation, ImageHistoryItem } from '@shared/types'
import { useAppStore } from './app-store'

describe('app store conversation defaults', () => {
  const originalWindow = globalThis.window

  afterEach(() => {
    useAppStore.setState({
      conversations: [],
      activeConversationId: null,
      runsByConversation: {},
      toast: null
    })
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true
    })
    vi.restoreAllMocks()
  })

  it('creates a new conversation with the active conversation image settings', async () => {
    const active = createConversation({ id: 'old', ratio: '9:16', size: '2160x3840', quality: 'medium' })
    const created = createConversation({ id: 'new', ratio: '9:16', size: '2160x3840', quality: 'medium' })
    const create = vi.fn(() => Promise.resolve(created))
    installWindow({ create })
    useAppStore.setState({
      conversations: [active],
      activeConversationId: active.id,
      runsByConversation: { [active.id]: [] },
      toast: null
    })

    await useAppStore.getState().createConversation()

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      ratio: '9:16',
      size: '2160x3840',
      quality: 'medium',
      model: 'gpt-image-2',
      n: 1,
      outputFormat: 'png',
      outputCompression: null,
      background: 'auto',
      moderation: 'auto',
      stream: false,
      partialImages: 0,
      inputFidelity: null,
      maxRetries: 0,
      generationTimeoutSeconds: 300,
      autoSaveHistory: true,
      keepFailureDetails: false
    }))
    expect(useAppStore.getState().activeConversationId).toBe('new')
    expect(useAppStore.getState().conversations[0]).toMatchObject({
      id: 'new',
      ratio: '9:16',
      size: '2160x3840',
      quality: 'medium'
    })
  })

  it('uses the standard resolution when changing ratios without an explicit size', async () => {
    const active = createConversation({ id: 'c1', ratio: '16:9', size: '3840x2160', quality: 'high' })
    const update = vi.fn((_id: string, input: Partial<Conversation>) => Promise.resolve({ ...active, ...input }))
    installWindow({ update })
    useAppStore.setState({
      conversations: [active],
      activeConversationId: active.id,
      toast: null
    })

    await useAppStore.getState().updateActiveConversation({ ratio: '9:16' })

    expect(update).toHaveBeenCalledWith(active.id, { ratio: '9:16', size: '1008x1792' })
    expect(useAppStore.getState().conversations[0]).toMatchObject({
      ratio: '9:16',
      size: '1008x1792'
    })
  })

  it('renames a conversation through the persistence API', async () => {
    const active = createConversation({ id: 'c1', title: '旧名称' })
    const update = vi.fn((_id: string, input: Partial<Conversation>) => Promise.resolve({ ...active, ...input }))
    installWindow({ update })
    useAppStore.setState({
      conversations: [active],
      activeConversationId: active.id,
      toast: null
    })

    await useAppStore.getState().renameConversation(active.id, '  新名称  ')

    expect(update).toHaveBeenCalledWith(active.id, { title: '新名称' })
    expect(useAppStore.getState().conversations[0].title).toBe('新名称')
  })

  it('retries a failed image with the original image request fields', async () => {
    const active = createConversation({ id: 'c1', maxRetries: 2, outputFormat: 'webp', outputCompression: 80 })
    const failed = createHistoryItem({
      id: 'h1',
      conversationId: active.id,
      prompt: '失败提示词',
      model: 'gpt-image-2',
      ratio: '3:4',
      size: '768x1024',
      quality: 'high'
    })
    const generate = vi.fn(() => Promise.resolve({
      run: { id: 'r2', durationMs: 123 },
      items: []
    }))
    const runs = vi.fn(() => Promise.resolve([]))
    const historyList = vi.fn(() => Promise.resolve([]))
    installWindow({ generate, runs, historyList })
    useAppStore.setState({
      conversations: [active],
      activeConversationId: active.id,
      settings: { baseURL: 'https://api.openai.com', apiKeyStored: true, defaultModel: 'gpt-image-2', promptModel: 'gpt-5.4', insecureStorage: false },
      history: [failed],
      runsByConversation: { [active.id]: [] },
      generatingByConversation: {},
      generationStartedAtByConversation: {},
      removedGenerationIndexesByRunId: {},
      query: '',
      sort: 'newest',
      favoritesOnly: false,
      toast: null
    })

    await useAppStore.getState().retryFailedImage(failed)

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: active.id,
      prompt: '失败提示词',
      model: 'gpt-image-2',
      ratio: '3:4',
      size: '768x1024',
      quality: 'high',
      n: 1,
      outputFormat: 'webp',
      outputCompression: 80,
      maxRetries: 2
    }))
    expect(runs).toHaveBeenCalledWith(active.id)
    expect(historyList).toHaveBeenCalled()
  })
})

function installWindow(conversation: {
  create?: ReturnType<typeof vi.fn>
  update?: ReturnType<typeof vi.fn>
  generate?: ReturnType<typeof vi.fn>
  runs?: ReturnType<typeof vi.fn>
  historyList?: ReturnType<typeof vi.fn>
}): void {
  Object.defineProperty(globalThis, 'window', {
    value: {
      setTimeout: globalThis.setTimeout,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
      canvasForge: {
        conversation: {
          ...conversation,
          runs: conversation.runs
        },
        image: {
          generate: conversation.generate
        },
        history: {
          list: conversation.historyList
        }
      }
    },
    configurable: true
  })
}

function createConversation(input: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    title: '新会话',
    draftPrompt: '',
    model: 'gpt-image-2',
    ratio: '1:1',
    size: '1024x1024',
    quality: 'auto',
    n: 1,
    outputFormat: 'png',
    outputCompression: null,
    background: 'auto',
    moderation: 'auto',
    stream: false,
    partialImages: 0,
    inputFidelity: null,
    maxRetries: 0,
    generationTimeoutSeconds: 300,
    autoSaveHistory: true,
    keepFailureDetails: false,
    referenceImages: [],
    createdAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z',
    ...input
  }
}

function createHistoryItem(input: Partial<ImageHistoryItem> = {}): ImageHistoryItem {
  return {
    id: 'h1',
    conversationId: 'c1',
    runId: 'r1',
    prompt: 'prompt',
    model: 'gpt-image-2',
    ratio: '1:1',
    size: '1024x1024',
    quality: 'auto',
    requestIndex: 0,
    durationMs: null,
    filePath: null,
    fileSizeBytes: null,
    status: 'failed',
    errorMessage: 'failed',
    errorDetails: null,
    retryAttempt: 0,
    favorite: false,
    generationMode: 'text-to-image',
    referenceImages: [],
    createdAt: '2026-05-10T00:00:00.000Z',
    ...input
  }
}
