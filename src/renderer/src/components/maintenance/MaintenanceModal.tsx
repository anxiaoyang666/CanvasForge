import { useEffect, useState, type ChangeEvent, type JSX } from 'react'
import { ArchiveRestore, Download, HardDrive, LockKeyhole, RefreshCw, Shield, X } from 'lucide-react'
import type { BackupManifest, MaintenanceStatus } from '@shared/types'
import { useAppStore } from '@renderer/store/app-store'

export function MaintenanceModal({ onClose }: { onClose: () => void }): JSX.Element {
  const notify = useAppStore((state) => state.notify)
  const [status, setStatus] = useState<MaintenanceStatus | null>(null)
  const [password, setPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [restoreRunning, setRestoreRunning] = useState(false)

  const refresh = async () => {
    setStatus(await window.canvasForge.maintenance.status())
  }

  useEffect(() => {
    void refresh().catch((error) => notify(error instanceof Error ? error.message : '状态读取失败'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const savePassword = async () => {
    setPasswordSaving(true)
    try {
      await window.canvasForge.access.updatePassword({ password: password.trim() || null })
      setPassword('')
      notify(password.trim() ? '访问密码已更新' : '访问保护已关闭')
    } catch (error) {
      notify(error instanceof Error ? `保存失败：${error.message}` : '保存失败')
    } finally {
      setPasswordSaving(false)
    }
  }

  const restoreBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!window.confirm('恢复备份会覆盖当前 data 目录中的同名文件，继续吗？')) return
    setRestoreRunning(true)
    try {
      const manifest = JSON.parse(await file.text()) as BackupManifest
      await window.canvasForge.maintenance.restore(manifest)
      notify('备份已恢复，服务正在重启')
    } catch (error) {
      notify(error instanceof Error ? `恢复失败：${error.message}` : '恢复失败')
    } finally {
      setRestoreRunning(false)
    }
  }

  return (
    <div className="modal open maintenance-modal" role="dialog" aria-modal="true" aria-label="系统维护" onClick={onClose}>
      <div className="modal-panel maintenance-panel" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <span>系统维护</span>
          <button type="button" className="icon-only" title="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="maintenance-body">
          <section className="panel maintenance-overview">
            <h3>
              <HardDrive size={16} />
              数据状态
            </h3>
            {status ? (
              <>
                <div className="maintenance-metrics">
                  <Metric label="历史" value={status.counts.history} />
                  <Metric label="成功图片" value={status.counts.succeededImages} />
                  <Metric label="失败项" value={status.counts.failedItems} tone={status.counts.failedItems > 0 ? 'warn' : undefined} />
                  <Metric label="提示词" value={status.counts.promptTemplates} />
                </div>
                <div className="maintenance-storage">
                  <span>数据目录</span>
                  <code>{status.dataDir}</code>
                </div>
                <div className="maintenance-storage-grid">
                  <span>数据库 {formatBytes(status.storage.databaseBytes)}</span>
                  <span>生成图片 {formatBytes(status.storage.imagesBytes)}</span>
                  <span>参考图 {formatBytes(status.storage.referenceImagesBytes)}</span>
                  <strong>合计 {formatBytes(status.storage.totalBytes)}</strong>
                </div>
                {status.recentFailure ? <div className="status-error">最近失败：{status.recentFailure.message}</div> : null}
              </>
            ) : (
              <div className="empty-state">正在读取数据状态</div>
            )}
          </section>

          <section className="panel maintenance-actions-panel">
            <h3>
              <ArchiveRestore size={16} />
              备份与恢复
            </h3>
            <div className="maintenance-action-row">
              <a className="button-like primary" href={window.canvasForge.maintenance.backupUrl()} download>
                <Download size={15} />
                下载完整备份
              </a>
              <label className={`button-like ${restoreRunning ? 'disabled' : ''}`}>
                <ArchiveRestore size={15} />
                {restoreRunning ? '恢复中' : '恢复备份'}
                <input type="file" accept="application/json,.json" hidden disabled={restoreRunning} onChange={restoreBackup} />
              </label>
              <button onClick={() => void refresh()}>
                <RefreshCw size={15} />
                刷新
              </button>
            </div>
          </section>

          <section className="panel maintenance-actions-panel">
            <h3>
              <Shield size={16} />
              访问保护
            </h3>
            <label className="field">
              <span>新访问密码</span>
              <input
                className="input-control"
                type="password"
                value={password}
                placeholder="留空并保存可关闭访问保护"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button className="primary" disabled={passwordSaving} onClick={() => void savePassword()}>
              <LockKeyhole size={15} />
              {passwordSaving ? '保存中' : '保存访问密码'}
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'warn' }): JSX.Element {
  return (
    <div className={`maintenance-metric ${tone || ''}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  if (value >= 1024) return `${Math.round(value / 1024)} KB`
  return `${value} B`
}
