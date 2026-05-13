import { useEffect, useState, type JSX } from 'react'
import { RefreshCw, Settings, X } from 'lucide-react'
import { DEFAULT_PROMPT_MODEL } from '@shared/prompt-options'
import type { ProviderModel } from '@shared/types'
import { useAppStore } from '@renderer/store/app-store'
import { EditableSelect } from '@renderer/components/common/EditableSelect'

export function ApiSettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const { settings, updateSettings } = useAppStore()
  const [baseURL, setBaseURL] = useState(settings?.baseURL || 'https://api.openai.com')
  const [defaultModel, setDefaultModel] = useState(settings?.defaultModel || 'gpt-image-2')
  const [promptModel, setPromptModel] = useState(settings?.promptModel || DEFAULT_PROMPT_MODEL)
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<ProviderModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)

  useEffect(() => {
    if (!settings) return
    setBaseURL(settings.baseURL)
    setDefaultModel(settings.defaultModel)
    setPromptModel(settings.promptModel)
  }, [settings])

  useEffect(() => {
    void refreshModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshModels = async () => {
    setModelsLoading(true)
    setModelsError(null)
    try {
      const nextModels = await window.canvasForge.settings.models({
        baseURL,
        apiKey: apiKey.trim() || undefined
      })
      setModels(nextModels)
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : '模型列表获取失败')
    } finally {
      setModelsLoading(false)
    }
  }

  return (
    <div className="modal open api-settings-modal" role="dialog" aria-modal="true" aria-label="API 设置" onClick={onClose}>
      <div className="modal-panel api-settings-panel" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <span>API 设置</span>
          <button type="button" className="icon-only" title="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="api-settings-body">
          <section className="panel">
            <h3>
              服务配置
              <span className={`pill ${settings?.apiKeyStored ? 'good' : 'warn'}`}>{settings?.apiKeyStored ? '已配置' : '未配置'}</span>
            </h3>
            <label className="field">
              <span>Base URL</span>
              <input className="input-control" value={baseURL} onChange={(event) => setBaseURL(event.target.value)} />
            </label>
            <label className="field">
              <span>API Key</span>
              <input
                className="input-control"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                type="password"
                placeholder={settings?.apiKeyStored ? '已保存，留空不修改' : 'sk-...'}
              />
            </label>
            <label className="field">
              <span>图片默认模型</span>
              <EditableSelect
                value={defaultModel}
                options={models.map((model) => ({ value: model.id, label: model.label }))}
                ariaLabel="图片默认模型"
                placeholder={modelsLoading ? '正在获取模型...' : '选择或输入模型名'}
                allowCreate
                onChange={setDefaultModel}
              />
            </label>
            <label className="field">
              <span>提示词助手模型</span>
              <EditableSelect
                value={promptModel}
                options={models.map((model) => ({ value: model.id, label: model.label }))}
                ariaLabel="提示词助手模型"
                placeholder={modelsLoading ? '正在获取模型...' : '选择或输入模型名'}
                allowCreate
                onChange={setPromptModel}
              />
            </label>
            <button type="button" className="full" disabled={modelsLoading} onClick={() => void refreshModels()}>
              <RefreshCw className={modelsLoading ? 'spin' : ''} size={15} />
              {modelsLoading ? '正在获取模型' : `刷新模型列表${models.length ? ` · ${models.length}` : ''}`}
            </button>
            {modelsError ? <div className="status-error">{modelsError}</div> : null}
            {settings?.insecureStorage ? <div className="status-error">当前系统无法加密，API Key 已降级保存在本地设置文件中。</div> : null}
          </section>
          <div className="api-settings-actions">
            <button type="button" onClick={onClose}>取消</button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                void updateSettings({ baseURL, defaultModel, promptModel, apiKey: apiKey.trim() ? apiKey : undefined })
                setApiKey('')
                onClose()
              }}
            >
              <Settings size={15} />
              保存 API 设置
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
