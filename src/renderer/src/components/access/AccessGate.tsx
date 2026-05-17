import { useEffect, useState, type FormEvent, type JSX, type ReactNode } from 'react'
import { LockKeyhole, ShieldCheck } from 'lucide-react'
import type { AccessStatus } from '@shared/types'

export function AccessGate({ children, onUnlocked }: { children: ReactNode; onUnlocked?: () => void }): JSX.Element {
  const [status, setStatus] = useState<AccessStatus | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.canvasForge.access.status().then(setStatus).catch(() => setStatus({ protectionEnabled: false, authenticated: true }))
  }, [])

  useEffect(() => {
    if (status && (!status.protectionEnabled || status.authenticated)) onUnlocked?.()
  }, [onUnlocked, status])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      setStatus(await window.canvasForge.access.login({ password }))
      setPassword('')
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败')
    }
  }

  if (!status) {
    return <div className="access-loading">正在进入 CanvasForge</div>
  }

  if (!status.protectionEnabled || status.authenticated) {
    return <>{children}</>
  }

  return (
    <div className="access-gate">
      <form className="access-card" onSubmit={submit}>
        <div className="access-mark">
          <ShieldCheck size={26} />
        </div>
        <div>
          <span className="eyebrow">PRIVATE WORKSPACE</span>
          <h1>CanvasForge 已加锁</h1>
          <p>输入访问密码后继续使用创作台、图库和系统设置。</p>
        </div>
        <label className="field">
          <span>访问密码</span>
          <input
            className="input-control"
            type="password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <div className="status-error">{error}</div> : null}
        <button className="primary full" disabled={!password.trim()}>
          <LockKeyhole size={16} />
          解锁
        </button>
      </form>
    </div>
  )
}
