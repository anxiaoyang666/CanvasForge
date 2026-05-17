import { useEffect, useState, type JSX } from 'react'
import { BookOpen, FilePenLine, HardDrive, Image as ImageIcon, PencilLine, Plug, Plus, Shield } from 'lucide-react'
import type { MaintenanceStatus } from '@shared/types'
import { useAppStore } from '@renderer/store/app-store'
import { ApiSettingsModal } from '@renderer/components/settings/ApiSettingsModal'
import { MaintenanceModal } from '@renderer/components/maintenance/MaintenanceModal'
import logoMark from '@renderer/assets/logo-mark.svg'

export function Topbar(): JSX.Element {
  const { settings, view, setView, createConversation } = useAppStore()
  const [apiSettingsVisible, setApiSettingsVisible] = useState(false)
  const [maintenanceVisible, setMaintenanceVisible] = useState(false)
  const [maintenanceStatus, setMaintenanceStatus] = useState<MaintenanceStatus | null>(null)
  const endpoint = `${settings?.baseURL || 'https://api.openai.com'}/v1/images/generations`

  useEffect(() => {
    void window.canvasForge.maintenance.status().then(setMaintenanceStatus).catch(() => setMaintenanceStatus(null))
  }, [])
  const createCurrentConversation = () => {
    if (view === 'poster') {
      void createConversation({
        workspaceType: 'hand-poster',
        ratio: '4:3',
        size: '2048x1536',
        outputFormat: 'png',
        background: 'opaque'
      }, { workspaceType: 'hand-poster' })
      return
    }
    void createConversation()
  }

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <img src={logoMark} alt="" />
        </div>
        <div className="brand-copy">
          <h1>CanvasForge</h1>
          <span>创作控制台</span>
        </div>
      </div>
      <div className="endpoint">
        <span className={settings?.apiKeyStored ? 'dot good' : 'dot warn'} />
        <span>{settings?.apiKeyStored ? '通道在线' : '等待密钥'}</span>
        <code>{endpoint}</code>
      </div>
      {maintenanceStatus ? (
        <button className="top-metric" onClick={() => setMaintenanceVisible(true)} title="查看数据状态">
          <HardDrive size={15} />
          <span>{maintenanceStatus.counts.succeededImages} 图</span>
          <strong>{formatBytes(maintenanceStatus.storage.totalBytes)}</strong>
        </button>
      ) : null}
      <nav className="top-actions" aria-label="主导航">
        <button className={view === 'workspace' ? 'active-soft' : ''} onClick={() => setView('workspace')}>
          <PencilLine size={16} />
          画布
        </button>
        <button className={view === 'poster' ? 'active-soft' : ''} onClick={() => setView('poster')}>
          <FilePenLine size={16} />
          手抄报
        </button>
        <button className={view === 'gallery' ? 'active-soft' : ''} onClick={() => setView('gallery')}>
          <ImageIcon size={16} />
          图库
        </button>
        <button className={view === 'prompts' ? 'active-soft' : ''} onClick={() => setView('prompts')}>
          <BookOpen size={16} />
          提示词库
        </button>
        <button onClick={() => setApiSettingsVisible(true)} title="API 设置">
          <Plug size={16} />
          API
        </button>
        <button onClick={() => setMaintenanceVisible(true)} title="系统维护">
          <Shield size={16} />
          维护
        </button>
        <button className="primary" onClick={createCurrentConversation}>
          <Plus size={16} />
          新建会话
        </button>
      </nav>
      {apiSettingsVisible ? <ApiSettingsModal onClose={() => setApiSettingsVisible(false)} /> : null}
      {maintenanceVisible ? <MaintenanceModal onClose={() => setMaintenanceVisible(false)} /> : null}
    </header>
  )
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)}GB`
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`
  if (value >= 1024) return `${Math.round(value / 1024)}KB`
  return `${value}B`
}
