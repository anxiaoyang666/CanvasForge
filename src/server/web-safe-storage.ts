import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SecretStorageAdapter } from '@core/settings'

const algorithm = 'aes-256-gcm'
const keyBytes = 32
const ivBytes = 12
const authTagBytes = 16

export class WebSafeStorage implements SecretStorageAdapter {
  private readonly key: Buffer

  constructor(private readonly keyPath: string) {
    this.key = this.loadOrCreateKey()
  }

  isEncryptionAvailable(): boolean {
    return true
  }

  encryptString(value: string): Buffer {
    const iv = randomBytes(ivBytes)
    const cipher = createCipheriv(algorithm, this.key, iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
  }

  decryptString(value: Buffer): string {
    const iv = value.subarray(0, ivBytes)
    const authTag = value.subarray(ivBytes, ivBytes + authTagBytes)
    const encrypted = value.subarray(ivBytes + authTagBytes)
    const decipher = createDecipheriv(algorithm, this.key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  }

  private loadOrCreateKey(): Buffer {
    mkdirSync(dirname(this.keyPath), { recursive: true })
    if (existsSync(this.keyPath)) {
      const key = Buffer.from(readFileSync(this.keyPath, 'utf8').trim(), 'base64')
      if (key.length === keyBytes) return key
    }
    const key = randomBytes(keyBytes)
    writeFileSync(this.keyPath, `${key.toString('base64')}\n`, { encoding: 'utf8', mode: 0o600 })
    return key
  }
}
