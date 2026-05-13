import { type JSX } from 'react'
import { CircleHelp } from 'lucide-react'
import {
  DEFAULT_IMAGE_OUTPUT_FORMAT,
  MAX_IMAGE_MAX_RETRIES,
  IMAGE_BACKGROUNDS,
  IMAGE_INPUT_FIDELITIES,
  IMAGE_MODERATIONS,
  IMAGE_OUTPUT_FORMATS,
  IMAGE_QUALITIES,
  IMAGE_RATIOS,
  formatImageQuality,
  getDefaultImageSize,
  getImageSizeOptions,
  IMAGE_BACKGROUND_LABELS,
  IMAGE_INPUT_FIDELITY_LABELS,
  IMAGE_MODERATION_LABELS,
  IMAGE_OUTPUT_FORMAT_LABELS,
  supportsImageInputFidelity
} from '@shared/image-options'
import type { ImageQuality, ImageRatio } from '@shared/types'
import { useAppStore } from '@renderer/store/app-store'
import { GallerySelect } from '@renderer/components/gallery/GallerySelect'

const ratios: ImageRatio[] = IMAGE_RATIOS
const qualities: ImageQuality[] = IMAGE_QUALITIES

export function SettingsPanel(): JSX.Element {
  const { conversations, activeConversationId, updateActiveConversation } = useAppStore()
  const conversation = conversations.find((item) => item.id === activeConversationId) || null
  const isImageToImage = (conversation?.referenceImages.length || 0) > 0

  if (!conversation) return <aside className="inspector" />

  const sizeOptions = getImageSizeOptions(conversation.ratio)
  const selectedSize = sizeOptions.some((option) => option.value === conversation.size)
    ? conversation.size
    : getDefaultImageSize(conversation.ratio)

  return (
    <aside className="inspector">
      <div className="config-stack">
        <div className="inspector-head">
          <span className="eyebrow">CONTROL ROOM</span>
          <h2>参数面板</h2>
        </div>
        <section className="panel">
          <h3>当前会话参数</h3>
          <div className="field">
            <span>图片比例</span>
            <div className="segmented">
              {ratios.map((ratio) => (
                <button
                  key={ratio}
                  className={conversation.ratio === ratio ? 'on' : ''}
                  onClick={() => void updateActiveConversation({ ratio, size: getDefaultImageSize(ratio) })}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>分辨率</span>
            <GallerySelect
              value={selectedSize}
              options={sizeOptions}
              ariaLabel="选择分辨率"
              className="settings-select"
              onChange={(size) => void updateActiveConversation({ size })}
            />
          </div>
          <div className="field">
            <span className="field-label-with-help">
              <span>质量</span>
              <button
                type="button"
                className="info-icon"
                title="质量越高，细节通常更多，但生成会更慢，也更容易放大成本。"
                aria-label="质量说明"
              >
                <CircleHelp size={14} />
              </button>
            </span>
            <div className="segmented">
              {qualities.map((quality) => (
                <button
                  key={quality}
                  className={conversation.quality === quality ? 'on' : ''}
                  onClick={() => void updateActiveConversation({ quality })}
                >
                  {formatImageQuality(quality)}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>生成数量</span>
            <input
              className="input-control"
              type="number"
              min={1}
              max={10}
              value={conversation.n}
              onChange={(event) => void updateActiveConversation({ n: Number(event.target.value) })}
            />
          </label>
          <label className="field">
            <span>失败重试次数</span>
            <input
              className="input-control"
              type="number"
              min={0}
              max={MAX_IMAGE_MAX_RETRIES}
              step={1}
              value={conversation.maxRetries}
              onChange={(event) => void updateActiveConversation({ maxRetries: Number(event.target.value) })}
            />
          </label>
          <div className="advanced-settings">
            <div className="advanced-settings-head">
              <span>高级设置</span>
              <span className={`pill tiny ${isImageToImage ? 'blue' : ''}`}>{isImageToImage ? '图生图' : '文生图'}</span>
            </div>
            <div className="advanced-settings-body">
              <ToggleRow
                label="流式输出"
                help="开启后会以流式方式接收图片结果；默认关闭。"
                checked={conversation.stream}
                onChange={() => void updateActiveConversation({ stream: !conversation.stream })}
              />
              <label className="field">
                <span className="field-label-with-help">
                  <span>超时时间(秒)</span>
                  <button
                    type="button"
                    className="info-icon"
                    title="单张图片的最大等待时间；每次重试都会重新计时。"
                    aria-label="超时时间说明"
                  >
                    <CircleHelp size={14} />
                  </button>
                </span>
                <input
                  className="input-control"
                  type="number"
                  min={1}
                  step={1}
                  value={conversation.generationTimeoutSeconds}
                  onChange={(event) => {
                    const value = event.target.value.trim()
                    void updateActiveConversation({
                      generationTimeoutSeconds: value ? Number(value) : conversation.generationTimeoutSeconds
                    })
                  }}
                />
              </label>
              <label className="field">
                <span className="field-label-with-help">
                  <span>输出格式</span>
                  <button
                    type="button"
                    className="info-icon"
                    title={`控制最终图片文件格式，默认使用 ${DEFAULT_IMAGE_OUTPUT_FORMAT.toUpperCase()}`}
                    aria-label="输出格式说明"
                  >
                    <CircleHelp size={14} />
                  </button>
                </span>
                <GallerySelect
                  value={conversation.outputFormat}
                  options={IMAGE_OUTPUT_FORMATS.map((value) => ({ value, label: IMAGE_OUTPUT_FORMAT_LABELS[value] }))}
                  ariaLabel="输出格式"
                  className="settings-select"
                  onChange={(outputFormat) => void updateActiveConversation({ outputFormat })}
                />
              </label>
              <label className="field">
                <span className="field-label-with-help">
                  <span>输出压缩</span>
                  <button
                    type="button"
                    className="info-icon"
                    title="仅 JPEG 和 WebP 有效，数值越高画质越好、文件越大。"
                    aria-label="输出压缩说明"
                  >
                    <CircleHelp size={14} />
                  </button>
                </span>
                <input
                  className="input-control"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={conversation.outputCompression ?? ''}
                  disabled={conversation.outputFormat === 'png'}
                  placeholder="留空"
                  onChange={(event) => {
                    const value = event.target.value.trim()
                    void updateActiveConversation({ outputCompression: value ? Number(value) : null })
                  }}
                />
              </label>
              <label className="field">
                <span className="field-label-with-help">
                  <span>背景</span>
                  <button
                    type="button"
                    className="info-icon"
                    title="选择是否保持自动背景或强制不透明背景。"
                    aria-label="背景说明"
                  >
                    <CircleHelp size={14} />
                  </button>
                </span>
                <GallerySelect
                  value={conversation.background}
                  options={IMAGE_BACKGROUNDS.map((value) => ({ value, label: IMAGE_BACKGROUND_LABELS[value] }))}
                  ariaLabel="背景"
                  className="settings-select"
                  onChange={(background) => void updateActiveConversation({ background })}
                />
              </label>
              <label className="field">
                <span className="field-label-with-help">
                  <span>审核策略</span>
                  <button
                    type="button"
                    className="info-icon"
                    title="控制内容审核强度，默认使用自动策略。"
                    aria-label="审核策略说明"
                  >
                    <CircleHelp size={14} />
                  </button>
                </span>
                <GallerySelect
                  value={conversation.moderation}
                  options={IMAGE_MODERATIONS.map((value) => ({ value, label: IMAGE_MODERATION_LABELS[value] }))}
                  ariaLabel="审核策略"
                  className="settings-select"
                  onChange={(moderation) => void updateActiveConversation({ moderation })}
                />
              </label>
              <label className="field">
                <span className="field-label-with-help">
                  <span>中间图数量</span>
                  <button
                    type="button"
                    className="info-icon"
                    title="仅流式输出时有效，范围为 0 到 3。"
                    aria-label="中间图数量说明"
                  >
                    <CircleHelp size={14} />
                  </button>
                </span>
                <input
                  className="input-control"
                  type="number"
                  min={0}
                  max={3}
                  step={1}
                  value={conversation.partialImages ?? 0}
                  disabled={!conversation.stream}
                  onChange={(event) => void updateActiveConversation({ partialImages: Number(event.target.value) })}
                />
              </label>
              {isImageToImage && supportsImageInputFidelity(conversation.model) ? (
                <label className="field">
                  <span className="field-label-with-help">
                    <span>输入保真度</span>
                    <button
                      type="button"
                      className="info-icon"
                      title="编辑场景下控制对输入参考图细节的保留程度。"
                      aria-label="输入保真度说明"
                    >
                      <CircleHelp size={14} />
                    </button>
                  </span>
                  <GallerySelect
                    value={conversation.inputFidelity ?? ''}
                    options={[
                      { value: '', label: '保持默认' },
                      ...IMAGE_INPUT_FIDELITIES.map((value) => ({ value, label: IMAGE_INPUT_FIDELITY_LABELS[value] }))
                    ]}
                    ariaLabel="输入保真度"
                    className="settings-select"
                    onChange={(inputFidelity) => void updateActiveConversation({
                      inputFidelity: inputFidelity === '' ? null : inputFidelity
                    })}
                  />
                </label>
              ) : null}
            </div>
          </div>
          <ToggleRow
            label="自动写入历史"
            checked={conversation.autoSaveHistory}
            onChange={() => void updateActiveConversation({ autoSaveHistory: !conversation.autoSaveHistory })}
          />
          <ToggleRow
            label="失败详情保留"
            checked={conversation.keepFailureDetails}
            onChange={() => void updateActiveConversation({ keepFailureDetails: !conversation.keepFailureDetails })}
          />
        </section>
      </div>
    </aside>
  )
}

function ToggleRow({
  label,
  help,
  checked,
  onChange
}: {
  label: string
  help?: string
  checked: boolean
  onChange: () => void
}): JSX.Element {
  return (
    <button className="toggle-row" onClick={onChange}>
      <span className="field-label-with-help">
        <span>{label}</span>
        {help ? (
          <span className="info-icon" title={help} aria-label={`${label}说明`}>
            <CircleHelp size={14} />
          </span>
        ) : null}
      </span>
      <span className={`switch ${checked ? '' : 'off'}`} />
    </button>
  )
}
