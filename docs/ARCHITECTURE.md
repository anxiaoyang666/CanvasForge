# 架构说明

本文描述当前代码的运行结构，方便接手时定位改动点。行为以源码为准。

## 总览

一次页面访问由同一个 Node 进程完成：

1. `src/server/index.ts` 监听 HTTP。
2. `/api/*` 调用 `src/core` 里的数据库、设置、图片和提示词服务。
3. 其他 GET 请求从 `out/renderer` 返回 Vite 构建出的 React 页面。
4. 浏览器通过 `src/renderer/src/browser-api.ts` 把 `window.canvasForge` 发回这些 API。

```text
浏览器 React
  └─ window.canvasForge（browser-api.ts）
       └─ Node HTTP（src/server/index.ts）
            ├─ SettingsStore + WebSafeStorage
            ├─ AppDatabase（better-sqlite3）
            ├─ ImageService → 上游 /v1/images/*
            └─ PromptService → 上游 /v1/responses
```

路径别名在 `tsconfig.json` 和 Vite 配置里一致：

| 别名 | 目录 |
| --- | --- |
| `@core` | `src/core` |
| `@shared` | `src/shared` |
| `@renderer` | `src/renderer/src` |

服务端打包配置是 `vite.server.config.ts`。入口为 `src/server/index.ts`，`better-sqlite3` 保持 external，产物文件名固定为 `out/server/index.mjs`。前端配置是 `vite.web.config.ts`，根目录为 `src/renderer`，产物为 `out/renderer`。

## 前端

`src/renderer/src/main.tsx` 先安装浏览器 API，再渲染 `App`。`App` 用 `AccessGate` 包住界面：未登录时只请求访问状态和登录接口，解锁后才调用 `useAppStore.load()`。

页面状态在 Zustand store `src/renderer/src/store/app-store.ts`。视图只有四种：

| `view` | 顶栏名称 | 内容 |
| --- | --- | --- |
| `workspace` | 画布 | 会话栏、画布、设置面板 |
| `poster` | 手抄报 | 会话栏、手抄报页 |
| `gallery` | 图库 | 全宽图库 |
| `prompts` | 提示词库 | 全宽模板页 |

启动时如果缺少某种工作区会话，store 会自动补一条。画布默认比例 `1:1`、质量 `high`、输出 `jpeg`。手抄报默认 `4:3`、`2048x1536`、PNG、不透明背景。删除某类最后一条会话时也会再补一条，保证两种工作区都至少有一个会话。

画布和手抄报的会话列表共用 `Sidebar`，按 `workspaceType` 过滤。会话栏宽度存在 `localStorage` 的 `canvasforge-sidebar-width`，范围 180 到 380。白天/黑夜只翻转根节点 class，刷新后回到浅色。

生成进行中时，`CanvasArea` 每 2 秒调用 `GET /api/conversations/:id/runs`，把已经落库的单张结果填回原来的卡片位置。计时器每秒更新一次已等待时间。

`browser-api.ts` 里的下载和复制发生在浏览器：单张和多张下载都是创建 `<a download>`，复制会先把图片画成 PNG 再写入剪贴板。`shell.openPath` 在 Web 里返回空字符串。`src/core/batch-download.ts` 是按文件路径复制图片的函数，目前只有单元测试引用，Web 下载不走它。

## 服务端路由

实现集中在 `src/server/index.ts` 的 `routeRequest` 和 `handleApi`。除下表「登录前可访问」的两个接口外，设置了访问密码以后，其余 `/api/*` 需要 cookie `canvasforge_session`。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/healthz` | 健康检查，返回 `ok`、`buildMarker`、加密是否可用 |
| GET | `/api/access/status` | 登录前可访问。是否启用密码、当前请求是否已登录 |
| POST | `/api/access/login` | 登录前可访问 |
| POST | `/api/access/logout` | 清除服务端会话散列和 cookie |
| PUT | `/api/access/password` | 设置密码；空字符串关闭保护 |
| GET | `/api/maintenance/status` | 各表数量、数据库和图片目录体积、最近一条失败 |
| GET | `/api/maintenance/backup` | 下载整个 `data/` 的 JSON 备份 |
| POST | `/api/maintenance/restore` | 覆盖恢复，随后进程退出 |
| GET / PUT | `/api/settings` | 读取或更新接口地址、模型和 API Key |
| POST | `/api/settings/models` | 代理上游 `GET /v1/models` |
| GET / POST | `/api/conversations` | 列出会话、创建会话 |
| PUT / DELETE | `/api/conversations/:id` | 更新或删除会话 |
| GET | `/api/conversations/:id/runs` | 该会话的生成轮次及图片 |
| POST / DELETE | `/api/conversations/:id/references` 与 `.../:referenceId` | 上传或移除参考图 |
| POST | `/api/conversations/:id/references/from-history` | 把历史图复制为参考图 |
| PUT | `/api/conversations/:id/references/reorder` | 调整参考图顺序 |
| GET | `/api/history` | 图库。查询参数 `query`、`sort=newest\|oldest`、`favoritesOnly=true`、`workspaceType=all\|canvas\|hand-poster` |
| DELETE | `/api/history/:id` | 删除历史和对应图片文件 |
| PUT | `/api/history/:id/favorite` | 收藏 |
| POST | `/api/images/generate` | 创建一轮生成并等待全部请求结束 |
| POST | `/api/images/:runId/cancel` | 可选 body `requestIndex`，取消一张或仅当该轮只有一张时取消整轮 |
| POST | `/api/prompt/inspire` | 生成灵感提示词 |
| POST | `/api/prompt/enrich` | 丰富已有提示词 |
| GET / POST | `/api/prompt-library` | 列表和新建 |
| POST | `/api/prompt-library/import` | 按 id 插入或替换 |
| PUT / DELETE | `/api/prompt-library/:id` | 更新或删除模板 |
| GET | `/images/image/:id` | 按历史 id 发送图片文件 |
| GET | `/images/reference/:id` | 按参考图 id 发送图片文件 |
| GET | 其他路径 | 静态文件；找不到时回退 `index.html` |

API 错误大多以 HTTP 400 和 `{ error }` 返回。未捕获异常走 500。静态目录之外的路径返回 403。

`buildMarker` 是 `src/server/index.ts` 里的常量字符串，启动日志和 `/healthz` 都会打印，用来确认线上跑的是哪一次构建。

## 核心模块

| 文件 | 职责 |
| --- | --- |
| `src/core/database.ts` | 建表、补列、会话、轮次、历史、参考图、提示词模板、维护统计。启动时调用 `recoverInterruptedRuns()` |
| `src/core/settings.ts` | 读写 `settings.json`。能加密时把明文 Key 迁移成 `encryptedApiKey` |
| `src/server/web-safe-storage.ts` | AES-256-GCM。密钥文件不存在时生成 32 字节随机钥，权限 `0600` |
| `src/core/image-service.ts` | 组请求、并发、重试、超时、流式回退、落盘、取消 |
| `src/core/image-response.ts` | 把多图请求拆成多次单图请求的辅助函数；当前生成主路径在 `ImageService` 内自行并发 |
| `src/core/prompt-service.ts` | 调用 `/v1/responses`，从 `output_text`、`output` 或 `choices` 里取文本 |
| `src/core/error-details.ts` | 把失败上下文序列化成可展示的详情 |
| `src/core/interrupted-run-recovery.ts` | 纯函数：把启动前仍为 `running` 的轮次规划成成功或失败 |
| `src/shared/image-options.ts` | 默认模型、比例尺寸表、请求体和文生图/图生图 URL |
| `src/shared/prompt-options.ts` | 默认提示词模型 `gpt-5.4-mini` |
| `src/shared/types.ts` | 前后端共用的数据结构，以及 `CanvasForgeAPI` 的形状 |
| `src/renderer/src/prompt-library.ts` | 内置模板、筛选，以及从 `localStorage` 迁到服务端 |
| `src/renderer/src/hand-poster-history.ts` | 按提示词文本把手抄报线稿排到对应确认稿后面 |

## 图片生成

`ImageService.generate` 的顺序：

1. 读取会话和 API Key，用参考图数量决定 `text-to-image` 或 `image-to-image`。
2. 插入一条 `status = running` 的 `generation_runs`。
3. 提示词为空或没有 API Key 时，把这一轮记为失败并返回。
4. 按 `n`（1 到 10）创建同样数量的 `AbortController`，并发执行。每个上游请求的 `n` 固定为 1。
5. 单张成功后立刻写入 `data/images/<id>.<ext>` 和 `image_history`。`request_index` 对应该轮中的原始位置。
6. 失败时按会话的 `maxRetries` 重试。每次尝试使用 `generationTimeoutSeconds` 重新计时。
7. 用户取消的序号不写历史。其余失败写入 `image_history.status = failed`。
8. 全部结束后更新这一轮的状态。`autoSaveHistory === false` 时历史行的 `global_visible` 为 0，图库查询会排除这些行。

流式请求在 `stream` 为真时发出。`STREAM_IDLE_TIMEOUT_MS` 为 60 秒：空闲超时或流里没有图片时，用同一组参数再发一次非流式请求，并在错误详情里记下 `streamFallback`。

进程启动时，`AppDatabase.recoverInterruptedRuns()` 找出仍为 `running` 的轮次。缺结果的序号补一条失败历史，错误文案是 `Generation interrupted before completion.` 已有结果的轮次按其中是否存在失败项收成 `succeeded` 或 `failed`。

参考图文件在 `data/reference-images/`。上传时校验 MIME，允许 `image/png`、`image/jpeg`、`image/webp`。历史图转参考图时是复制文件，不移动原图。

## 手抄报

`HandPosterPage` 不使用画布输入框里的自由提示词作为唯一来源。它根据主题、年级（1 到 9）、横版或竖版、密度和用途拼出三段提示词：

- 彩色确认稿：提示词包含「彩色确认稿」。横版 `4:3` / `2048x1536`，竖版 `3:4` / `1536x2048`，背景固定不透明。
- 黑白线稿和浅线稿：把确认稿设为参考图，再各生成一张。提示词包含「线稿版」。

`orderHandPosterDerivatives` 用参考图文件名里的历史 id，把线稿排到对应确认稿后面。黑白在浅线稿之前。这个顺序只影响展示，不改数据库。

手抄报和画布共用生成 API、图库和会话表，用 `workspace_type` 区分。

## 数据

数据库文件是 `data/canvasforge.sqlite`，连接时执行 `pragma journal_mode = WAL`，因此旁边会出现 `-wal` 和 `-shm`。没有单独的迁移版本表。`migrate()` 先 `create table if not exists`，再用 `pragma table_info` 给旧库补列。

| 表 | 内容 |
| --- | --- |
| `conversations` | 会话草稿和参数。`workspace_type` 为 `canvas` 或 `hand-poster` |
| `generation_runs` | 一轮生成。`retry_attempts`、`retry_failures` 是 JSON 文本 |
| `image_history` | 单张结果或失败记录。`request_index` 对应并发位置 |
| `reference_images` | 参考图文件索引 |
| `conversation_reference_images` | 会话与参考图的顺序 |
| `generation_run_references` | 这一轮实际使用的参考图快照 |
| `prompt_templates` | 提示词库。`tags` 是 JSON 数组文本 |

新建会话时应用层写入的默认值（`AppDatabase.createConversation`）：

| 字段 | 默认 |
| --- | --- |
| 模型 | `gpt-image-2` |
| 比例 / 尺寸 | `1:1` / `1024x1024` |
| 质量 | `high` |
| 数量 | `1` |
| 输出格式 | `jpeg` |
| 背景 / 审核 | `auto` / `auto` |
| 流式 | 关闭 |
| 重试 / 超时 | `0` 次 / `300` 秒 |
| 自动写入历史 / 失败详情保留 | 都开启 |

表定义里的列默认值（例如 `output_format` 的 `'png'`）只用于更早的库结构，新插入行以应用层值为准。

`data/` 里的其他文件：

| 文件或目录 | 内容 |
| --- | --- |
| `settings.json` | `baseURL`、`defaultModel`、`promptModel`、`encryptedApiKey` 或无法加密时的 `plainApiKey` |
| `secret.key` | Base64 的 32 字节 AES 密钥 |
| `access.json` | 访问密码的 SHA-256，以及当前会话 token 的 SHA-256。权限 `0600` |
| `images/` | 生成图，文件名是历史 id |
| `reference-images/` | 参考图 |
| `restore-safety-copy/` | 最近一次恢复前复制出来的文件。备份时跳过这个目录 |

提示词库的浏览器遗留键是 `canvasforge.prompt-library.items.v1`。成功导入或服务端已有数据后，会写下 `canvasforge.prompt-library.server-migrated.v1`。

## 访问密码与备份

密码不是多用户账号。`access.json` 只保存一把密码的 SHA-256 十六进制，没有盐。登录成功后生成 32 字节随机 token，cookie 为 `canvasforge_session`，`HttpOnly`、`SameSite=Lax`、`Path=/`，没有 `Secure`，也没有 `Max-Age`。服务端只保留一个 `sessionTokenHash`，新的登录会替换旧会话。

备份把 `data/` 下除 `restore-safety-copy/` 以外的文件读成 Base64，放进 JSON：

```json
{
  "app": "CanvasForge",
  "version": 1,
  "exportedAt": "时间",
  "files": [{ "path": "相对 data 的路径", "contentBase64": "..." }]
}
```

恢复时先把当前文件复制到 `restore-safety-copy/`，再按清单覆盖同名路径。清单里没有的本地文件会保留。路径跳出 `data/` 会被拒绝。写完后约 300 毫秒关闭数据库并 `process.exit(0)`。生产容器靠重启策略重新拉起；开发热更新的行为见 [维护手册](./MAINTENANCE.md)。

## 进程生命周期

`SIGTERM` 和 `SIGINT` 会关闭 HTTP 服务和 SQLite，10 秒内关不掉则退出码 1。Compose 的 `stop_grace_period` 是 20 秒。

开发容器里 `hot-reload.mjs` 是 PID 1 经过 tini 之后的主进程。它用 `SIGTERM` 停止旧的 `node out/server/index.mjs`，最多等 10 秒后 `SIGKILL`。子进程自己退出时只打日志，不会立刻再拉起。
