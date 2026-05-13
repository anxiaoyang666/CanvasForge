import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { AppDatabase } from '@core/database'
import { ImageService } from '@core/image-service'
import { PromptService } from '@core/prompt-service'
import { SettingsStore } from '@core/settings'
import { WebSafeStorage } from './web-safe-storage'
import type {
  ConversationCreateInput,
  ConversationUpdate,
  GenerateImageInput,
  HistoryListOptions,
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
    if (method === 'GET' && pathname === '/api/settings') {
      sendJson(response, 200, context.settings.getPublicSettings())
      return
    }
    if (method === 'PUT' && pathname === '/api/settings') {
      sendJson(response, 200, context.settings.update(await readJson<ProviderSettingsUpdate>(request)))
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
  return options
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
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
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
