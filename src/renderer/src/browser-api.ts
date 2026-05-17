import type {
  BatchDownloadResult,
  ConversationCreateInput,
  ConversationUpdate,
  GenerateImageInput,
  HistoryListOptions,
  CanvasForgeAPI,
  AccessLoginInput,
  AccessPasswordUpdate,
  BackupManifest,
  PromptAssistInput,
  PromptTemplate,
  PromptTemplateInput,
  ProviderModelsInput,
  ProviderSettingsUpdate,
  ReferenceImageImportFile
} from '@shared/types'

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null

export function installBrowserCanvasForgeAPI(): void {
  if (window.canvasForge) return
  window.canvasForge = createBrowserCanvasForgeAPI()
}

function createBrowserCanvasForgeAPI(): CanvasForgeAPI {
  return {
    access: {
      status: () => request('/api/access/status'),
      login: (input: AccessLoginInput) => request('/api/access/login', { method: 'POST', body: input as unknown as JsonValue }),
      logout: () => request('/api/access/logout', { method: 'POST' }),
      updatePassword: (input: AccessPasswordUpdate) => request('/api/access/password', { method: 'PUT', body: input as unknown as JsonValue })
    },
    settings: {
      get: () => request('/api/settings'),
      update: (input: ProviderSettingsUpdate) => request('/api/settings', { method: 'PUT', body: input as JsonValue }),
      models: (input?: ProviderModelsInput) => request('/api/settings/models', { method: 'POST', body: (input || {}) as JsonValue })
    },
    maintenance: {
      status: () => request('/api/maintenance/status'),
      backupUrl: () => '/api/maintenance/backup',
      restore: (backup: BackupManifest) => request('/api/maintenance/restore', { method: 'POST', body: backup as unknown as JsonValue })
    },
    conversation: {
      list: () => request('/api/conversations'),
      create: (input?: ConversationCreateInput) => request('/api/conversations', { method: 'POST', body: (input || {}) as JsonValue }),
      update: (id: string, input: ConversationUpdate) =>
        request(`/api/conversations/${encodeURIComponent(id)}`, { method: 'PUT', body: input as JsonValue }),
      delete: (id: string) => request(`/api/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      runs: (id: string) => request(`/api/conversations/${encodeURIComponent(id)}/runs`)
    },
    image: {
      generate: (input: GenerateImageInput) => request('/api/images/generate', { method: 'POST', body: input as unknown as JsonValue }),
      cancel: (runId: string, requestIndex?: number) =>
        request(`/api/images/${encodeURIComponent(runId)}/cancel`, {
          method: 'POST',
          body: (requestIndex === undefined ? {} : { requestIndex }) as JsonValue
        }),
      url: (id: string) => `/images/image/${encodeURIComponent(id)}`,
      copy: async (id: string) => {
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': loadClipboardPngBlob(id)
          })
        ])
      },
      download: async (id: string) => {
        const url = `/images/image/${encodeURIComponent(id)}`
        triggerDownload(url, '')
        return url
      },
      downloadMany: async (ids: string[]) => {
        for (const id of ids) triggerDownload(`/images/image/${encodeURIComponent(id)}`, '')
        return { directory: 'browser-downloads', saved: ids.length, skipped: 0 } satisfies BatchDownloadResult
      }
    },
    prompt: {
      inspire: async (input?: PromptAssistInput) => (await request<{ text: string }>('/api/prompt/inspire', { method: 'POST', body: (input || {}) as JsonValue })).text,
      enrich: async (input: PromptAssistInput & { prompt: string }) =>
        (await request<{ text: string }>('/api/prompt/enrich', { method: 'POST', body: input as JsonValue })).text
    },
    promptLibrary: {
      list: () => request('/api/prompt-library'),
      create: (input: PromptTemplateInput) => request('/api/prompt-library', { method: 'POST', body: input as unknown as JsonValue }),
      update: (id: string, input: PromptTemplateInput) =>
        request(`/api/prompt-library/${encodeURIComponent(id)}`, { method: 'PUT', body: input as unknown as JsonValue }),
      delete: (id: string) => request(`/api/prompt-library/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      importMany: (items: PromptTemplate[]) => request('/api/prompt-library/import', { method: 'POST', body: items as unknown as JsonValue })
    },
    reference: {
      importFiles: (conversationId: string, files: ReferenceImageImportFile[]) =>
        request(`/api/conversations/${encodeURIComponent(conversationId)}/references`, {
          method: 'POST',
          body: files.map((file) => ({
            ...file,
            data: arrayBufferToBase64(file.data)
          })) as unknown as JsonValue
        }),
      addFromHistory: (conversationId: string, historyId: string) =>
        request(`/api/conversations/${encodeURIComponent(conversationId)}/references/from-history`, {
          method: 'POST',
          body: { historyId }
        }),
      remove: (conversationId: string, referenceImageId: string) =>
        request(`/api/conversations/${encodeURIComponent(conversationId)}/references/${encodeURIComponent(referenceImageId)}`, {
          method: 'DELETE'
        }),
      reorder: (conversationId: string, referenceImageIds: string[]) =>
        request(`/api/conversations/${encodeURIComponent(conversationId)}/references/reorder`, {
          method: 'PUT',
          body: { referenceImageIds }
        }),
      url: (id: string) => `/images/reference/${encodeURIComponent(id)}`
    },
    history: {
      list: (options?: HistoryListOptions) => {
        const params = new URLSearchParams()
        if (options?.query) params.set('query', options.query)
        if (options?.sort) params.set('sort', options.sort)
        if (options?.favoritesOnly) params.set('favoritesOnly', 'true')
        if (options?.workspaceType) params.set('workspaceType', options.workspaceType)
        const query = params.toString()
        return request(`/api/history${query ? `?${query}` : ''}`)
      },
      delete: (id: string) => request(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' }),
      favorite: (id: string, favorite: boolean) =>
        request(`/api/history/${encodeURIComponent(id)}/favorite`, { method: 'PUT', body: { favorite } })
    },
    shell: {
      openPath: async () => ''
    }
  }
}

async function request<T>(path: string, options: { method?: string; body?: JsonValue } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `请求失败：HTTP ${response.status}`)
  }
  return payload as T
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }
  return btoa(binary)
}

function triggerDownload(url: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

async function loadClipboardPngBlob(id: string): Promise<Blob> {
  const response = await fetch(`/images/image/${encodeURIComponent(id)}`)
  if (!response.ok) throw new Error('图片读取失败')
  return toClipboardPngBlob(await response.blob())
}

async function toClipboardPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob

  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('图片转换失败')
    context.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((pngBlob) => {
        if (pngBlob) {
          resolve(pngBlob)
        } else {
          reject(new Error('图片转换失败'))
        }
      }, 'image/png')
    })
  } finally {
    bitmap.close()
  }
}
