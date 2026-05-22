import { useEffect, useMemo, useRef, useState, type DragEvent, type JSX } from 'react'
import { CheckCircle2, FilePenLine, ImagePlus, Loader2, Sparkles, X } from 'lucide-react'
import { DEFAULT_IMAGE_OUTPUT_FORMAT, DEFAULT_MODEL } from '@shared/image-options'
import type { Conversation, ConversationUpdate, GenerateImageInput, ImageHistoryItem, ImageRatio, ReferenceImage } from '@shared/types'
import { useAppStore } from '@renderer/store/app-store'
import { CanvasArea } from '@renderer/components/workspace/CanvasArea'

type PosterOrientation = 'portrait' | 'landscape'
type PosterGrade = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
type PosterDensity = 'auto' | 'picture-heavy' | 'balanced' | 'content-rich'
type PosterUseCase = 'homework' | 'display' | 'competition'
type PosterReferenceFile = {
  id: string
  file: File
  previewUrl: string
}

const orientationConfig: Record<PosterOrientation, { label: string; ratio: ImageRatio; size: string }> = {
  landscape: { label: '横版 A4', ratio: '4:3', size: '2048x1536' },
  portrait: { label: '竖版 A4', ratio: '3:4', size: '1536x2048' }
}

const gradeOptions: PosterGrade[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
const densityOptions: Array<{ value: PosterDensity; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'picture-heavy', label: '图多字少' },
  { value: 'balanced', label: '图文均衡' },
  { value: 'content-rich', label: '资料更多' }
]
const useCaseOptions: Array<{ value: PosterUseCase; label: string }> = [
  { value: 'homework', label: '课堂作业' },
  { value: 'display', label: '班级展示' },
  { value: 'competition', label: '评比展示' }
]

function getGradeGuidance(grade: PosterGrade): string {
  const gradeNumber = Number(grade)
  if (gradeNumber <= 2) return '适合小学低年级：主图更大，栏目控制在2到3个，文字区少且大，元素简单可爱，留出明显涂色空间。'
  if (gradeNumber <= 4) return '适合小学中年级：栏目控制在3到4个，可以包含知识点、小故事、小贴士或行动倡议，插画和文字区保持均衡。'
  if (gradeNumber <= 6) return '适合小学高年级：栏目控制在4到5个，信息层级更清楚，可以加入原因、影响、方法、时间线或对比板块。'
  return '适合初中年级：版式更成熟，资料区更多，栏目逻辑清楚，可以加入概念解释、数据占位、案例分析和行动方案。'
}

function getDensityGuidance(density: PosterDensity): string {
  if (density === 'picture-heavy') return '内容密度：图多字少，插画和装饰占比更高，文字内容更短。'
  if (density === 'balanced') return '内容密度：图文均衡，插画、标题区、栏目文字区比例协调。'
  if (density === 'content-rich') return '内容密度：资料更多，栏目更清楚，包含更多短句、资料卡和信息块。'
  return '内容密度：根据年级自动匹配，不要让版面过空或过挤。'
}

function getUseCaseGuidance(useCase: PosterUseCase): string {
  if (useCase === 'display') return '使用场景：班级展示，画面远看要醒目，标题区更突出，装饰更完整。'
  if (useCase === 'competition') return '使用场景：评比展示，版式更精致，有边框、角标、栏目标签和层次变化，但仍然适合学生临摹。'
  return '使用场景：课堂作业，结构清楚，绘制难度适中，不要过度复杂。'
}

function buildDraftPrompt(input: {
  theme: string
  orientation: PosterOrientation
  grade: PosterGrade
  density: PosterDensity
  useCase: PosterUseCase
}): string {
  const { theme, orientation, grade, density, useCase } = input
  const layout = orientation === 'portrait' ? '竖版A4' : '横版A4'
  return [
    `生成一张适合${grade}年级学生手抄报的${layout}彩色确认稿，主题是“${theme}”。`,
    '确认稿必须带有清晰可读的中文标题、栏目标题和适量短句内容，用来给学生参考版式和文字位置。',
    '根据主题自动选择匹配的视觉元素、色彩、装饰风格和版面氛围，不要强行套固定风格。',
    '版面需要有主标题区、内容分区、插画装饰、边框、姓名/班级/日期资料栏和留白。',
    getGradeGuidance(grade),
    getDensityGuidance(density),
    getUseCaseGuidance(useCase),
    '要求画面完整、干净、层次清晰，适合作为第一张确认稿。',
    '如果有参考图，只吸收构图、色调、元素和主题氛围，不要机械复制。'
  ].join('\n')
}

function buildMonochromePrompt(theme: string, grade: PosterGrade): string {
  return [
    `以参考确认稿为唯一底图，逐线描摹生成“${theme}”手抄报的${grade}年级黑白无字线稿版。`,
    '必须保持确认稿中每个元素、边框、插画、标题区、栏目框、姓名栏和装饰的相对位置、尺寸、比例完全一致。',
    '不得重新构图，不得移动元素，不得增删元素，不得改变画面主体、边框样式或栏目数量。',
    getGradeGuidance(grade),
    '去掉所有颜色和可读正文内容，但不要把标题区直接抹空。',
    '主标题和栏目标题需要保留原位置、原大小的空心外轮廓、标题框或占位轮廓，方便学生照着涂色和手写自己的字。',
    '正文段落区域保留空白书写线、文本框轮廓或浅占位线，不生成可读汉字、字母或数字。',
    '画面为白底黑线，线条清晰、干净、闭合区域明确，不要灰阶阴影，不要填充色。'
  ].join('\n')
}

function buildLightSketchPrompt(theme: string, grade: PosterGrade): string {
  return [
    `以参考确认稿为唯一底图，逐线描摹生成“${theme}”手抄报的${grade}年级浅线稿版。`,
    '必须保持确认稿中每个元素、边框、插画、标题区、栏目框、姓名栏和装饰的相对位置、尺寸、比例完全一致。',
    '不得重新构图，不得移动元素，不得增删元素，不得改变画面主体、边框样式或栏目数量。',
    getGradeGuidance(grade),
    '去掉所有颜色和可读正文内容，但不要把标题区直接抹空。',
    '主标题和栏目标题需要保留原位置、原大小的浅灰空心外轮廓、标题框或占位轮廓，方便学生照着涂色和手写自己的字。',
    '正文段落区域保留空白书写线、文本框轮廓或极浅占位线，不生成可读汉字、字母或数字。',
    '画面为白底浅灰铅笔线，线条细、淡但可见，不要阴影，不要填充色。'
  ].join('\n')
}

function createPosterInput(input: {
  conversation: Conversation
  prompt: string
  orientation: PosterOrientation
  referenceImageIds: string[]
  n: number
  inputFidelity?: GenerateImageInput['inputFidelity']
}): GenerateImageInput {
  const option = orientationConfig[input.orientation]
  return {
    conversationId: input.conversation.id,
    workspaceType: 'hand-poster',
    prompt: input.prompt,
    model: input.conversation.model || DEFAULT_MODEL,
    ratio: option.ratio,
    size: option.size,
    quality: input.conversation.quality,
    n: input.n,
    outputFormat: input.conversation.outputFormat || DEFAULT_IMAGE_OUTPUT_FORMAT,
    outputCompression: input.conversation.outputCompression ?? undefined,
    background: 'opaque',
    moderation: input.conversation.moderation,
    stream: false,
    partialImages: 0,
    inputFidelity: input.inputFidelity ?? input.conversation.inputFidelity ?? undefined,
    maxRetries: input.conversation.maxRetries,
    generationTimeoutSeconds: input.conversation.generationTimeoutSeconds,
    referenceImageIds: input.referenceImageIds
  }
}

export function HandPosterPage({
  activeConversationGenerating,
  activeConversationStartedAt,
  generationClockMs
}: {
  activeConversationGenerating: boolean
  activeConversationStartedAt: number | null
  generationClockMs: number
}): JSX.Element {
  const {
    activePosterConversationId,
    conversations,
    runsByConversation
  } = useAppStore()
  const conversation = conversations.find((item) => item.id === activePosterConversationId) || null
  const runs = activePosterConversationId ? runsByConversation[activePosterConversationId] || [] : []

  return (
    <>
      <section className="workspace poster-workspace">
        {conversation ? (
          <CanvasArea
            conversationId={conversation.id}
            runs={runs}
            generationStartedAt={activeConversationStartedAt}
            generating={activeConversationGenerating}
            generationClockMs={generationClockMs}
          />
        ) : (
          <div className="empty-state">暂无手抄报会话</div>
        )}
      </section>
      {conversation ? <HandPosterInspector conversation={conversation} generating={activeConversationGenerating} /> : <aside className="inspector" />}
    </>
  )
}

function HandPosterInspector({ conversation, generating }: { conversation: Conversation; generating: boolean }): JSX.Element {
  const notify = useAppStore((state) => state.notify)
  const generateWithInput = useAppStore((state) => state.generateWithInput)
  const reloadHistory = useAppStore((state) => state.reloadHistory)
  const runsByConversation = useAppStore((state) => state.runsByConversation)
  const [theme, setTheme] = useState(conversation.draftPrompt || '')
  const [orientation, setOrientation] = useState<PosterOrientation>(conversation.ratio === '3:4' ? 'portrait' : 'landscape')
  const [grade, setGrade] = useState<PosterGrade>('3')
  const [density, setDensity] = useState<PosterDensity>('auto')
  const [useCase, setUseCase] = useState<PosterUseCase>('homework')
  const [draftCount, setDraftCount] = useState(conversation.n)
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null)
  const [draftSubmitting, setDraftSubmitting] = useState(false)
  const [lineArtSubmitting, setLineArtSubmitting] = useState(false)
  const previousDraftIdsRef = useRef<string[]>([])
  const [references, setReferences] = useState<PosterReferenceFile[]>([])
  const [conversationReferences, setConversationReferences] = useState<ReferenceImage[]>(conversation.referenceImages)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const themeText = theme.trim()
  const conversationRuns = runsByConversation[conversation.id] || []
  const latestDraftRun = useMemo(() => (
    [...conversationRuns]
      .filter((run) => run.prompt.includes('彩色确认稿') && run.items.some((item) => item.status === 'succeeded'))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] || null
  ), [conversationRuns])
  const draftCandidates = useMemo(() => (
    latestDraftRun?.items
      .filter((item) => item.status === 'succeeded')
      .sort((left, right) => (left.requestIndex ?? 0) - (right.requestIndex ?? 0)) || []
  ), [latestDraftRun])

  useEffect(() => {
    setTheme(conversation.draftPrompt || '')
    setOrientation(conversation.ratio === '3:4' ? 'portrait' : 'landscape')
    setDraftCount(conversation.n)
    setSelectedDraftId(null)
    setReferences((current) => {
      for (const reference of current) URL.revokeObjectURL(reference.previewUrl)
      return []
    })
  }, [conversation.id])

  useEffect(() => {
    setConversationReferences(conversation.referenceImages)
  }, [conversation.referenceImages])

  useEffect(() => {
    const currentIds = draftCandidates.map((item) => item.id)
    const previousIds = previousDraftIdsRef.current
    const hasNewDraft = currentIds.some((id) => !previousIds.includes(id))
    previousDraftIdsRef.current = currentIds
    if (hasNewDraft && currentIds.length > 1) {
      setSelectedDraftId(null)
      return
    }
    if (draftCandidates.length === 1) {
      setSelectedDraftId(draftCandidates[0].id)
      return
    }
    if (selectedDraftId && !draftCandidates.some((item) => item.id === selectedDraftId)) {
      setSelectedDraftId(null)
    }
  }, [draftCandidates, selectedDraftId])

  const updatePosterConversation = async (input: ConversationUpdate) => {
    const updated = await window.canvasForge.conversation.update(conversation.id, input)
    useAppStore.setState((state) => ({
      conversations: state.conversations.map((item) => (item.id === conversation.id ? updated : item))
    }))
    return updated
  }

  const addReferenceFiles = (files: File[]) => {
    const imageFiles = files.filter((file) => ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type))
    if (imageFiles.length === 0) return
    const capacity = Math.max(0, 8 - references.length)
    const next = imageFiles.slice(0, capacity).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      previewUrl: URL.createObjectURL(file)
    }))
    if (next.length < imageFiles.length) notify('最多添加 8 张参考图')
    setReferences((current) => [...current, ...next])
  }

  const removeReference = (id: string) => {
    setReferences((current) => {
      const target = current.find((item) => item.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return current.filter((item) => item.id !== id)
    })
  }

  const syncReferenceImages = async (includeDraftItem?: ImageHistoryItem): Promise<ReferenceImage[]> => {
    for (const reference of conversationReferences) {
      await window.canvasForge.reference.remove(conversation.id, reference.id)
    }
    if (includeDraftItem) {
      const imported = await window.canvasForge.reference.addFromHistory(conversation.id, includeDraftItem.id)
      setConversationReferences(imported)
      return imported
    }
    const payload = await Promise.all(references.map(async (reference) => ({
      name: reference.file.name,
      mimeType: reference.file.type,
      data: await reference.file.arrayBuffer()
    })))
    const imported = payload.length > 0 ? await window.canvasForge.reference.importFiles(conversation.id, payload) : []
    setConversationReferences(imported)
    return imported
  }

  const generateDraft = async () => {
    if (!themeText) {
      notify('先输入手抄报主题')
      return
    }
    if (draftSubmitting || generating) return
    setDraftSubmitting(true)
    const option = orientationConfig[orientation]
    try {
      const updated = await updatePosterConversation({
        workspaceType: 'hand-poster',
        title: `手抄报-${grade}年级-${themeText.slice(0, 14)}`,
        draftPrompt: themeText,
        ratio: option.ratio,
        size: option.size,
        n: draftCount,
        outputFormat: 'png',
        background: 'opaque'
      })
      const imported = await syncReferenceImages()
      void generateWithInput(conversation.id, createPosterInput({
        conversation: updated,
        prompt: buildDraftPrompt({ theme: themeText, orientation, grade, density, useCase }),
        orientation,
        referenceImageIds: imported.map((reference) => reference.id),
        n: updated.n
      }), { title: `手抄报-${grade}年级-${themeText.slice(0, 14)}` })
      notify('确认稿任务已提交')
    } catch (error) {
      notify(error instanceof Error ? `提交失败：${error.message}` : '提交失败')
    } finally {
      setDraftSubmitting(false)
    }
  }

  const generateLineArt = async () => {
    if (lineArtSubmitting || generating) return
    if (draftCandidates.length > 1 && !selectedDraftId) {
      notify('先选择一张满意的确认稿')
      return
    }
    let draft: ImageHistoryItem | null = draftCandidates.find((item) => item.id === selectedDraftId) || draftCandidates[0] || null
    if (!draft) {
      const history = await window.canvasForge.history.list({ workspaceType: 'hand-poster', sort: 'newest' })
      draft = history.find((item) =>
        item.conversationId === conversation.id
        && item.status === 'succeeded'
        && item.prompt.includes('彩色确认稿')
      ) || null
    }
    if (!draft) {
      notify('先生成一张确认稿')
      return
    }
    setLineArtSubmitting(true)
    try {
      const draftReferences = await syncReferenceImages(draft)
      const referenceIds = draftReferences.map((reference) => reference.id)
      void Promise.all([
        generateWithInput(conversation.id, createPosterInput({
          conversation,
          prompt: buildMonochromePrompt(themeText || draft.prompt, grade),
          orientation,
          referenceImageIds: referenceIds,
          n: 1,
          inputFidelity: 'high'
        }), { title: conversation.title }),
        generateWithInput(conversation.id, createPosterInput({
          conversation,
          prompt: buildLightSketchPrompt(themeText || draft.prompt, grade),
          orientation,
          referenceImageIds: referenceIds,
          n: 1,
          inputFidelity: 'high'
        }), { title: conversation.title })
      ]).then(() => reloadHistory())
      notify('两张无字线稿任务已提交')
    } catch (error) {
      notify(error instanceof Error ? `提交失败：${error.message}` : '提交失败')
    } finally {
      setLineArtSubmitting(false)
    }
  }

  const updateDraftCount = (value: number) => {
    const next = Math.min(10, Math.max(1, Math.trunc(Number.isFinite(value) ? value : 1)))
    setDraftCount(next)
    void updatePosterConversation({ n: next })
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    addReferenceFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <aside className="inspector poster-inspector">
      <div className="config-stack">
        <div className="inspector-head">
          <span className="eyebrow">HAND POSTER</span>
          <h2>手抄报参数</h2>
        </div>
        <section className="panel">
          <h3>内容设定</h3>
          <label className="field">
            <span>主题</span>
            <input
              className="input-control"
              value={theme}
              onChange={(event) => setTheme(event.target.value)}
              placeholder="例如：低碳生活、端午节、航天科技"
            />
          </label>
          <div className="field">
            <span>年级</span>
            <div className="poster-grade-grid">
              {gradeOptions.map((option) => (
                <button key={option} type="button" className={grade === option ? 'active-soft' : ''} onClick={() => setGrade(option)}>
                  {option} 年级
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="panel">
          <h3>版面参数</h3>
          <div className="field">
            <span>尺寸</span>
            <div className="poster-orientation-grid">
              {Object.entries(orientationConfig).map(([value, option]) => (
                <button key={value} type="button" className={orientation === value ? 'active-soft' : ''} onClick={() => setOrientation(value as PosterOrientation)}>
                  <FilePenLine size={16} />
                  <span>{option.label}</span>
                  <small>{option.size.replace('x', '×')}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>内容密度</span>
            <div className="poster-option-row">
              {densityOptions.map((option) => (
                <button key={option.value} type="button" className={density === option.value ? 'active-soft' : ''} onClick={() => setDensity(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>使用场景</span>
            <div className="poster-option-row three">
              {useCaseOptions.map((option) => (
                <button key={option.value} type="button" className={useCase === option.value ? 'active-soft' : ''} onClick={() => setUseCase(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>一次生成几张确认稿</span>
            <input
              className="input-control"
              type="number"
              min={1}
              max={10}
              value={draftCount}
              onChange={(event) => updateDraftCount(Number(event.target.value))}
            />
          </label>
        </section>
        {draftCandidates.length > 0 ? (
          <section className="panel">
            <h3>确认稿选择</h3>
            <div className="poster-draft-grid">
              {draftCandidates.map((draft, index) => (
                <button
                  key={draft.id}
                  type="button"
                  className={selectedDraftId === draft.id ? 'poster-draft-option selected' : 'poster-draft-option'}
                  title={`选择确认稿 ${draftCandidates.length - index}`}
                  onClick={() => setSelectedDraftId(draft.id)}
                >
                  <img src={window.canvasForge.image.url(draft.id)} alt={`确认稿 ${draftCandidates.length - index}`} />
                  <span>确认稿 {draftCandidates.length - index}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        <section className="panel">
          <h3>参考图</h3>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            onChange={() => {
              addReferenceFiles(Array.from(fileInputRef.current?.files || []))
              if (fileInputRef.current) fileInputRef.current.value = ''
            }}
          />
          <div className="poster-reference-drop" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop} role="button" tabIndex={0} onClick={() => fileInputRef.current?.click()}>
            <ImagePlus size={18} />
            <span>{references.length > 0 ? `已添加 ${references.length} 张参考图` : '添加或拖入参考图片'}</span>
          </div>
          {references.length > 0 ? (
            <div className="poster-reference-list">
              {references.map((reference) => (
                <div key={reference.id} className="poster-reference-thumb">
                  <img src={reference.previewUrl} alt={reference.file.name} />
                  <button type="button" title="删除参考图" onClick={() => removeReference(reference.id)}>
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </section>
        <section className="panel poster-action-panel">
          <button className="primary full" disabled={!themeText || draftSubmitting || generating} onClick={() => void generateDraft()}>
            {draftSubmitting ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
            {generating ? '任务生成中' : '生成确认稿'}
          </button>
          <button className="full" disabled={lineArtSubmitting || generating} onClick={() => void generateLineArt()}>
            {lineArtSubmitting ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
            {generating ? '等待当前任务完成' : '满意，生成两张无字线稿'}
          </button>
        </section>
      </div>
    </aside>
  )
}
