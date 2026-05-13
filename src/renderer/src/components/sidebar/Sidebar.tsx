import { useEffect, useRef, useState, type JSX, type KeyboardEvent, type MouseEvent } from 'react'
import { Check, Loader2, Moon, PanelsTopLeft, PencilLine, Sun, Trash2, X } from 'lucide-react'
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
    renameConversation,
    toggleTheme
  } = useAppStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const editInputRef = useRef<HTMLInputElement | null>(null)
  const themeToggle = getThemeToggleView(darkMode)
  const activeCount = conversations.length

  useEffect(() => {
    if (!editingId) return
    editInputRef.current?.focus()
    editInputRef.current?.select()
  }, [editingId])

  const beginRename = (conversationId: string, title: string, event?: MouseEvent) => {
    event?.stopPropagation()
    setEditingId(conversationId)
    setEditingTitle(title)
  }

  const saveRename = async () => {
    if (!editingId) return
    const id = editingId
    setEditingId(null)
    await renameConversation(id, editingTitle)
  }

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void saveRename()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setEditingId(null)
    }
  }

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
          const displayTitle = conversation.title || '未命名会话'
          return (
            <div
              key={conversation.id}
              className={row.className}
              role="button"
              tabIndex={0}
              onClick={() => void setActiveConversation(conversation.id)}
              onKeyDown={(event) => {
                if (editingId === conversation.id) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  void setActiveConversation(conversation.id)
                }
              }}
            >
              <div className="session-line">
                <span className="session-glyph" aria-hidden="true">
                  <PanelsTopLeft size={14} />
                </span>
                {editingId === conversation.id ? (
                  <input
                    ref={editInputRef}
                    className="session-title-input"
                    value={editingTitle}
                    aria-label="会话名称"
                    onChange={(event) => setEditingTitle(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={handleRenameKeyDown}
                  />
                ) : (
                  <span
                    className="draft session-draft"
                    title={displayTitle}
                    onDoubleClick={(event) => beginRename(conversation.id, displayTitle, event)}
                  >
                    {displayTitle}
                  </span>
                )}
                <span className="session-loading-slot">
                  {row.generating ? <Loader2 className="session-loading" size={13} aria-label="生成中" /> : null}
                </span>
                {editingId === conversation.id ? (
                  <span className="session-actions">
                    <button
                      type="button"
                      className="icon-only session-action"
                      title="保存名称"
                      onClick={(event) => {
                        event.stopPropagation()
                        void saveRename()
                      }}
                    >
                      <Check size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-only session-action"
                      title="取消"
                      onClick={(event) => {
                        event.stopPropagation()
                        setEditingId(null)
                      }}
                    >
                      <X size={13} />
                    </button>
                  </span>
                ) : (
                  <span className="session-actions">
                    <button
                      type="button"
                      className="icon-only session-action"
                      title="重命名"
                      onClick={(event) => beginRename(conversation.id, displayTitle, event)}
                    >
                      <PencilLine size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-only danger session-delete"
                      title="删除会话"
                      onClick={(event) => {
                        event.stopPropagation()
                        void deleteConversation(conversation.id)
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                )}
              </div>
            </div>
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
