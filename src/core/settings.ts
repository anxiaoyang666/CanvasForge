import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_MODEL } from '@shared/image-options'
import { DEFAULT_PROMPT_MODEL } from '@shared/prompt-options'
import type { ProviderSettings, ProviderSettingsUpdate } from '@shared/types'

type SettingsFile = {
  baseURL: string
  defaultModel: string
  promptModel: string
  encryptedApiKey?: string
  plainApiKey?: string
  insecureStorage?: boolean
}

export type SecretStorageAdapter = {
  isEncryptionAvailable: () => boolean
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}

const defaultSettings: SettingsFile = {
  baseURL: 'https://api.openai.com',
  defaultModel: DEFAULT_MODEL,
  promptModel: DEFAULT_PROMPT_MODEL,
  insecureStorage: false
}

export class SettingsStore {
  constructor(
    private readonly filePath: string,
    private readonly secretStorage?: SecretStorageAdapter
  ) {
    mkdirSync(dirname(filePath), { recursive: true })
  }

  getPublicSettings(): ProviderSettings {
    const settings = this.readMigrated()
    return {
      baseURL: settings.baseURL,
      defaultModel: settings.defaultModel,
      promptModel: settings.promptModel,
      apiKeyStored: Boolean(settings.encryptedApiKey || settings.plainApiKey),
      insecureStorage: Boolean(settings.insecureStorage)
    }
  }

  getApiKey(): string | null {
    const settings = this.readMigrated()
    if (settings.encryptedApiKey && this.secretStorage?.isEncryptionAvailable()) {
      return this.secretStorage.decryptString(Buffer.from(settings.encryptedApiKey, 'base64'))
    }
    return settings.plainApiKey || null
  }

  update(input: ProviderSettingsUpdate): ProviderSettings {
    const current = this.read()
    const next: SettingsFile = {
      ...current,
      ...(input.baseURL !== undefined ? { baseURL: input.baseURL.trim().replace(/\/+$/, '') || defaultSettings.baseURL } : {}),
      ...(input.defaultModel !== undefined ? { defaultModel: input.defaultModel.trim() || DEFAULT_MODEL } : {}),
      ...(input.promptModel !== undefined ? { promptModel: input.promptModel.trim() || DEFAULT_PROMPT_MODEL } : {})
    }

    if (input.apiKey !== undefined) {
      const key = input.apiKey?.trim() || ''
      delete next.encryptedApiKey
      delete next.plainApiKey
      next.insecureStorage = false
      if (key && this.secretStorage?.isEncryptionAvailable()) {
        next.encryptedApiKey = this.secretStorage.encryptString(key).toString('base64')
      } else if (key) {
        next.plainApiKey = key
        next.insecureStorage = true
      }
    }

    this.write(next)
    return this.getPublicSettings()
  }

  private read(): SettingsFile {
    if (!existsSync(this.filePath)) return defaultSettings
    try {
      return { ...defaultSettings, ...JSON.parse(readFileSync(this.filePath, 'utf8')) }
    } catch {
      return defaultSettings
    }
  }

  private write(settings: SettingsFile): void {
    writeFileSync(this.filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  }

  private readMigrated(): SettingsFile {
    const settings = this.read()
    if (!this.secretStorage?.isEncryptionAvailable()) return settings

    if (settings.plainApiKey) {
      const migrated: SettingsFile = {
        ...settings,
        encryptedApiKey: this.secretStorage.encryptString(settings.plainApiKey).toString('base64'),
        insecureStorage: false
      }
      delete migrated.plainApiKey
      this.write(migrated)
      return migrated
    }

    if (settings.insecureStorage) {
      const migrated: SettingsFile = {
        ...settings,
        insecureStorage: false
      }
      this.write(migrated)
      return migrated
    }

    return settings
  }
}
