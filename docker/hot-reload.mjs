import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const appDir = '/app'
const pollMs = Number(process.env.CANVASFORGE_HOT_RELOAD_INTERVAL_MS || 2500)
const watchedRoots = [
  'src',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'vite.web.config.ts',
  'vite.server.config.ts',
  'vitest.config.ts'
]
const dependencyRoots = ['package.json', 'pnpm-lock.yaml']
const ignoredNames = new Set(['.git', 'data', 'dist', 'node_modules', 'out', '.DS_Store'])

let serverProcess = null
let building = false
let pending = false
let rebuildDebounce = null
let lastSnapshot = snapshot(watchedRoots)
let lastDependencySnapshot = snapshot(dependencyRoots)
let timer = null
let shuttingDown = false

console.log('CanvasForge hot reload is watching mounted source files.')
void rebuildAndRestart({ install: !existsSync(join(appDir, 'node_modules/.bin/tsc')), reason: 'initial start' })

timer = setInterval(() => {
  const currentSnapshot = snapshot(watchedRoots)
  if (currentSnapshot === lastSnapshot) return

  const dependencySnapshot = snapshot(dependencyRoots)
  const install = dependencySnapshot !== lastDependencySnapshot
  lastSnapshot = currentSnapshot
  lastDependencySnapshot = dependencySnapshot
  scheduleRebuild({ install, reason: install ? 'dependency files changed' : 'source files changed' })
}, Math.max(1000, pollMs))

function scheduleRebuild(options) {
  if (rebuildDebounce) clearTimeout(rebuildDebounce)
  rebuildDebounce = setTimeout(() => {
    rebuildDebounce = null
    startRebuild(options)
  }, 1500)
}

function startRebuild(options) {
  if (building) {
    pending = true
    return
  }
  void rebuildAndRestart(options)
}

async function rebuildAndRestart({ install, reason }) {
  building = true
  pending = false
  console.log(`CanvasForge rebuild started: ${reason}.`)

  try {
    if (install) {
      await run('pnpm', ['config', 'set', 'registry', process.env.NPM_REGISTRY || 'https://registry.npmjs.org'])
      await run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'])
      await run('pnpm', ['rebuild', 'esbuild', 'better-sqlite3'])
    }

    await run('pnpm', ['build:web'])
    await restartServer()
    console.log('CanvasForge rebuild finished. The web server is running the latest build.')
  } catch (error) {
    console.error(`CanvasForge rebuild failed: ${error.message}`)
    if (!serverProcess) {
      console.error('Initial build failed; fix the uploaded files and the watcher will try again on the next change.')
    } else {
      console.error('Keeping the previous running server because the new build did not pass.')
    }
  } finally {
    building = false
    if (pending && !shuttingDown) {
      void rebuildAndRestart({ install: true, reason: 'queued changes' })
    }
  }
}

async function restartServer() {
  await stopServer()
  const child = spawn('node', ['out/server/index.mjs'], {
    cwd: appDir,
    env: process.env,
    stdio: 'inherit'
  })
  serverProcess = child

  child.on('exit', (code, signal) => {
    if (!shuttingDown && serverProcess === child) {
      console.log(`CanvasForge server exited with code=${code ?? 'null'} signal=${signal ?? 'null'}.`)
    }
  })
}

function stopServer() {
  return new Promise((resolveStop) => {
    if (!serverProcess) {
      resolveStop()
      return
    }

    const child = serverProcess
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      resolveStop()
    }, 10000)

    child.once('exit', () => {
      clearTimeout(timeout)
      if (serverProcess === child) serverProcess = null
      resolveStop()
    })
    child.kill('SIGTERM')
  })
}

function snapshot(paths) {
  const entries = []
  for (const relativePath of paths) {
    collect(resolve(appDir, relativePath), relativePath, entries)
  }
  return entries.sort().join('\n')
}

function collect(absolutePath, relativePath, entries) {
  if (!existsSync(absolutePath)) {
    entries.push(`${relativePath}:missing`)
    return
  }

  const stat = statSync(absolutePath)
  if (stat.isDirectory()) {
    const name = relativePath.split('/').pop()
    if (ignoredNames.has(name)) return
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
      if (ignoredNames.has(entry.name)) continue
      collect(join(absolutePath, entry.name), `${relativePath}/${entry.name}`, entries)
    }
    return
  }

  entries.push(`${relativePath}:${stat.size}:${Math.floor(stat.mtimeMs)}`)
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: appDir,
      env: process.env,
      stdio: 'inherit'
    })

    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolveRun()
      } else {
        rejectRun(new Error(`${command} ${args.join(' ')} exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`))
      }
    })
  })
}

function shutdown(signal) {
  shuttingDown = true
  if (timer) clearInterval(timer)
  if (rebuildDebounce) clearTimeout(rebuildDebounce)
  if (serverProcess) serverProcess.kill('SIGTERM')
  setTimeout(() => process.exit(0), 1000).unref()
  console.log(`CanvasForge hot reload received ${signal}.`)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
