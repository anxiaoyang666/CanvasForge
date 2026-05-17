export type ImageRatio = '1:1' | '3:2' | '2:3' | '4:3' | '3:4' | '16:9' | '9:16' | '21:9' | '9:21'
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high'
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp'
export type ImageBackground = 'auto' | 'opaque'
export type ImageModeration = 'auto' | 'low'
export type ImageInputFidelity = 'low' | 'high'
export type ImageStatus = 'succeeded' | 'failed'
export type GenerationRunStatus = 'running' | ImageStatus
export type GenerationMode = 'text-to-image' | 'image-to-image'
export type WorkspaceType = 'canvas' | 'hand-poster'
export type GenerationRunRetryFailure = {
  errorMessage: string
  errorDetails: string
  createdAt: string
}

export type ReferenceImage = {
  id: string
  name: string
  mimeType: string
  filePath: string | null
  fileSizeBytes: number
  createdAt: string
}

export type ReferenceImageImportFile = {
  name: string
  mimeType: string
  data: ArrayBuffer
}

export type GenerateImageInput = {
  conversationId: string
  workspaceType?: WorkspaceType
  prompt: string
  model: string
  ratio: ImageRatio
  size: string
  quality: ImageQuality
  n: number
  outputFormat?: ImageOutputFormat
  outputCompression?: number
  background?: ImageBackground
  moderation?: ImageModeration
  stream?: boolean
  partialImages?: number
  inputFidelity?: ImageInputFidelity
  referenceImageIds?: string[]
  maxRetries?: number
  generationTimeoutSeconds?: number
}

export type PromptAssistInput = {
  prompt?: string
  hasReferenceImages?: boolean
}

export type Conversation = {
  id: string
  workspaceType?: WorkspaceType
  title: string
  draftPrompt: string
  model: string
  ratio: ImageRatio
  size: string
  quality: ImageQuality
  n: number
  outputFormat: ImageOutputFormat
  outputCompression: number | null
  background: ImageBackground
  moderation: ImageModeration
  stream: boolean
  partialImages: number | null
  inputFidelity: ImageInputFidelity | null
  maxRetries: number
  generationTimeoutSeconds: number
  autoSaveHistory: boolean
  keepFailureDetails: boolean
  referenceImages: ReferenceImage[]
  createdAt: string
  updatedAt: string
}

export type ConversationUpdate = Partial<
  Pick<
    Conversation,
    | 'title'
    | 'workspaceType'
    | 'draftPrompt'
    | 'model'
    | 'ratio'
    | 'size'
    | 'quality'
    | 'n'
    | 'outputFormat'
    | 'outputCompression'
    | 'background'
    | 'moderation'
    | 'stream'
    | 'partialImages'
    | 'inputFidelity'
    | 'maxRetries'
    | 'generationTimeoutSeconds'
    | 'autoSaveHistory'
    | 'keepFailureDetails'
  >
>

export type ConversationCreateInput = Partial<
  Pick<
    Conversation,
    | 'model'
    | 'workspaceType'
    | 'ratio'
    | 'size'
    | 'quality'
    | 'n'
    | 'outputFormat'
    | 'outputCompression'
    | 'background'
    | 'moderation'
    | 'stream'
    | 'partialImages'
    | 'inputFidelity'
    | 'maxRetries'
    | 'generationTimeoutSeconds'
    | 'autoSaveHistory'
    | 'keepFailureDetails'
  >
>

export type ImageHistoryItem = {
  id: string
  workspaceType?: WorkspaceType
  conversationId: string | null
  runId: string | null
  prompt: string
  model: string
  ratio: ImageRatio
  size: string | null
  quality: ImageQuality
  requestIndex: number | null
  durationMs: number | null
  filePath: string | null
  fileSizeBytes: number | null
  status: ImageStatus
  errorMessage: string | null
  errorDetails: string | null
  retryAttempt: number
  favorite: boolean
  generationMode: GenerationMode
  referenceImages: ReferenceImage[]
  createdAt: string
}

export type GenerationRun = {
  id: string
  workspaceType?: WorkspaceType
  conversationId: string
  prompt: string
  model: string
  ratio: ImageRatio
  size: string | null
  quality: ImageQuality
  n: number
  status: GenerationRunStatus
  durationMs: number | null
  errorMessage: string | null
  errorDetails: string | null
  maxRetries: number
  retryAttempts: Record<number, number>
  retryFailures: Record<number, GenerationRunRetryFailure>
  generationMode: GenerationMode
  referenceImages: ReferenceImage[]
  createdAt: string
  items: ImageHistoryItem[]
}

export type ProviderSettings = {
  baseURL: string
  apiKeyStored: boolean
  defaultModel: string
  promptModel: string
  insecureStorage: boolean
}

export type ProviderSettingsUpdate = {
  baseURL?: string
  apiKey?: string | null
  defaultModel?: string
  promptModel?: string
}

export type ProviderModel = {
  id: string
  label: string
}

export type ProviderModelsInput = {
  baseURL?: string
  apiKey?: string
}

export type GenerateImageResult = {
  run: GenerationRun
  items: ImageHistoryItem[]
  errorMessage?: string
  errorDetails?: string
  canceled?: boolean
}

export type BatchDownloadResult = {
  directory: string
  saved: number
  skipped: number
}

export type HistoryListOptions = {
  query?: string
  sort?: 'newest' | 'oldest'
  favoritesOnly?: boolean
  workspaceType?: 'all' | WorkspaceType
}

export type PromptTemplate = {
  id: string
  title: string
  category: string
  description: string
  prompt: string
  tags: string[]
  ratio: ImageRatio
  resolution: string
  quality: ImageQuality
}

export type PromptTemplateInput = Omit<PromptTemplate, 'id'>

export type AccessStatus = {
  protectionEnabled: boolean
  authenticated: boolean
}

export type AccessLoginInput = {
  password: string
}

export type AccessPasswordUpdate = {
  password: string | null
}

export type MaintenanceStatus = {
  dataDir: string
  counts: {
    conversations: number
    runs: number
    history: number
    succeededImages: number
    failedItems: number
    referenceImages: number
    promptTemplates: number
  }
  storage: {
    databaseBytes: number
    imagesBytes: number
    referenceImagesBytes: number
    totalBytes: number
  }
  recentFailure: {
    message: string
    createdAt: string
  } | null
}

export type BackupManifest = {
  app: 'CanvasForge'
  version: number
  exportedAt: string
  files: Array<{
    path: string
    contentBase64: string
  }>
}

export type MaintenanceRestoreResult = {
  ok: true
  restarting: true
}

export type CanvasForgeAPI = {
  access: {
    status: () => Promise<AccessStatus>
    login: (input: AccessLoginInput) => Promise<AccessStatus>
    logout: () => Promise<AccessStatus>
    updatePassword: (input: AccessPasswordUpdate) => Promise<AccessStatus>
  }
  settings: {
    get: () => Promise<ProviderSettings>
    update: (input: ProviderSettingsUpdate) => Promise<ProviderSettings>
    models: (input?: ProviderModelsInput) => Promise<ProviderModel[]>
  }
  maintenance: {
    status: () => Promise<MaintenanceStatus>
    backupUrl: () => string
    restore: (backup: BackupManifest) => Promise<MaintenanceRestoreResult>
  }
  conversation: {
    list: () => Promise<Conversation[]>
    create: (input?: ConversationCreateInput) => Promise<Conversation>
    update: (id: string, input: ConversationUpdate) => Promise<Conversation>
    delete: (id: string) => Promise<void>
    runs: (id: string) => Promise<GenerationRun[]>
  }
  image: {
    generate: (input: GenerateImageInput) => Promise<GenerateImageResult>
    cancel: (runId: string, requestIndex?: number) => Promise<void>
    url: (id: string) => string
    copy: (id: string) => Promise<void>
    download: (id: string) => Promise<string | null>
    downloadMany: (ids: string[]) => Promise<BatchDownloadResult | null>
  }
  prompt: {
    inspire: (input?: PromptAssistInput) => Promise<string>
    enrich: (input: PromptAssistInput & { prompt: string }) => Promise<string>
  }
  promptLibrary: {
    list: () => Promise<PromptTemplate[]>
    create: (input: PromptTemplateInput) => Promise<PromptTemplate>
    update: (id: string, input: PromptTemplateInput) => Promise<PromptTemplate>
    delete: (id: string) => Promise<void>
    importMany: (items: PromptTemplate[]) => Promise<PromptTemplate[]>
  }
  reference: {
    importFiles: (conversationId: string, files: ReferenceImageImportFile[]) => Promise<ReferenceImage[]>
    addFromHistory: (conversationId: string, historyId: string) => Promise<ReferenceImage[]>
    remove: (conversationId: string, referenceImageId: string) => Promise<ReferenceImage[]>
    reorder: (conversationId: string, referenceImageIds: string[]) => Promise<ReferenceImage[]>
    url: (id: string) => string
  }
  history: {
    list: (options?: HistoryListOptions) => Promise<ImageHistoryItem[]>
    delete: (id: string) => Promise<void>
    favorite: (id: string, favorite: boolean) => Promise<ImageHistoryItem>
  }
  shell: {
    openPath: (filePath: string) => Promise<string>
  }
}
