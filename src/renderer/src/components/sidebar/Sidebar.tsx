import type { JSX } from 'react'
import { Moon, PanelsTopLeft, Sun, Trash2, Loader2 } from 'lucide-react'
import { useAppStore } from '@renderer/store/app-store'
import { getSessionRowView } from '@renderer/session-list'
import { getThemeToggleView } from '@renderer/theme-toggle'
import { appVersion } from '@shared/app-version'

export function Sidebar(): JSX.Element {
  const {
    conversations,
    activeConversationId,
    darkMode,
    loading,
    generatingByConversation,
    setActiveConversation,
    deleteConversation,
    toggleTheme
  } = useAppStore()
  const themeToggle = getThemeToggleView(darkMode)
  const activeCount = conversations.length

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div>
          <span className="eyebrow">PROJECTS</span>
          <h2>创作序列</h2>
        </div>
        <span className="session-count">
          {loading ? <Loader2 className="spin" size={14} /> : activeCount}
        </span>
      </div>
      <div className="section-title">
        <span>最近会话</span>
        {loading ? <Loader2 className="spin" size={15} /> : null}
      </div>
      <div className="session-list">
        {conversations.map((conversation) => {
          const row = getSessionRowView(conversation.id, activeConversationId, generatingByConversation)
          return (
            <button
              key={conversation.id}
              className={row.className}
              onClick={() => void setActiveConversation(conversation.id)}
            >
              <div className="session-line">
                <span className="session-glyph" aria-hidden="true">
                  <PanelsTopLeft size={14} />
                </span>
                <span className="draft session-draft" title={conversation.draftPrompt || conversation.title}>
                  {conversation.draftPrompt || conversation.title}
                </span>
                <span className="session-loading-slot">
                  {row.generating ? <Loader2 className="session-loading" size={13} aria-label="生成中" /> : null}
                </span>
                <span
                  className="icon-only danger session-delete"
                  title="删除会话"
                  onClick={(event) => {
                    event.stopPropagation()
                    void deleteConversation(conversation.id)
                  }}
                >
                  <Trash2 size={13} />
                </span>
              </div>
            </button>
          )
        })}
      </div>
      <div className="app-footer">
        <div className="version-line">
          <span>CanvasForge Studio</span>
          <span>v{appVersion}</span>
        </div>
        <button className="theme-toggle" onClick={toggleTheme}>
          {darkMode ? <Moon size={14} /> : <Sun size={14} />}
          <span>{themeToggle.label}</span>
          <span className={themeToggle.switchClassName} />
        </button>
      </div>
    </aside>
  )
}
