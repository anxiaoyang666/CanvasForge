# 维护手册

日常操作、升级和排障。命令和文件名与仓库里的脚本、Compose 和源码一致。架构背景见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 先确认现在跑的是哪种方式

| 方式 | 怎么判断 | 更新代码后要做什么 |
| --- | --- | --- |
| 本地进程 | 前台是 `pnpm start`，端口默认 3000 | `pnpm build` 后重新 `pnpm start` |
| 开发容器 | `docker-compose.yaml`，容器里主进程最终会跑到 `docker/hot-reload.mjs` | 上传或保存被监视的源码，等日志里的 rebuild finished。改 Dockerfile 或 Compose 才需要 `--build` |
| 生产容器 | `docker compose -f docker-compose.prod.yaml`，只挂载 `./data` | 重新 `up -d --build`，或重启容器让启动命令重新安装并构建 |

启动成功时日志里有三行：

```text
CanvasForge build marker: canvasforge-web-encryption-check-2026-05-11
CanvasForge web server listening on http://0.0.0.0:3000
CanvasForge data directory: /app/data
```

`build marker` 写在 `src/server/index.ts`。怀疑部署的不是预期代码时，先比对这行和 `/healthz` 的返回。

```bash
curl -sS http://127.0.0.1:3000/healthz
```

容器日志：

```bash
docker compose logs -f canvasforge
```

生产文件部署时把 `-f docker-compose.prod.yaml` 加到 `logs`、`restart`、`down` 和 `up` 上。

## 数据目录

不要用空目录覆盖已有的 `data/`。这个目录被 `.gitignore` 忽略，里面是全部运行数据。

```text
data/
├─ settings.json
├─ secret.key
├─ access.json
├─ canvasforge.sqlite
├─ canvasforge.sqlite-wal
├─ canvasforge.sqlite-shm
├─ images/
├─ reference-images/
└─ restore-safety-copy/
```

`-wal` 和 `-shm` 只在数据库打开期间存在。复制整个目录做冷备份时，先停掉进程，避免主库和 WAL 不是同一时刻的内容。页面里的「下载完整备份」是进程内读文件，生成进行中时同样可能读到半截 WAL。

`secret.key` 和 `settings.json` 必须一起保留。只有设置文件时，加密的 API Key 解不开。`access.json` 丢了等于访问密码被清掉，保护会处于关闭状态，直到重新设置。

SQLite 用 WAL。服务运行时不要另外用工具压缩或替换 `canvasforge.sqlite`，先停进程。

## 备份与恢复

界面入口是顶栏「维护」。

- 「下载完整备份」请求 `GET /api/maintenance/backup`，得到一个 JSON 文件，文件名形如 `canvasforge-backup-YYYY-MM-DD.json`。
- 恢复会先确认，再 `POST /api/maintenance/restore`。
- 恢复是覆盖同名文件，不会删除数据目录里多出来的文件。
- 恢复前的文件被复制到 `data/restore-safety-copy/`。这个目录自身不会进入下一份备份。连续恢复时，安全副本里的同名文件会被后一次覆盖。

恢复请求同样受 `CANVASFORGE_MAX_JSON_BODY_BYTES` 限制，默认约 28MB。图片很多时，JSON 备份会比图片目录更大，可能超过这个上限。此时改用停机后复制整个 `data/` 目录。

恢复后的进程行为：

| 运行方式 | 实际结果 |
| --- | --- |
| 生产 Compose | 主进程退出，`restart: unless-stopped` 重新创建进程并再次执行安装、构建和启动 |
| 本地 `pnpm start` | 进程结束，需要再次执行 `pnpm start` |
| 开发 Compose | `hot-reload.mjs` 仍在，里面的 Node 服务不会自动重启。执行 `docker compose restart canvasforge`，或修改一个被监视的文件触发重建 |

界面文案是「备份已恢复，服务正在重启」。开发容器和本地进程需要按上表手动把服务拉起来。

若恢复后无法登录或 Key 失效，到 `data/restore-safety-copy/` 查看恢复前的 `settings.json`、`secret.key` 和 `access.json`。把需要的文件拷回 `data/` 后重启进程。

## 访问密码

维护弹窗里保存非空密码即开启保护，保存空密码即关闭。密码以 SHA-256 存在 `access.json`，服务端同时只保留一个登录会话。

忘记密码时，停掉服务后删除 `data/access.json`，再启动。没有这个文件时，`/api/*` 不再要求登录。

密码不保护 `/images/image/:id`、`/images/reference/:id` 和前端静态文件。如果部署在不可信网络，需要在反向代理上额外限制来源，或不要把端口直接暴露到公网。应用本身没有反向代理配置。

## 升级应用

1. 备份 `data/`，或在维护页下载一份 JSON 备份。
2. 用新的源码覆盖除 `data/` 以外的文件。`node_modules/` 和 `out/` 可以留下，也可以删掉后重装。
3. 本地执行 `pnpm install`、`pnpm test`、`pnpm build`、`pnpm start`。
4. 开发容器：如果只改了 `src/` 或被热更新监视的配置，等待自动重建；如果改了 lockfile，热更新会重新 `pnpm install`。改了 Dockerfile 或系统依赖时执行 `docker compose up -d --build`。
5. 生产容器执行：

```bash
docker compose -f docker-compose.prod.yaml up -d --build
```

启动时会自动补 SQLite 缺列，不需要手工迁移命令。补列逻辑在 `AppDatabase.migrate()`，只增加列和建表，没有回滚脚本。

升级后打开 `/healthz`，确认 `ok` 为 `true`，再在界面里看一条旧图是否能打开。图片打不开通常是 `image_history.file_path` 仍指向旧机器的绝对路径。数据库记录的是当时的绝对路径，把整个 `data/` 换到另一个挂载点后，需要路径仍然等于记录里的 `file_path`，或者保留原来的 `CANVASFORGE_DATA_DIR`。

## 依赖与原生模块

`package.json` 的 `pnpm.onlyBuiltDependencies` 包含 `esbuild` 和 `better-sqlite3`。开发容器安装时使用：

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm rebuild esbuild better-sqlite3
```

生产启动命令是 `corepack pnpm install --frozen-lockfile`，没有 `--ignore-scripts`。锁文件变化后不要只拷贝 `package.json`。

镜像里通过 Corepack 使用 `package.json` 声明的 pnpm 10.26.2。

## 常见故障

**页面是接口 JSON，或提示静态资源未构建。**

`out/renderer/index.html` 不存在，或 `CANVASFORGE_STATIC_DIR` 指错。本地先 `pnpm build`。生产容器看启动命令里的 `pnpm build` 是否失败。

**热更新日志写着 rebuild failed，旧页面仍在。**

这是 `docker/hot-reload.mjs` 的既定行为。看同一段日志里的 `tsc` 或 Vite 错误，修正文件后会自动再试。第一次启动就失败时没有旧服务，页面会一直不可用，直到构建通过。

**`better-sqlite3` 编译失败。**

本地需要 Python 3 和 C++ 工具链。容器镜像已经安装 `python3` 和 `build-essential`。命名卷 `canvasforge_node_modules` 里如果留下半次安装，可以 `docker compose down` 后删除该卷再启动。删除卷不会删除 `./data`。

**生成失败，历史里有错误详情。**

工作区失败卡片可以打开详情。常见文本：

| 文案 | 含义 |
| --- | --- |
| `API key is not configured.` | 还没保存 Key，或 Key 解不开 |
| `Prompt is required.` | 空提示词 |
| `Image generation timed out after N seconds.` | 单次等待超过会话超时 |
| `Generation interrupted before completion.` | 进程在这一轮结束前退出，启动时补记的失败 |
| `Generation canceled.` | 这一轮被取消 |
| 上游 HTTP 文案 | `ImageService` 转发的接口错误 |

取消某一张时请求体要带 `requestIndex`。不带序号时，只有这一轮创建时的请求数是 1 才会取消；`n > 1` 的轮次会直接返回，不会取消剩余请求。

**模型列表拉不下来。**

`POST /api/settings/models` 使用当前或刚输入的 Key 请求 `GET {baseURL}/v1/models`。上游没有这个路径时，在 API 设置里直接填写图片模型名和提示词模型名即可，生成不依赖模型列表。

**手抄报线稿没有排在确认稿后面。**

排序依赖确认稿提示词中的「彩色确认稿」、线稿提示词中的「线稿版」，以及参考图文件名中的历史 id。手工改过提示词或参考图后，`orderHandPosterDerivatives` 会把它当成普通历史。

**容器健康检查失败，但日志显示服务已监听。**

第一次安装和构建可能超过 Dockerfile 里 60 秒的 `start-period`。服务起来后，后续检查访问 `/healthz` 成功就会恢复。

## 改代码时的约定

- 只改文档以外的功能时，共享类型放在 `src/shared/types.ts`，避免浏览器包去 import `@core`。
- 新的 HTTP 接口加在 `handleApi`，并在 `browser-api.ts` 的 `CanvasForgeAPI` 实现里补上对应方法。
- 新的会话字段要同时改 `conversations` 的建表语句和 `migrate()` 里的补列，否则旧的 `data/canvasforge.sqlite` 启动即失败。
- 图片请求字段改 `src/shared/image-options.ts` 的 `buildImageRequestBody`。数量上限、重试上限和默认超时也在这个文件。
- 前端测试文件与源码相邻，命名为 `*.test.ts`，由 `vitest.config.ts` 收集。当前没有测试运行器的浏览器环境。
- 提交前运行 `pnpm test` 和 `pnpm build`。`pnpm build` 包含 `tsc --noEmit`。

## 测试覆盖的范围

`pnpm test` 覆盖的是单元测试，包括：图片请求体、生成进度与取消、错误详情、设置加密迁移、中断轮次恢复、历史筛选、提示词服务解析、工作区摘要、预览缩放、图库下载触发、手抄报排序和会话 store。它不会启动 HTTP 服务，也不会访问真实的图片接口。
