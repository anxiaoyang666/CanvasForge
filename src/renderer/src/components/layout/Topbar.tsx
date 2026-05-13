import type { JSX } from 'react'
import { Aperture, BookOpen, Image as ImageIcon, PanelRightClose, PanelRightOpen, PencilLine, Plus } from 'lucide-react'
import { useAppStore } from '@renderer/store/app-store'

export function Topbar(): JSX.Element {
  const { settings, settingsVisible, view, setView, toggleSettings, createConversation } = useAppStore()
  const endpoint = `${settings?.baseURL || 'https://api.openai.com'}/v1/images/generations`

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <Aperture size={20} />
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
      <nav className="top-actions" aria-label="主导航">
        <button className={view === 'workspace' ? 'active-soft' : ''} onClick={() => setView('workspace')}>
          <PencilLine size={16} />
          画布
        </button>
        <button className={view === 'gallery' ? 'active-soft' : ''} onClick={() => setView('gallery')}>
          <ImageIcon size={16} />
          图库
        </button>
        <button className={view === 'prompts' ? 'active-soft' : ''} onClick={() => setView('prompts')}>
          <BookOpen size={16} />
          提示词库
        </button>
        <button onClick={toggleSettings} title={settingsVisible ? '收起参数区' : '展开参数区'}>
          {settingsVisible ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          参数
        </button>
        <button className="primary" onClick={() => void createConversation()}>
          <Plus size={16} />
          新建会话
        </button>
      </nav>
    </header>
  )
}
