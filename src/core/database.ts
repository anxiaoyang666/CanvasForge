import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import {
  DEFAULT_IMAGE_GENERATION_TIMEOUT_SECONDS,
  DEFAULT_IMAGE_MAX_RETRIES,
  DEFAULT_IMAGE_OUTPUT_FORMAT,
  DEFAULT_MODEL,
  MAX_IMAGE_MAX_RETRIES,
  getDefaultImageSize,
  normalizeImageGenerationTimeoutSeconds
} from '@shared/image-options'
import type {
  ConversationCreateInput,
  Conversation,
  ConversationUpdate,
  GenerationRun,
  GenerationRunRetryFailure,
  GenerationRunStatus,
  HistoryListOptions,
  ImageHistoryItem,
  ImageQuality,
  ImageRatio,
  ImageStatus,
  MaintenanceStatus,
  PromptTemplate,
  PromptTemplateInput,
  ReferenceImage,
  WorkspaceType
} from '@shared/types'
import { createInterruptedRunRecoveryPlan } from './interrupted-run-recovery'

type Row = Record<string, unknown>

export const MAX_REFERENCE_IMAGES = 8
export const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024

const referenceMimeTypes = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/webp', '.webp']
])

export class AppDatabase {
  readonly imagesDir: string
  readonly referenceImagesDir: string
  private readonly db: Database.Database

  constructor(userDataDir: string) {
    mkdirSync(userDataDir, { recursive: true })
    this.imagesDir = join(userDataDir, 'images')
    this.referenceImagesDir = join(userDataDir, 'reference-images')
    mkdirSync(this.imagesDir, { recursive: true })
    mkdirSync(this.referenceImagesDir, { recursive: true })
    this.db = new Database(join(userDataDir, 'canvasforge.sqlite'))
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  getMaintenanceStatus(userDataDir: string): MaintenanceStatus {
    const counts = {
      conversations: Number((this.db.prepare('select count(*) as count from conversations').get() as Row).count),
      runs: Number((this.db.prepare('select count(*) as count from generation_runs').get() as Row).count),
      history: Number((this.db.prepare('select count(*) as count from image_history').get() as Row).count),
      succeededImages: Number((this.db.prepare("select count(*) as count from image_history where status = 'succeeded'").get() as Row).count),
      failedItems: Number((this.db.prepare("select count(*) as count from image_history where status = 'failed'").get() as Row).count),
      referenceImages: Number((this.db.prepare('select count(*) as count from reference_images').get() as Row).count),
      promptTemplates: Number((this.db.prepare('select count(*) as count from prompt_templates').get() as Row).count)
    }
    const recentFailureRow = this.db
      .prepare("select error_message, created_at from image_history where status = 'failed' and error_message is not null order by created_at desc limit 1")
      .get() as Row | undefined
    const databasePath = join(userDataDir, 'canvasforge.sqlite')
    const storage = {
      databaseBytes: fileSize(databasePath) + fileSize(`${databasePath}-wal`) + fileSize(`${databasePath}-shm`),
      imagesBytes: directorySize(this.imagesDir),
      referenceImagesBytes: directorySize(this.referenceImagesDir),
      totalBytes: 0
    }
    storage.totalBytes = storage.databaseBytes + storage.imagesBytes + storage.referenceImagesBytes
    return {
      dataDir: userDataDir,
      counts,
      storage,
      recentFailure: recentFailureRow
        ? {
            message: String(recentFailureRow.error_message),
            createdAt: String(recentFailureRow.created_at)
          }
        : null
    }
  }

  listPromptTemplates(): PromptTemplate[] {
    return this.db
      .prepare('select * from prompt_templates order by updated_at desc, created_at desc')
      .all()
      .map((row) => promptTemplateFromRow(row as Row))
  }

  createPromptTemplate(input: PromptTemplateInput): PromptTemplate {
    const now = new Date().toISOString()
    const template = normalizePromptTemplateInput({ ...input, id: randomUUID() }, randomUUID())
    this.db
      .prepare(
        `insert into prompt_templates
        (id, title, category, description, prompt, tags, ratio, resolution, quality, created_at, updated_at)
        values (@id, @title, @category, @description, @prompt, @tags, @ratio, @resolution, @quality, @createdAt, @updatedAt)`
      )
      .run({ ...template, tags: JSON.stringify(template.tags), createdAt: now, updatedAt: now })
    return template
  }

  updatePromptTemplate(id: string, input: PromptTemplateInput): PromptTemplate {
    const current = this.db.prepare('select id from prompt_templates where id = ?').get(id)
    if (!current) throw new Error('Prompt template not found.')
    const updatedAt = new Date().toISOString()
    const template = normalizePromptTemplateInput({ ...input, id }, id)
    this.db
      .prepare(
        `update prompt_templates set
        title = @title,
        category = @category,
        description = @description,
        prompt = @prompt,
        tags = @tags,
        ratio = @ratio,
        resolution = @resolution,
        quality = @quality,
        updated_at = @updatedAt
        where id = @id`
      )
      .run({ ...template, tags: JSON.stringify(template.tags), updatedAt })
    return template
  }

  deletePromptTemplate(id: string): void {
    this.db.prepare('delete from prompt_templates where id = ?').run(id)
  }

  importPromptTemplates(items: PromptTemplate[]): PromptTemplate[] {
    const now = new Date().toISOString()
    const insert = this.db.prepare(
      `insert or replace into prompt_templates
      (id, title, category, description, prompt, tags, ratio, resolution, quality, created_at, updated_at)
      values (@id, @title, @category, @description, @prompt, @tags, @ratio, @resolution, @quality,
        coalesce((select created_at from prompt_templates where id = @id), @createdAt), @updatedAt)`
    )
    const templates = items
      .map((item) => {
        try {
          return normalizePromptTemplateInput(item, item.id || randomUUID())
        } catch {
          return null
        }
      })
      .filter((item): item is PromptTemplate => item != null)
    const transaction = this.db.transaction(() => {
      for (const template of templates) {
        insert.run({ ...template, tags: JSON.stringify(template.tags), createdAt: now, updatedAt: now })
      }
    })
    transaction()
    return this.listPromptTemplates()
  }

  close(): void {
    this.db.close()
  }

  listConversations(): Conversation[] {
    return this.db.prepare('select * from conversations order by updated_at desc').all().map((row) => this.conversationFromRow(row as Row))
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.prepare('select * from conversations where id = ?').get(id) as Row | undefined
    return row ? this.conversationFromRow(row) : null
  }

  createConversation(input: ConversationCreateInput = {}): Conversation {
    const now = new Date().toISOString()
    const ratio = input.ratio || '1:1'
    const conversation: Conversation = {
      id: randomUUID(),
      workspaceType: input.workspaceType === 'hand-poster' ? 'hand-poster' : 'canvas',
      title: '新会话',
      draftPrompt: '',
      model: input.model || DEFAULT_MODEL,
      ratio,
      size: input.size || getDefaultImageSize(ratio),
      quality: input.quality || 'high',
      n: input.n !== undefined ? Math.min(10, Math.max(1, input.n)) : 1,
      outputFormat: input.outputFormat || DEFAULT_IMAGE_OUTPUT_FORMAT,
      outputCompression: input.outputCompression ?? null,
      background: input.background || 'auto',
      moderation: input.moderation || 'auto',
      stream: input.stream || false,
      partialImages: input.partialImages ?? 0,
      inputFidelity: input.inputFidelity ?? null,
      maxRetries: normalizeRetryCount(input.maxRetries),
      generationTimeoutSeconds: normalizeImageGenerationTimeoutSeconds(input.generationTimeoutSeconds),
      autoSaveHistory: input.autoSaveHistory ?? true,
      keepFailureDetails: input.keepFailureDetails ?? true,
      referenceImages: [],
      createdAt: now,
      updatedAt: now
    }
    this.db
      .prepare(
        `insert into conversations
        (id, workspace_type, title, draft_prompt, model, ratio, size, quality, n, output_format, output_compression, background, moderation, stream, partial_images, input_fidelity, max_retries, generation_timeout_seconds, auto_save_history, keep_failure_details, created_at, updated_at)
        values (@id, @workspaceType, @title, @draftPrompt, @model, @ratio, @size, @quality, @n, @outputFormat, @outputCompression, @background, @moderation, @stream, @partialImages, @inputFidelity, @maxRetries, @generationTimeoutSeconds, @autoSaveHistory, @keepFailureDetails, @createdAt, @updatedAt)`
      )
      .run({
        ...conversation,
        workspaceType: conversation.workspaceType,
        outputCompression: conversation.outputCompression,
        stream: conversation.stream ? 1 : 0,
        autoSaveHistory: conversation.autoSaveHistory ? 1 : 0,
        keepFailureDetails: conversation.keepFailureDetails ? 1 : 0
      })
    return conversation
  }

  updateConversation(id: string, input: ConversationUpdate): Conversation {
    const current = this.getConversation(id)
    if (!current) throw new Error('Conversation not found.')
    const next: Conversation = {
      ...current,
      ...input,
      workspaceType: input.workspaceType === 'hand-poster' ? 'hand-poster' : current.workspaceType,
      size: input.size ?? (input.ratio !== undefined ? getDefaultImageSize(input.ratio) : current.size),
      n: input.n !== undefined ? Math.min(10, Math.max(1, input.n)) : current.n,
      outputFormat: input.outputFormat ?? current.outputFormat,
      outputCompression: input.outputCompression !== undefined ? input.outputCompression : current.outputCompression,
      background: input.background ?? current.background,
      moderation: input.moderation ?? current.moderation,
      stream: input.stream !== undefined ? input.stream : current.stream,
      partialImages: input.partialImages !== undefined ? input.partialImages : current.partialImages,
      inputFidelity: input.inputFidelity !== undefined ? input.inputFidelity : current.inputFidelity,
      maxRetries: input.maxRetries !== undefined ? normalizeRetryCount(input.maxRetries) : current.maxRetries,
      generationTimeoutSeconds:
        input.generationTimeoutSeconds !== undefined
          ? normalizeImageGenerationTimeoutSeconds(input.generationTimeoutSeconds)
          : current.generationTimeoutSeconds,
      updatedAt: new Date().toISOString()
    }
    this.db
      .prepare(
        `update conversations set
        workspace_type = @workspaceType,
        title = @title,
        draft_prompt = @draftPrompt,
        model = @model,
        ratio = @ratio,
        size = @size,
        quality = @quality,
        n = @n,
        output_format = @outputFormat,
        output_compression = @outputCompression,
        background = @background,
        moderation = @moderation,
        stream = @stream,
        partial_images = @partialImages,
        input_fidelity = @inputFidelity,
        max_retries = @maxRetries,
        generation_timeout_seconds = @generationTimeoutSeconds,
        auto_save_history = @autoSaveHistory,
        keep_failure_details = @keepFailureDetails,
        updated_at = @updatedAt
        where id = @id`
      )
      .run({
        ...next,
        workspaceType: next.workspaceType,
        stream: next.stream ? 1 : 0,
        autoSaveHistory: next.autoSaveHistory ? 1 : 0,
        keepFailureDetails: next.keepFailureDetails ? 1 : 0
      })
    return next
  }

  deleteConversation(id: string): void {
    const runIds = this.db
      .prepare('select id from generation_runs where conversation_id = ?')
      .all(id)
      .map((row) => String((row as Row).id))
    const transaction = this.db.transaction(() => {
      this.db.prepare('delete from conversation_reference_images where conversation_id = ?').run(id)
      const deleteRunReferences = this.db.prepare('delete from generation_run_references where run_id = ?')
      for (const runId of runIds) deleteRunReferences.run(runId)
      this.db.prepare('update image_history set conversation_id = null, run_id = null where conversation_id = ?').run(id)
      this.db.prepare('delete from generation_runs where conversation_id = ?').run(id)
      this.db.prepare('delete from conversations where id = ?').run(id)
    })
    transaction()
  }

  insertRun(input: Omit<GenerationRun, 'items' | 'referenceImages'> & { referenceImages?: ReferenceImage[] }): GenerationRun {
    this.db
      .prepare(
        `insert into generation_runs
        (id, workspace_type, conversation_id, prompt, model, ratio, size, quality, duration_ms, n, status, error_message, error_details, max_retries, retry_attempts, retry_failures, generation_mode, created_at)
        values (@id, @workspaceType, @conversationId, @prompt, @model, @ratio, @size, @quality, @durationMs, @n, @status, @errorMessage, @errorDetails, @maxRetries, @retryAttempts, @retryFailures, @generationMode, @createdAt)`
      )
      .run({
        ...input,
        workspaceType: input.workspaceType || this.getConversation(input.conversationId)?.workspaceType || 'canvas',
        maxRetries: normalizeRetryCount(input.maxRetries),
        retryAttempts: JSON.stringify(input.retryAttempts || {}),
        retryFailures: JSON.stringify(input.retryFailures || {}),
        generationMode: input.generationMode || 'text-to-image'
      })
    return {
      ...input,
      workspaceType: input.workspaceType || this.getConversation(input.conversationId)?.workspaceType || 'canvas',
      maxRetries: normalizeRetryCount(input.maxRetries),
      retryAttempts: input.retryAttempts || {},
      retryFailures: input.retryFailures || {},
      referenceImages: input.referenceImages || [],
      items: []
    }
  }

  updateRun(id: string, input: Partial<Pick<GenerationRun, 'status' | 'errorMessage' | 'errorDetails' | 'durationMs'>>): GenerationRun {
    const current = this.getRun(id)
    if (!current) throw new Error('Generation run not found.')
    const next = { ...current, ...input }
    this.db
      .prepare('update generation_runs set status = ?, error_message = ?, error_details = ?, duration_ms = ? where id = ?')
      .run(next.status, next.errorMessage, next.errorDetails, next.durationMs, id)
    return this.getRun(id) || next
  }

  updateRunRetryAttempt(runId: string, requestIndex: number, retryAttempt: number): GenerationRun {
    const current = this.getRun(runId)
    if (!current) throw new Error('Generation run not found.')
    const retryAttempts = {
      ...current.retryAttempts,
      [requestIndex]: Math.max(0, Math.trunc(retryAttempt))
    }
    this.db
      .prepare('update generation_runs set retry_attempts = ? where id = ?')
      .run(JSON.stringify(retryAttempts), runId)
    return this.getRun(runId) || { ...current, retryAttempts }
  }

  updateRunRetryFailure(runId: string, requestIndex: number, failure: GenerationRunRetryFailure): GenerationRun {
    const current = this.getRun(runId)
    if (!current) throw new Error('Generation run not found.')
    const retryFailures = {
      ...current.retryFailures,
      [requestIndex]: failure
    }
    this.db
      .prepare('update generation_runs set retry_failures = ? where id = ?')
      .run(JSON.stringify(retryFailures), runId)
    return this.getRun(runId) || { ...current, retryFailures }
  }

  recoverInterruptedRuns(now = new Date()): number {
    const runningRuns = this.db.prepare('select id from generation_runs where status = ?').all('running') as Array<{ id: string }>
    if (runningRuns.length === 0) {
      return 0
    }

    const transaction = this.db.transaction(() => {
      for (const { id } of runningRuns) {
        this.recoverInterruptedRun(id, now)
      }
    })
    transaction()
    return runningRuns.length
  }

  getRun(id: string): GenerationRun | null {
    const row = this.db.prepare('select * from generation_runs where id = ?').get(id) as Row | undefined
    return row ? this.runFromRow(row) : null
  }

  listRuns(conversationId: string): GenerationRun[] {
    return this.db
      .prepare('select * from generation_runs where conversation_id = ? order by created_at desc')
      .all(conversationId)
      .map((row) => this.runFromRow(row as Row))
  }

  insertHistory(input: Omit<ImageHistoryItem, 'favorite' | 'referenceImages'> & {
    favorite?: boolean
    globalVisible?: boolean
    referenceImages?: ReferenceImage[]
  }): ImageHistoryItem {
    const item: ImageHistoryItem = { ...input, favorite: Boolean(input.favorite), referenceImages: input.referenceImages || [] }
    this.db
      .prepare(
        `insert into image_history
        (id, workspace_type, conversation_id, run_id, prompt, model, ratio, size, quality, request_index, duration_ms, file_path, file_size_bytes, status, error_message, error_details, retry_attempt, favorite, global_visible, generation_mode, created_at)
        values (@id, @workspaceType, @conversationId, @runId, @prompt, @model, @ratio, @size, @quality, @requestIndex, @durationMs, @filePath, @fileSizeBytes, @status, @errorMessage, @errorDetails, @retryAttempt, @favorite, @globalVisible, @generationMode, @createdAt)`
      )
      .run({
        ...item,
        workspaceType: item.workspaceType || this.getConversation(input.conversationId || '')?.workspaceType || 'canvas',
        retryAttempt: Math.max(0, Math.trunc(item.retryAttempt || 0)),
        favorite: item.favorite ? 1 : 0,
        globalVisible: input.globalVisible === false ? 0 : 1,
        generationMode: input.generationMode || 'text-to-image'
      })
    return item
  }

  listHistory(options: HistoryListOptions = {}): ImageHistoryItem[] {
    const where: string[] = ['global_visible = 1']
    const params: Record<string, unknown> = {}
    if (options.query?.trim()) {
      where.push('(prompt like @query or model like @query or size like @query)')
      params.query = `%${options.query.trim()}%`
    }
    if (options.favoritesOnly) where.push('favorite = 1')
    if (options.workspaceType && options.workspaceType !== 'all') {
      where.push('workspace_type = @workspaceType')
      params.workspaceType = options.workspaceType
    }
    const order = options.sort === 'oldest' ? 'asc' : 'desc'
    const sql = `select * from image_history ${where.length ? `where ${where.join(' and ')}` : ''} order by created_at ${order}`
    return this.db.prepare(sql).all(params).map((row) => this.historyFromRow(row as Row))
  }

  getHistory(id: string): ImageHistoryItem | null {
    const row = this.db.prepare('select * from image_history where id = ?').get(id) as Row | undefined
    return row ? this.historyFromRow(row) : null
  }

  setFavorite(id: string, favorite: boolean): ImageHistoryItem {
    this.db.prepare('update image_history set favorite = ? where id = ?').run(favorite ? 1 : 0, id)
    const item = this.getHistory(id)
    if (!item) throw new Error('History item not found.')
    return item
  }

  deleteHistory(id: string): void {
    const item = this.getHistory(id)
    if (item?.filePath) this.deleteImageFile(item.filePath)
    this.db.prepare('delete from image_history where id = ?').run(id)
  }

  getReferenceImage(id: string): ReferenceImage | null {
    const row = this.db.prepare('select * from reference_images where id = ?').get(id) as Row | undefined
    return row ? this.referenceFromRow(row) : null
  }

  listConversationReferences(conversationId: string): ReferenceImage[] {
    return this.db
      .prepare(`
        select reference_images.* from conversation_reference_images
        join reference_images on reference_images.id = conversation_reference_images.reference_image_id
        where conversation_reference_images.conversation_id = ?
        order by conversation_reference_images.position asc, conversation_reference_images.created_at asc
      `)
      .all(conversationId)
      .map((row) => this.referenceFromRow(row as Row))
  }

  createReferenceImageFromBytes(input: {
    conversationId: string
    name: string
    mimeType: string
    data: ArrayBuffer | Uint8Array
  }): ReferenceImage {
    const current = this.listConversationReferences(input.conversationId)
    if (current.length >= MAX_REFERENCE_IMAGES) {
      throw new Error(`最多只能添加 ${MAX_REFERENCE_IMAGES} 张参考图。`)
    }

    const mimeType = normalizeReferenceMimeType(input.mimeType, input.name)
    const buffer = Buffer.from(input.data instanceof Uint8Array ? input.data : new Uint8Array(input.data))
    if (buffer.length > MAX_REFERENCE_IMAGE_BYTES) {
      throw new Error('单张参考图不能超过 20MB。')
    }

    const now = new Date().toISOString()
    const id = randomUUID()
    const extension = referenceMimeTypes.get(mimeType) || extensionFromName(input.name) || '.png'
    const filePath = join(this.referenceImagesDir, `${id}${extension}`)
    writeFileSync(filePath, buffer)
    const reference = this.insertReferenceImage({
      id,
      name: input.name || `reference-${current.length + 1}${extension}`,
      mimeType,
      filePath,
      fileSizeBytes: buffer.length,
      createdAt: now
    })
    this.attachReferenceToConversation(input.conversationId, reference.id, current.length)
    return reference
  }

  addHistoryImageAsReference(conversationId: string, historyId: string): ReferenceImage {
    const current = this.listConversationReferences(conversationId)
    if (current.length >= MAX_REFERENCE_IMAGES) {
      throw new Error(`最多只能添加 ${MAX_REFERENCE_IMAGES} 张参考图。`)
    }
    const item = this.getHistory(historyId)
    if (!item?.filePath || !existsSync(item.filePath)) {
      throw new Error('Image file not found.')
    }

    const now = new Date().toISOString()
    const id = randomUUID()
    const extension = extname(item.filePath) || '.png'
    const filePath = join(this.referenceImagesDir, `${id}${extension}`)
    copyFileSync(item.filePath, filePath)
    const fileSizeBytes = this.getImageFileSize(filePath) || 0
    const reference = this.insertReferenceImage({
      id,
      name: basename(item.filePath),
      mimeType: mimeTypeFromExtension(extension),
      filePath,
      fileSizeBytes,
      createdAt: now
    })
    this.attachReferenceToConversation(conversationId, reference.id, current.length)
    return reference
  }

  removeReferenceFromConversation(conversationId: string, referenceImageId: string): ReferenceImage[] {
    this.db
      .prepare('delete from conversation_reference_images where conversation_id = ? and reference_image_id = ?')
      .run(conversationId, referenceImageId)
    return this.compactConversationReferencePositions(conversationId)
  }

  reorderConversationReferences(conversationId: string, referenceImageIds: string[]): ReferenceImage[] {
    const currentIds = new Set(this.listConversationReferences(conversationId).map((reference) => reference.id))
    const orderedIds = referenceImageIds.filter((id) => currentIds.has(id))
    const missingIds = Array.from(currentIds).filter((id) => !orderedIds.includes(id))
    const nextIds = [...orderedIds, ...missingIds].slice(0, MAX_REFERENCE_IMAGES)
    const updatePosition = this.db.prepare(
      'update conversation_reference_images set position = ? where conversation_id = ? and reference_image_id = ?'
    )
    const transaction = this.db.transaction(() => {
      nextIds.forEach((id, index) => updatePosition.run(index, conversationId, id))
    })
    transaction()
    return this.listConversationReferences(conversationId)
  }

  insertRunReferences(runId: string, references: ReferenceImage[]): void {
    const insert = this.db.prepare(`
      insert into generation_run_references
      (run_id, reference_image_id, position, name, mime_type, file_path, file_size_bytes, created_at)
      values (@runId, @referenceImageId, @position, @name, @mimeType, @filePath, @fileSizeBytes, @createdAt)
    `)
    const transaction = this.db.transaction(() => {
      references.forEach((reference, position) => {
        insert.run({
          runId,
          referenceImageId: reference.id,
          position,
          name: reference.name,
          mimeType: reference.mimeType,
          filePath: reference.filePath,
          fileSizeBytes: reference.fileSizeBytes,
          createdAt: reference.createdAt
        })
      })
    })
    transaction()
  }

  private migrate(): void {
    this.db.exec(`
      create table if not exists conversations (
        id text primary key,
        workspace_type text not null default 'canvas',
        title text not null,
        draft_prompt text not null,
        model text not null,
        ratio text not null,
        size text,
        quality text not null,
        n integer not null,
        output_format text not null default 'png',
        output_compression integer,
        background text not null default 'auto',
        moderation text not null default 'auto',
        stream integer not null default 0,
        partial_images integer not null default 0,
        input_fidelity text,
        max_retries integer not null default 0,
        generation_timeout_seconds integer not null default 300,
        auto_save_history integer not null,
        keep_failure_details integer not null,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists generation_runs (
        id text primary key,
        workspace_type text not null default 'canvas',
        conversation_id text not null,
        prompt text not null,
        model text not null,
        ratio text not null,
        size text,
        quality text not null,
        request_index integer,
        duration_ms integer,
        n integer not null,
        status text not null,
        error_message text,
        error_details text,
        max_retries integer not null default 0,
        retry_attempts text not null default '{}',
        retry_failures text not null default '{}',
        generation_mode text not null default 'text-to-image',
        created_at text not null
      );

      create table if not exists image_history (
        id text primary key,
        workspace_type text not null default 'canvas',
        conversation_id text,
        run_id text,
        prompt text not null,
        model text not null,
        ratio text not null,
        size text,
        quality text not null,
        duration_ms integer,
        file_path text,
        file_size_bytes integer,
        status text not null,
        error_message text,
        error_details text,
        retry_attempt integer not null default 0,
        favorite integer not null default 0,
        global_visible integer not null default 1,
        generation_mode text not null default 'text-to-image',
        created_at text not null
      );

      create table if not exists reference_images (
        id text primary key,
        name text not null,
        mime_type text not null,
        file_path text not null,
        file_size_bytes integer not null,
        created_at text not null
      );

      create table if not exists conversation_reference_images (
        conversation_id text not null,
        reference_image_id text not null,
        position integer not null,
        created_at text not null,
        primary key (conversation_id, reference_image_id)
      );

      create table if not exists generation_run_references (
        run_id text not null,
        reference_image_id text not null,
        position integer not null,
        name text not null,
        mime_type text not null,
        file_path text,
        file_size_bytes integer not null,
        created_at text not null,
        primary key (run_id, reference_image_id)
      );

      create table if not exists prompt_templates (
        id text primary key,
        title text not null,
        category text not null,
        description text not null,
        prompt text not null,
        tags text not null default '[]',
        ratio text not null,
        resolution text not null,
        quality text not null,
        created_at text not null,
        updated_at text not null
      );
    `)
    const conversationColumns = this.db.prepare('pragma table_info(conversations)').all() as Array<{ name: string }>
    if (!conversationColumns.some((column) => column.name === 'workspace_type')) {
      this.db.exec("alter table conversations add column workspace_type text not null default 'canvas'")
    }
    if (!conversationColumns.some((column) => column.name === 'size')) {
      this.db.exec('alter table conversations add column size text')
    }
    if (!conversationColumns.some((column) => column.name === 'output_format')) {
      this.db.exec("alter table conversations add column output_format text not null default 'png'")
    }
    if (!conversationColumns.some((column) => column.name === 'output_compression')) {
      this.db.exec('alter table conversations add column output_compression integer')
    }
    if (!conversationColumns.some((column) => column.name === 'background')) {
      this.db.exec("alter table conversations add column background text not null default 'auto'")
    }
    if (!conversationColumns.some((column) => column.name === 'moderation')) {
      this.db.exec("alter table conversations add column moderation text not null default 'auto'")
    }
    if (!conversationColumns.some((column) => column.name === 'stream')) {
      this.db.exec('alter table conversations add column stream integer not null default 0')
    }
    if (!conversationColumns.some((column) => column.name === 'partial_images')) {
      this.db.exec('alter table conversations add column partial_images integer not null default 0')
    }
    if (!conversationColumns.some((column) => column.name === 'input_fidelity')) {
      this.db.exec('alter table conversations add column input_fidelity text')
    }
    if (!conversationColumns.some((column) => column.name === 'max_retries')) {
      this.db.exec('alter table conversations add column max_retries integer not null default 0')
    }
    if (!conversationColumns.some((column) => column.name === 'generation_timeout_seconds')) {
      this.db.exec('alter table conversations add column generation_timeout_seconds integer not null default 300')
    }
    const columns = this.db.prepare('pragma table_info(image_history)').all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'workspace_type')) {
      this.db.exec("alter table image_history add column workspace_type text not null default 'canvas'")
    }
    if (!columns.some((column) => column.name === 'global_visible')) {
      this.db.exec('alter table image_history add column global_visible integer not null default 1')
    }
    if (!columns.some((column) => column.name === 'duration_ms')) {
      this.db.exec('alter table image_history add column duration_ms integer')
    }
    if (!columns.some((column) => column.name === 'request_index')) {
      this.db.exec('alter table image_history add column request_index integer')
    }
    if (!columns.some((column) => column.name === 'file_size_bytes')) {
      this.db.exec('alter table image_history add column file_size_bytes integer')
    }
    if (!columns.some((column) => column.name === 'generation_mode')) {
      this.db.exec("alter table image_history add column generation_mode text not null default 'text-to-image'")
    }
    if (!columns.some((column) => column.name === 'retry_attempt')) {
      this.db.exec('alter table image_history add column retry_attempt integer not null default 0')
    }
    const runColumns = this.db.prepare('pragma table_info(generation_runs)').all() as Array<{ name: string }>
    if (!runColumns.some((column) => column.name === 'workspace_type')) {
      this.db.exec("alter table generation_runs add column workspace_type text not null default 'canvas'")
    }
    if (!runColumns.some((column) => column.name === 'duration_ms')) {
      this.db.exec('alter table generation_runs add column duration_ms integer')
    }
    if (!runColumns.some((column) => column.name === 'generation_mode')) {
      this.db.exec("alter table generation_runs add column generation_mode text not null default 'text-to-image'")
    }
    if (!runColumns.some((column) => column.name === 'max_retries')) {
      this.db.exec('alter table generation_runs add column max_retries integer not null default 0')
    }
    if (!runColumns.some((column) => column.name === 'retry_attempts')) {
      this.db.exec("alter table generation_runs add column retry_attempts text not null default '{}'")
    }
    if (!runColumns.some((column) => column.name === 'retry_failures')) {
      this.db.exec("alter table generation_runs add column retry_failures text not null default '{}'")
    }
  }

  private conversationFromRow(row: Row): Conversation {
    return {
      id: String(row.id),
      workspaceType: parseWorkspaceType(row.workspace_type),
      title: String(row.title),
      draftPrompt: String(row.draft_prompt),
      model: String(row.model),
      ratio: row.ratio as ImageRatio,
      size: row.size ? String(row.size) : getDefaultImageSize(row.ratio as ImageRatio),
      quality: row.quality as Conversation['quality'],
      n: Number(row.n),
      outputFormat: row.output_format ? String(row.output_format) as Conversation['outputFormat'] : DEFAULT_IMAGE_OUTPUT_FORMAT,
      outputCompression: row.output_compression != null ? Number(row.output_compression) : null,
      background: row.background === 'opaque' ? 'opaque' : 'auto',
      moderation: row.moderation === 'low' ? 'low' : 'auto',
      stream: Boolean(row.stream),
      partialImages: row.partial_images != null ? Number(row.partial_images) : 0,
      inputFidelity: row.input_fidelity === 'high' || row.input_fidelity === 'low' ? row.input_fidelity : null,
      maxRetries: normalizeRetryCount(row.max_retries != null ? Number(row.max_retries) : DEFAULT_IMAGE_MAX_RETRIES),
      generationTimeoutSeconds: normalizeImageGenerationTimeoutSeconds(
        row.generation_timeout_seconds != null ? Number(row.generation_timeout_seconds) : DEFAULT_IMAGE_GENERATION_TIMEOUT_SECONDS
      ),
      autoSaveHistory: Boolean(row.auto_save_history),
      keepFailureDetails: Boolean(row.keep_failure_details),
      referenceImages: this.listConversationReferences(String(row.id)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private runFromRow = (row: Row): GenerationRun => ({
    id: String(row.id),
    workspaceType: parseWorkspaceType(row.workspace_type),
    conversationId: String(row.conversation_id),
    prompt: String(row.prompt),
    model: String(row.model),
    ratio: row.ratio as ImageRatio,
    size: row.size ? String(row.size) : getDefaultImageSize(row.ratio as ImageRatio),
    quality: row.quality as GenerationRun['quality'],
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
    n: Number(row.n),
    status: row.status as GenerationRunStatus,
    errorMessage: row.error_message ? String(row.error_message) : null,
    errorDetails: row.error_details ? String(row.error_details) : null,
    maxRetries: normalizeRetryCount(row.max_retries != null ? Number(row.max_retries) : DEFAULT_IMAGE_MAX_RETRIES),
    retryAttempts: parseRetryAttempts(row.retry_attempts),
    retryFailures: parseRetryFailures(row.retry_failures),
    generationMode: row.generation_mode === 'image-to-image' ? 'image-to-image' : 'text-to-image',
    referenceImages: this.listRunReferences(String(row.id)),
    createdAt: String(row.created_at),
    items: this.db
      .prepare(`
        select * from image_history
        where run_id = ?
        order by
          case when request_index is null then 1 else 0 end,
          request_index asc,
          created_at asc
      `)
      .all(String(row.id))
      .map((historyRow) => this.historyFromRow(historyRow as Row))
  })

  private recoverInterruptedRun(runId: string, now: Date): void {
    const run = this.getRun(runId)
    if (!run || run.status !== 'running') {
      return
    }

    const recoveryPlan = createInterruptedRunRecoveryPlan(run, now)
    if (recoveryPlan.failedItems.length > 0) {
      for (const failedItem of recoveryPlan.failedItems) {
        this.db
          .prepare(
            `insert into image_history
            (id, workspace_type, conversation_id, run_id, prompt, model, ratio, size, quality, request_index, duration_ms, file_path, file_size_bytes, status, error_message, error_details, retry_attempt, favorite, global_visible, generation_mode, created_at)
            values (@id, @workspaceType, @conversationId, @runId, @prompt, @model, @ratio, @size, @quality, @requestIndex, @durationMs, @filePath, @fileSizeBytes, @status, @errorMessage, @errorDetails, @retryAttempt, @favorite, @globalVisible, @generationMode, @createdAt)`
          )
          .run({
            id: randomUUID(),
            workspaceType: run.workspaceType,
            conversationId: run.conversationId,
            runId: run.id,
            prompt: run.prompt,
            model: run.model,
            ratio: run.ratio,
            size: run.size,
            quality: run.quality,
            requestIndex: failedItem.requestIndex,
            durationMs: failedItem.durationMs,
            filePath: null,
            fileSizeBytes: null,
            status: 'failed',
            errorMessage: failedItem.errorMessage,
            errorDetails: failedItem.errorDetails,
            retryAttempt: failedItem.retryAttempt,
            favorite: 0,
            globalVisible: this.getConversation(run.conversationId)?.autoSaveHistory !== false ? 1 : 0,
            generationMode: run.generationMode,
            createdAt: failedItem.createdAt
          })
      }
    }

    this.updateRun(run.id, {
      status: recoveryPlan.status,
      errorMessage: recoveryPlan.errorMessage,
      errorDetails: recoveryPlan.errorDetails,
      durationMs: recoveryPlan.durationMs
    })
  }

  private historyFromRow = (row: Row): ImageHistoryItem => ({
    id: String(row.id),
    workspaceType: parseWorkspaceType(row.workspace_type),
    conversationId: row.conversation_id ? String(row.conversation_id) : null,
    runId: row.run_id ? String(row.run_id) : null,
    prompt: String(row.prompt),
    model: String(row.model),
    ratio: row.ratio as ImageRatio,
    size: row.size ? String(row.size) : null,
    quality: row.quality as ImageHistoryItem['quality'],
    requestIndex: row.request_index != null ? Number(row.request_index) : null,
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
    filePath: row.file_path ? String(row.file_path) : null,
    fileSizeBytes: row.file_size_bytes != null ? Number(row.file_size_bytes) : this.getImageFileSize(row.file_path),
    status: row.status as ImageStatus,
    errorMessage: row.error_message ? String(row.error_message) : null,
    errorDetails: row.error_details ? String(row.error_details) : null,
    retryAttempt: row.retry_attempt != null ? Math.max(0, Number(row.retry_attempt)) : 0,
    favorite: Boolean(row.favorite),
    generationMode: row.generation_mode === 'image-to-image' ? 'image-to-image' : 'text-to-image',
    referenceImages: row.run_id ? this.listRunReferences(String(row.run_id)) : [],
    createdAt: String(row.created_at)
  })

  private insertReferenceImage(reference: ReferenceImage): ReferenceImage {
    this.db
      .prepare(
        `insert into reference_images
        (id, name, mime_type, file_path, file_size_bytes, created_at)
        values (@id, @name, @mimeType, @filePath, @fileSizeBytes, @createdAt)`
      )
      .run(reference)
    return reference
  }

  private attachReferenceToConversation(conversationId: string, referenceImageId: string, position: number): void {
    this.db
      .prepare(
        `insert or ignore into conversation_reference_images
        (conversation_id, reference_image_id, position, created_at)
        values (?, ?, ?, ?)`
      )
      .run(conversationId, referenceImageId, position, new Date().toISOString())
  }

  private compactConversationReferencePositions(conversationId: string): ReferenceImage[] {
    const references = this.listConversationReferences(conversationId)
    const updatePosition = this.db.prepare(
      'update conversation_reference_images set position = ? where conversation_id = ? and reference_image_id = ?'
    )
    const transaction = this.db.transaction(() => {
      references.forEach((reference, index) => updatePosition.run(index, conversationId, reference.id))
    })
    transaction()
    return this.listConversationReferences(conversationId)
  }

  private listRunReferences(runId: string): ReferenceImage[] {
    return this.db
      .prepare('select * from generation_run_references where run_id = ? order by position asc, created_at asc')
      .all(runId)
      .map((row) => this.runReferenceFromRow(row as Row))
  }

  private referenceFromRow(row: Row): ReferenceImage {
    return {
      id: String(row.id),
      name: String(row.name),
      mimeType: String(row.mime_type),
      filePath: row.file_path ? String(row.file_path) : null,
      fileSizeBytes: Number(row.file_size_bytes),
      createdAt: String(row.created_at)
    }
  }

  private runReferenceFromRow(row: Row): ReferenceImage {
    return {
      id: String(row.reference_image_id),
      name: String(row.name),
      mimeType: String(row.mime_type),
      filePath: row.file_path ? String(row.file_path) : null,
      fileSizeBytes: Number(row.file_size_bytes),
      createdAt: String(row.created_at)
    }
  }

  private deleteImageFile(filePath: string): void {
    const resolved = resolve(filePath)
    const imagesRoot = resolve(this.imagesDir)
    if (resolved.startsWith(imagesRoot) && existsSync(resolved)) unlinkSync(resolved)
  }

  private getImageFileSize(filePath: unknown): number | null {
    if (!filePath) return null
    try {
      const resolved = resolve(String(filePath))
      if (!existsSync(resolved)) return null
      const stat = statSync(resolved)
      return stat.isFile() ? stat.size : null
    } catch {
      return null
    }
  }
}

function normalizeReferenceMimeType(mimeType: string, name: string): string {
  const normalized = mimeType.toLowerCase()
  if (referenceMimeTypes.has(normalized)) return normalized === 'image/jpg' ? 'image/jpeg' : normalized
  const extension = extensionFromName(name)
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.png') return 'image/png'
  if (extension === '.webp') return 'image/webp'
  throw new Error('仅支持 PNG、JPG、WEBP 参考图。')
}

function extensionFromName(name: string): string | null {
  const extension = extname(name).toLowerCase()
  if (extension === '.jpeg') return '.jpg'
  if (extension === '.jpg' || extension === '.png' || extension === '.webp') return extension
  return null
}

function mimeTypeFromExtension(extension: string): string {
  const normalized = extension.toLowerCase()
  if (normalized === '.jpg' || normalized === '.jpeg') return 'image/jpeg'
  if (normalized === '.webp') return 'image/webp'
  return 'image/png'
}

function normalizeRetryCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_IMAGE_MAX_RETRIES
  return Math.min(MAX_IMAGE_MAX_RETRIES, Math.max(0, Math.trunc(value)))
}

function parseWorkspaceType(value: unknown): WorkspaceType {
  return value === 'hand-poster' ? 'hand-poster' : 'canvas'
}

function parseRetryAttempts(value: unknown): Record<number, number> {
  const payload = parseJsonRecord(value)
  const attempts: Record<number, number> = {}
  for (const [key, attempt] of Object.entries(payload)) {
    const requestIndex = Number(key)
    if (!Number.isInteger(requestIndex) || requestIndex < 0) continue
    if (typeof attempt !== 'number' || !Number.isFinite(attempt)) continue
    attempts[requestIndex] = Math.max(0, Math.trunc(attempt))
  }
  return attempts
}

function parseRetryFailures(value: unknown): Record<number, GenerationRunRetryFailure> {
  const payload = parseJsonRecord(value)
  const failures: Record<number, GenerationRunRetryFailure> = {}
  for (const [key, failure] of Object.entries(payload)) {
    const requestIndex = Number(key)
    if (!Number.isInteger(requestIndex) || requestIndex < 0) continue
    if (!failure || typeof failure !== 'object' || Array.isArray(failure)) continue
    const record = failure as Record<string, unknown>
    if (typeof record.errorMessage !== 'string' || typeof record.errorDetails !== 'string' || typeof record.createdAt !== 'string') {
      continue
    }
    failures[requestIndex] = {
      errorMessage: record.errorMessage,
      errorDetails: record.errorDetails,
      createdAt: record.createdAt
    }
  }
  return failures
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const payload = JSON.parse(value) as unknown
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function promptTemplateFromRow(row: Row): PromptTemplate {
  return {
    id: String(row.id),
    title: String(row.title),
    category: String(row.category),
    description: String(row.description),
    prompt: String(row.prompt),
    tags: parseStringArray(row.tags),
    ratio: parseImageRatio(row.ratio),
    resolution: String(row.resolution),
    quality: parseImageQuality(row.quality)
  }
}

function normalizePromptTemplateInput(input: Partial<PromptTemplate>, fallbackId: string): PromptTemplate {
  const title = normalizeText(input.title)
  const category = normalizeText(input.category)
  const description = normalizeText(input.description)
  const prompt = normalizeText(input.prompt)
  if (!title || !category || !description || !prompt) throw new Error('提示词标题、分类、说明和正文不能为空。')
  return {
    id: normalizeText(input.id) || fallbackId,
    title,
    category,
    description,
    prompt,
    tags: Array.isArray(input.tags) ? input.tags.map(normalizeText).filter(Boolean).slice(0, 24) : [],
    ratio: parseImageRatio(input.ratio),
    resolution: normalizeText(input.resolution) || getDefaultImageSize(parseImageRatio(input.ratio)),
    quality: parseImageQuality(input.quality)
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean)
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.map(normalizeText).filter(Boolean) : []
  } catch {
    return []
  }
}

function parseImageRatio(value: unknown): ImageRatio {
  return typeof value === 'string' && ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', '9:21'].includes(value)
    ? value as ImageRatio
    : '1:1'
}

function parseImageQuality(value: unknown): ImageQuality {
  return typeof value === 'string' && ['auto', 'low', 'medium', 'high'].includes(value)
    ? value as ImageQuality
    : 'auto'
}

function fileSize(filePath: string): number {
  try {
    return existsSync(filePath) ? statSync(filePath).size : 0
  } catch {
    return 0
  }
}

function directorySize(directoryPath: string): number {
  try {
    if (!existsSync(directoryPath)) return 0
    return readdirSync(directoryPath, { withFileTypes: true }).reduce((total, entry) => {
      const childPath = join(directoryPath, entry.name)
      if (entry.isDirectory()) return total + directorySize(childPath)
      if (entry.isFile()) return total + fileSize(childPath)
      return total
    }, 0)
  } catch {
    return 0
  }
}
