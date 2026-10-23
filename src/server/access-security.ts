import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const SCRYPT_PREFIX = 'scrypt'
const SCRYPT_KEY_BYTES = 32
const LEGACY_SHA256_HEX = /^[0-9a-f]{64}$/i

// 访问密码：scrypt + 随机盐。旧版本存的是无盐 SHA-256，登录成功后由调用方升级。
export function hashAccessPassword(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, SCRYPT_KEY_BYTES)
  return `${SCRYPT_PREFIX}$${salt.toString('hex')}$${key.toString('hex')}`
}

export function verifyAccessPassword(password: string, stored: string | undefined): boolean {
  if (!stored) return false
  if (stored.startsWith(`${SCRYPT_PREFIX}$`)) {
    const [, saltHex, keyHex] = stored.split('$')
    if (!saltHex || !keyHex) return false
    const expected = Buffer.from(keyHex, 'hex')
    if (expected.length !== SCRYPT_KEY_BYTES) return false
    const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEY_BYTES)
    return timingSafeEqual(actual, expected)
  }
  if (LEGACY_SHA256_HEX.test(stored)) {
    const actual = createHash('sha256').update(password).digest()
    return timingSafeEqual(actual, Buffer.from(stored, 'hex'))
  }
  return false
}

export function isLegacyPasswordHash(stored: string | undefined): boolean {
  return Boolean(stored) && !String(stored).startsWith(`${SCRYPT_PREFIX}$`)
}

// 登录失败节流：同一来源在窗口期内失败次数到上限后暂停登录，成功后清零。
export function createLoginThrottle(options: { maxFailures?: number; windowMs?: number; now?: () => number } = {}) {
  const maxFailures = options.maxFailures ?? 10
  const windowMs = options.windowMs ?? 15 * 60 * 1000
  const now = options.now ?? Date.now
  const failures = new Map<string, { count: number; first: number }>()

  const current = (key: string) => {
    const entry = failures.get(key)
    if (entry && now() - entry.first >= windowMs) {
      failures.delete(key)
      return undefined
    }
    return entry
  }

  return {
    assertAllowed(key: string): void {
      const entry = current(key)
      if (entry && entry.count >= maxFailures) {
        const minutes = Math.max(1, Math.ceil((windowMs - (now() - entry.first)) / 60_000))
        throw new Error(`登录失败次数过多，请 ${minutes} 分钟后再试。`)
      }
    },
    recordFailure(key: string): void {
      const entry = current(key)
      if (entry) {
        entry.count += 1
      } else {
        if (failures.size >= 1000) failures.delete(failures.keys().next().value as string)
        failures.set(key, { count: 1, first: now() })
      }
    },
    recordSuccess(key: string): void {
      failures.delete(key)
    }
  }
}

export function isPathInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (!isAbsolute(rel) && rel.split(sep)[0] !== '..')
}

export function normalizeBaseURL(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

// 拉取模型列表时，已保存的 API Key 只发往已保存的服务地址；换了地址必须同时给出新的 Key，
// 否则任何能调接口的人都能把密钥发到自己指定的服务器上。
export function resolveModelsRequest(
  input: { baseURL?: string; apiKey?: string },
  stored: { baseURL: string; apiKey: string | null }
): { baseURL: string; apiKey: string } {
  const storedBaseURL = normalizeBaseURL(stored.baseURL)
  const baseURL = normalizeBaseURL(input.baseURL || stored.baseURL)
  let protocol = ''
  try {
    protocol = new URL(baseURL).protocol
  } catch {
    throw new Error('服务地址格式不正确。')
  }
  if (protocol !== 'http:' && protocol !== 'https:') throw new Error('服务地址只支持 http 或 https。')
  const inputKey = input.apiKey?.trim()
  if (inputKey) return { baseURL, apiKey: inputKey }
  if (!stored.apiKey) throw new Error('API key is not configured.')
  if (baseURL !== storedBaseURL) throw new Error('更换服务地址后请重新填写 API Key，再刷新模型列表。')
  return { baseURL, apiKey: stored.apiKey }
}
