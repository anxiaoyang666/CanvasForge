import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createLoginThrottle,
  hashAccessPassword,
  isLegacyPasswordHash,
  isPathInside,
  resolveModelsRequest,
  verifyAccessPassword
} from './access-security'

describe('access password hashing', () => {
  it('uses a salted scrypt hash that verifies only the right password', () => {
    const first = hashAccessPassword('open sesame')
    const second = hashAccessPassword('open sesame')
    expect(first).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
    expect(first).not.toBe(second)
    expect(verifyAccessPassword('open sesame', first)).toBe(true)
    expect(verifyAccessPassword('open sesame ', first)).toBe(false)
    expect(isLegacyPasswordHash(first)).toBe(false)
  })

  it('still accepts hashes written by older versions so they can be upgraded', () => {
    const legacy = createHash('sha256').update('old-password').digest('hex')
    expect(isLegacyPasswordHash(legacy)).toBe(true)
    expect(verifyAccessPassword('old-password', legacy)).toBe(true)
    expect(verifyAccessPassword('wrong', legacy)).toBe(false)
  })

  it('rejects missing or malformed stored hashes', () => {
    expect(verifyAccessPassword('x', undefined)).toBe(false)
    expect(verifyAccessPassword('x', 'scrypt$zz')).toBe(false)
    expect(verifyAccessPassword('x', 'not-a-hash')).toBe(false)
  })
})

describe('login throttle', () => {
  it('blocks a source after too many failures until the window passes', () => {
    let now = 0
    const throttle = createLoginThrottle({ maxFailures: 3, windowMs: 60_000, now: () => now })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      throttle.assertAllowed('10.0.0.2')
      throttle.recordFailure('10.0.0.2')
    }
    expect(() => throttle.assertAllowed('10.0.0.2')).toThrow(/登录失败次数过多/)
    expect(() => throttle.assertAllowed('10.0.0.3')).not.toThrow()
    now = 60_000
    expect(() => throttle.assertAllowed('10.0.0.2')).not.toThrow()
  })

  it('clears the counter after a successful login', () => {
    const throttle = createLoginThrottle({ maxFailures: 2 })
    throttle.recordFailure('a')
    throttle.recordSuccess('a')
    throttle.recordFailure('a')
    expect(() => throttle.assertAllowed('a')).not.toThrow()
  })
})

describe('isPathInside', () => {
  it('rejects sibling directories that only share a prefix', () => {
    expect(isPathInside('/app/data', '/app/data/settings.json')).toBe(true)
    expect(isPathInside('/app/data', '/app/data')).toBe(true)
    expect(isPathInside('/app/data', '/app/data-evil/settings.json')).toBe(false)
    expect(isPathInside('/app/data', '/app/data/../secret')).toBe(false)
    expect(isPathInside('/app/data', '/app/data/..hidden')).toBe(true)
  })
})

describe('resolveModelsRequest', () => {
  const stored = { baseURL: 'https://api.example.com/', apiKey: 'sk-stored' }

  it('uses the stored key only for the stored base URL', () => {
    expect(resolveModelsRequest({}, stored)).toEqual({ baseURL: 'https://api.example.com', apiKey: 'sk-stored' })
    expect(resolveModelsRequest({ baseURL: 'https://api.example.com' }, stored).apiKey).toBe('sk-stored')
  })

  it('never sends the stored key to a different base URL', () => {
    expect(() => resolveModelsRequest({ baseURL: 'https://attacker.example' }, stored)).toThrow(/重新填写 API Key/)
    expect(resolveModelsRequest({ baseURL: 'https://other.example', apiKey: ' sk-new ' }, stored)).toEqual({
      baseURL: 'https://other.example',
      apiKey: 'sk-new'
    })
  })

  it('rejects non-http base URLs and missing keys', () => {
    expect(() => resolveModelsRequest({ baseURL: 'file:///etc/passwd', apiKey: 'k' }, stored)).toThrow(/http/)
    expect(() => resolveModelsRequest({ baseURL: 'not a url', apiKey: 'k' }, stored)).toThrow(/格式不正确/)
    expect(() => resolveModelsRequest({}, { baseURL: 'https://api.example.com', apiKey: null })).toThrow(/API key/)
  })
})
