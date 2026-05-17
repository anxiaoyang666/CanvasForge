import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, extname, join, normalize, relative, resolve } from 'node:path'
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto'
import { AppDatabase } from '@core/database'
import { ImageService } from '@core/image-service'
import { PromptService } from '@core/prompt-service'
import { SettingsStore } from '@core/settings'
import { WebSafeStorage } from './web-safe-storage'
import type {
  AccessLoginInput,
  AccessPasswordUpdate,
  BackupManifest,
  ConversationCreateInput,
  ConversationUpdate,
  GenerateImageInput,
  HistoryListOptions,
  PromptTemplate,
  PromptTemplateInput,
  ProviderModel,
  ProviderModelsInput,
  PromptAssistInput,
  ProviderSettingsUpdate,
  ReferenceImageImportFile
} from '@shared/types'

type HandlerContext = {
  database: AppDatabase
  imageService: ImageService
  promptService: PromptService
  settings: SettingsStore
}

const port = Number(process.env.PORT || 3000)
const host = process.env.HOST || '0.0.0.0'
const dataDir = resolve(process.env.CANVASFORGE_DATA_DIR || join(process.cwd(), 'data'))
const staticDir = resolve(process.env.CANVASFORGE_STATIC_DIR || join(process.cwd(), 'out/renderer'))
const buildMarker = 'canvasforge-web-encryption-check-2026-05-11'
const maxJsonBodyBytes = Number(process.env.CANVASFORGE_MAX_JSON_BODY_BYTES || 28 * 1024 * 1024)
const access = createAccessController(join(dataDir, 'access.json'))

const database = new AppDatabase(dataDir)
database.recoverInterruptedRuns()
const webSafeStorage = new WebSafeStorage(join(dataDir, 'secret.key'))
const settings = new SettingsStore(join(dataDir, 'settings.json'), webSafeStorage)
const imageService = new ImageService(database, settings)
const promptService = new PromptService(settings)
const context: HandlerContext = { database, imageService, promptService, settings }

const server = createServer((request, response) => {
  void routeRequest(request, response, context).catch((error) => {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'Internal server error.' })
  })
})

server.listen(port, host, () => {
  console.log(`CanvasForge build marker: ${buildMarker}`)
  console.log(`CanvasForge web server listening on http://${host}:${port}`)
  console.log(`CanvasForge data directory: ${dataDir}`)
  console.log(`CanvasForge web encryption available: ${webSafeStorage.isEncryptionAvailable()}`)
})

function shutdown(signal: NodeJS.Signals): void {
  console.log(`Received ${signal}, shutting down CanvasForge web server...`)
  server.close(() => {
    database.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10000).unref()
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

async function routeRequest(request: IncomingMessage, response: ServerResponse, context: HandlerContext): Promise<void> {
  const method = request.method || 'GET'
  const requestUrl = new URL(request.url || '/', 'http://localhost')
  const pathname = decodeURIComponent(requestUrl.pathname)

  if (method === 'GET' && pathname === '/healthz') {
    sendJson(response, 200, {
      ok: true,
      buildMarker,
      encryptionAvailable: webSafeStorage.isEncryptionAvailable()
    })
    return
  }

  if (pathname.startsWith('/api/')) {
    if (!isApiRequestAllowed(request, pathname)) {
      sendJson(response, 401, { error: '需要先输入访问密码。' })
      return
    }
    await handleApi(request, response, context, pathname, requestUrl)
    return
  }

  if (method === 'GET' && pathname.startsWith('/images/')) {
    serveDatabaseImage(response, context.database, pathname)
    return
  }

  if (method === 'GET') {
    serveStatic(response, pathname)
    return
  }

  sendJson(response, 405, { error: 'Method not allowed.' })
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  context: HandlerContext,
  pathname: string,
  requestUrl: URL
): Promise<void> {
  const method = request.method || 'GET'

  try {
    if (method === 'GET' && pathname === '/api/access/status') {
      sendJson(response, 200, access.status(request))
      return
    }
    if (method === 'POST' && pathname === '/api/access/login') {
      const status = access.login(request, response, await readJson<AccessLoginInput>(request, { password: '' }))
      sendJson(response, 200, status)
      return
    }
    if (method === 'POST' && pathname === '/api/access/logout') {
      sendJson(response, 200, access.logout(response))
      return
    }
    if (method === 'PUT' && pathname === '/api/access/password') {
      sendJson(response, 200, access.updatePassword(request, response, await readJson<AccessPasswordUpdate>(request)))
      return
    }

    if (method === 'GET' && pathname === '/api/maintenance/status') {
      sendJson(response, 200, context.database.getMaintenanceStatus(dataDir))
      return
    }
    if (method === 'GET' && pathname === '/api/maintenance/backup') {
      sendBackup(response)
      return
    }
    if (method === 'POST' && pathname === '/api/maintenance/restore') {
      restoreBackup(await readJson<BackupManifest>(request))
      sendJson(response, 200, { ok: true, restarting: true })
      setTimeout(() => {
        database.close()
        process.exit(0)
      }, 300).unref()
      return
    }

    if (method === 'GET' && pathname === '/api/settings') {
      sendJson(response, 200, context.settings.getPublicSettings())
      return
    }
    if (method === 'PUT' && pathname === '/api/settings') {
      sendJson(response, 200, context.settings.update(await readJson<ProviderSettingsUpdate>(request)))
      return
    }
    if (method === 'POST' && pathname === '/api/settings/models') {
      sendJson(response, 200, await listProviderModels(context.settings, await readJson<ProviderModelsInput>(request, {})))
      return
    }

    if (method === 'GET' && pathname === '/api/conversations') {
      sendJson(response, 200, context.database.listConversations())
      return
    }
    if (method === 'POST' && pathname === '/api/conversations') {
      sendJson(response, 200, context.database.createConversation(await readJson<ConversationCreateInput>(request, {})))
      return
    }
    const conversationMatch = pathname.match(/^\/api\/conversations\/([^/]+)$/)
    if (conversationMatch && method === 'PUT') {
      sendJson(response, 200, context.database.updateConversation(conversationMatch[1], await readJson<ConversationUpdate>(request)))
      return
    }
    if (conversationMatch && method === 'DELETE') {
      context.database.deleteConversation(conversationMatch[1])
      sendJson(response, 200, { ok: true })
      return
    }
    const conversationRunsMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/runs$/)
    if (conversationRunsMatch && method === 'GET') {
      sendJson(response, 200, context.database.listRuns(conversationRunsMatch[1]))
      return
    }

    if (method === 'GET' && pathname === '/api/history') {
      sendJson(response, 200, context.database.listHistory(readHistoryOptions(requestUrl)))
      return
    }
    const historyMatch = pathname.match(/^\/api\/history\/([^/]+)$/)
    if (historyMatch && method === 'DELETE') {
      context.database.deleteHistory(historyMatch[1])
      sendJson(response, 200, { ok: true })
      return
    }
    const favoriteMatch = pathname.match(/^\/api\/history\/([^/]+)\/favorite$/)
    if (favoriteMatch && method === 'PUT') {
      const body = await readJson<{ favorite: boolean }>(request)
      sendJson(response, 200, context.database.setFavorite(favoriteMatch[1], Boolean(body.favorite)))
      return
    }

    if (method === 'POST' && pathname === '/api/images/generate') {
      sendJson(response, 200, await context.imageService.generate(await readJson<GenerateImageInput>(request)))
      return
    }
    const cancelMatch = pathname.match(/^\/api\/images\/([^/]+)\/cancel$/)
    if (cancelMatch && method === 'POST') {
      const body = await readJson<{ requestIndex?: number }>(request, {})
      context.imageService.cancelRunGeneration(cancelMatch[1], body.requestIndex)
      sendJson(response, 200, { ok: true })
      return
    }

    if (method === 'POST' && pathname === '/api/prompt/inspire') {
      sendJson(response, 200, { text: await context.promptService.inspire(await readJson<PromptAssistInput>(request, {})) })
      return
    }
    if (method === 'POST' && pathname === '/api/prompt/enrich') {
      sendJson(response, 200, { text: await context.promptService.enrich(await readJson<PromptAssistInput & { prompt: string }>(request)) })
      return
    }
    if (method === 'GET' && pathname === '/api/prompt-library') {
      sendJson(response, 200, context.database.listPromptTemplates())
      return
    }
    if (method === 'POST' && pathname === '/api/prompt-library') {
      sendJson(response, 200, context.database.createPromptTemplate(await readJson<PromptTemplateInput>(request)))
      return
    }
    if (method === 'POST' && pathname === '/api/prompt-library/import') {
      sendJson(response, 200, context.database.importPromptTemplates(await readJson<PromptTemplate[]>(request, [])))
      return
    }
    const promptTemplateMatch = pathname.match(/^\/api\/prompt-library\/([^/]+)$/)
    if (promptTemplateMatch && method === 'PUT') {
      sendJson(response, 200, context.database.updatePromptTemplate(promptTemplateMatch[1], await readJson<PromptTemplateInput>(request)))
      return
    }
    if (promptTemplateMatch && method === 'DELETE') {
      context.database.deletePromptTemplate(promptTemplateMatch[1])
      sendJson(response, 200, { ok: true })
      return
    }

    const importMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/references$/)
    if (importMatch && method === 'POST') {
      const files = await readJson<ReferenceImageImportFile[]>(request)
      for (const file of files) {
        context.database.createReferenceImageFromBytes({
          conversationId: importMatch[1],
          ...file,
          data: base64ToBuffer(String(file.data))
        })
      }
      sendJson(response, 200, context.database.listConversationReferences(importMatch[1]))
      return
    }
    const addReferenceMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/references\/from-history$/)
    if (addReferenceMatch && method === 'POST') {
      const body = await readJson<{ historyId: string }>(request)
      context.database.addHistoryImageAsReference(addReferenceMatch[1], body.historyId)
      sendJson(response, 200, context.database.listConversationReferences(addReferenceMatch[1]))
      return
    }
    const referenceMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/references\/([^/]+)$/)
    if (referenceMatch && method === 'DELETE') {
      sendJson(response, 200, context.database.removeReferenceFromConversation(referenceMatch[1], referenceMatch[2]))
      return
    }
    const reorderMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/references\/reorder$/)
    if (reorderMatch && method === 'PUT') {
      const body = await readJson<{ referenceImageIds: string[] }>(request)
      sendJson(response, 200, context.database.reorderConversationReferences(reorderMatch[1], body.referenceImageIds || []))
      return
    }

    sendJson(response, 404, { error: 'Not found.' })
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : 'Request failed.' })
  }
}

function readHistoryOptions(requestUrl: URL): HistoryListOptions {
  const options: HistoryListOptions = {}
  const query = requestUrl.searchParams.get('query')
  const sort = requestUrl.searchParams.get('sort')
  const favoritesOnly = requestUrl.searchParams.get('favoritesOnly')
  if (query) options.query = query
  if (sort === 'newest' || sort === 'oldest') options.sort = sort
  if (favoritesOnly === 'true') options.favoritesOnly = true
  const workspaceType = requestUrl.searchParams.get('workspaceType')
  if (workspaceType === 'canvas' || workspaceType === 'hand-poster' || workspaceType === 'all') {
    options.workspaceType = workspaceType
  }
  return options
}

async function listProviderModels(settings: SettingsStore, input: ProviderModelsInput = {}): Promise<ProviderModel[]> {
  const publicSettings = settings.getPublicSettings()
  const baseURL = (input.baseURL || publicSettings.baseURL).trim().replace(/\/+$/, '')
  const apiKey = input.apiKey?.trim() || settings.getApiKey()
  if (!apiKey) throw new Error('API key is not configured.')
  const response = await fetch(`${baseURL}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  })
  const text = await response.text()
  const payload = parseModelsPayload(text)
  if (!response.ok) {
    throw new Error(payload.error?.message || `Models request failed with HTTP ${response.status}.`)
  }
  return (payload.data || [])
    .map((model) => {
      const id = typeof model.id === 'string' ? model.id.trim() : ''
      return id ? { id, label: id } : null
    })
    .filter((model): model is ProviderModel => Boolean(model))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function parseModelsPayload(text: string): {
  data?: Array<{ id?: unknown }>
  error?: { message?: string }
} {
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as { data?: Array<{ id?: unknown }>; error?: { message?: string } }
  } catch {
    return {}
  }
}

function serveDatabaseImage(response: ServerResponse, database: AppDatabase, pathname: string): void {
  const match = pathname.match(/^\/images\/(image|reference)\/([^/]+)$/)
  if (!match) {
    sendJson(response, 404, { error: 'Image not found.' })
    return
  }
  const id = match[2]
  const item = match[1] === 'reference' ? database.getReferenceImage(id) : database.getHistory(id)
  if (!item?.filePath || !existsSync(item.filePath)) {
    sendJson(response, 404, { error: 'Image not found.' })
    return
  }
  const stat = statSync(item.filePath)
  response.writeHead(200, {
    'Content-Type': contentTypeForPath(item.filePath),
    'Content-Length': stat.size,
    'Content-Disposition': `inline; filename="${encodeHeaderFilename(item.filePath)}"`,
    'Cache-Control': 'private, max-age=3600'
  })
  createReadStream(item.filePath).pipe(response)
}

function serveStatic(response: ServerResponse, pathname: string): void {
  const normalizedPath = normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  const filePath = resolve(staticDir, normalizedPath === '/' ? 'index.html' : normalizedPath.slice(1))
  if (!filePath.startsWith(staticDir)) {
    sendJson(response, 403, { error: 'Forbidden.' })
    return
  }
  const target = existsSync(filePath) && statSync(filePath).isFile() ? filePath : join(staticDir, 'index.html')
  if (!existsSync(target)) {
    sendJson(response, 404, { error: 'Web assets not built. Run pnpm build:web first.' })
    return
  }
  response.writeHead(200, {
    'Content-Type': contentTypeForPath(target),
    'Cache-Control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable'
  })
  createReadStream(target).pipe(response)
}

function readJson<T>(request: IncomingMessage, fallback?: T): Promise<T> {
  return new Promise((resolveJson, reject) => {
    const chunks: Buffer[] = []
    let receivedBytes = 0
    request.on('data', (chunk) => {
      const buffer = Buffer.from(chunk)
      receivedBytes += buffer.length
      if (receivedBytes > maxJsonBodyBytes) {
        reject(new Error(`请求内容不能超过 ${formatBytes(maxJsonBodyBytes)}。`))
        request.destroy()
        return
      }
      chunks.push(buffer)
    })
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text.trim() && fallback !== undefined) {
        resolveJson(fallback)
        return
      }
      try {
        resolveJson(JSON.parse(text) as T)
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  })
  response.end(body)
}

function isApiRequestAllowed(request: IncomingMessage, pathname: string): boolean {
  if (pathname === '/api/access/status' || pathname === '/api/access/login') return true
  return access.isAllowed(request)
}

type AccessController = ReturnType<typeof createAccessController>

function createAccessController(filePath: string) {
  type AccessFile = {
    passwordHash?: string
    sessionTokenHash?: string
  }
  const cookieName = 'canvasforge_session'
  const read = (): AccessFile => {
    if (!existsSync(filePath)) return {}
    try {
      return JSON.parse(readFileSync(filePath, 'utf8')) as AccessFile
    } catch {
      return {}
    }
  }
  const write = (payload: AccessFile): void => {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  }
  const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
  const hasPassword = (): boolean => Boolean(read().passwordHash)
  const cookieToken = (request: IncomingMessage): string | null => {
    const cookie = request.headers.cookie || ''
    const match = cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${cookieName}=`))
    return match ? decodeURIComponent(match.slice(cookieName.length + 1)) : null
  }
  const tokenMatches = (token: string, expectedHash: string): boolean => {
    const actual = Buffer.from(hash(token), 'hex')
    const expected = Buffer.from(expectedHash, 'hex')
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }
  const setSessionCookie = (response: ServerResponse, token: string): void => {
    response.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`)
  }
  const clearSessionCookie = (response: ServerResponse): void => {
    response.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
  }
  return {
    isAllowed(request: IncomingMessage): boolean {
      const payload = read()
      if (!payload.passwordHash) return true
      const token = cookieToken(request)
      return Boolean(token && payload.sessionTokenHash && tokenMatches(token, payload.sessionTokenHash))
    },
    status(request: IncomingMessage) {
      return {
        protectionEnabled: hasPassword(),
        authenticated: this.isAllowed(request)
      }
    },
    login(request: IncomingMessage, response: ServerResponse, input: AccessLoginInput) {
      const payload = read()
      if (!payload.passwordHash) return this.status(request)
      const password = typeof input.password === 'string' ? input.password : ''
      if (!tokenMatches(password, payload.passwordHash)) {
        throw new Error('访问密码不正确。')
      }
      const token = randomBytes(32).toString('hex')
      write({ ...payload, sessionTokenHash: hash(token) })
      setSessionCookie(response, token)
      return { protectionEnabled: true, authenticated: true }
    },
    logout(response: ServerResponse) {
      const payload = read()
      write({ ...payload, sessionTokenHash: undefined })
      clearSessionCookie(response)
      return { protectionEnabled: Boolean(payload.passwordHash), authenticated: false }
    },
    updatePassword(request: IncomingMessage, response: ServerResponse, input: AccessPasswordUpdate) {
      const password = typeof input.password === 'string' ? input.password.trim() : ''
      if (!password) {
        write({})
        clearSessionCookie(response)
        return { protectionEnabled: false, authenticated: true }
      }
      const token = randomBytes(32).toString('hex')
      write({ passwordHash: hash(password), sessionTokenHash: hash(token) })
      setSessionCookie(response, token)
      return { protectionEnabled: true, authenticated: this.isAllowed(request) || true }
    }
  }
}

function sendBackup(response: ServerResponse): void {
  const manifest: BackupManifest = {
    app: 'CanvasForge',
    version: 1,
    exportedAt: new Date().toISOString(),
    files: []
  }
  for (const filePath of collectBackupFiles(dataDir)) {
    manifest.files.push({
      path: relative(dataDir, filePath).replaceAll('\\', '/'),
      contentBase64: readFileSync(filePath).toString('base64')
    })
  }
  const body = JSON.stringify(manifest)
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Content-Disposition': `attachment; filename="canvasforge-backup-${new Date().toISOString().slice(0, 10)}.json"`
  })
  response.end(body)
}

function restoreBackup(manifest: BackupManifest): void {
  if (!manifest || manifest.app !== 'CanvasForge' || !Array.isArray(manifest.files)) {
    throw new Error('备份文件格式不正确。')
  }
  const restoreRoot = dataDir
  const backupBeforeRestore = join(dataDir, 'restore-safety-copy')
  mkdirSync(backupBeforeRestore, { recursive: true })
  for (const filePath of collectBackupFiles(dataDir)) {
    const target = join(backupBeforeRestore, relative(dataDir, filePath))
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(filePath, target)
  }
  for (const file of manifest.files) {
    const normalizedPath = normalize(String(file.path || '')).replace(/^(\.\.[/\\])+/, '')
    const target = resolve(restoreRoot, normalizedPath)
    if (!target.startsWith(restoreRoot)) throw new Error('备份中包含非法路径。')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, Buffer.from(String(file.contentBase64 || ''), 'base64'))
  }
}

function collectBackupFiles(root: string): string[] {
  const files: string[] = []
  const visit = (directory: string): void => {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filePath = join(directory, entry.name)
      if (entry.name === 'restore-safety-copy') continue
      if (entry.isDirectory()) {
        visit(filePath)
      } else if (entry.isFile()) {
        files.push(filePath)
      }
    }
  }
  visit(root)
  return files
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)}MB`
  if (value >= 1024) return `${Math.round(value / 1024)}KB`
  return `${value}B`
}

function base64ToBuffer(value: string | ArrayBuffer): Buffer {
  if (typeof value !== 'string') return Buffer.from(value)
  const [, payload = value] = value.match(/^data:[^;]+;base64,(.*)$/) || []
  return Buffer.from(payload, 'base64')
}

function contentTypeForPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.ico':
      return 'image/x-icon'
    case '.svg':
      return 'image/svg+xml'
    default:
      return 'application/octet-stream'
  }
}

function encodeHeaderFilename(filePath: string): string {
  return filePath.split(/[/\\]/).pop()?.replace(/["\\]/g, '_') || 'canvasforge-image'
}
