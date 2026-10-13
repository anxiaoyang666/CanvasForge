# CanvasForge

CanvasForge 是一个面向 Docker 部署的 Web 图片生成工作台。浏览器打开页面后，可以管理多个创作会话、调用 OpenAI-compatible 图片接口、把结果写入本地 SQLite，并在图库里检索、预览、收藏和下载。

当前版本为 `1.0.2`（`package.json` 的 `version`，界面版本号由 `src/shared/app-version.ts` 读取）。仓库只保留 Web 服务形态：Node.js 提供 API 和静态页面，没有桌面壳，也没有远程桌面。

## 界面截图

### 控制台

![控制台界面](https://tncache1-f1.v3mh.com/image/2026/05/11/9ea034f922a51ecbdc2f9c8db47b006a.png)

### 预览

![预览界面](https://tncache1-f1.v3mh.com/image/2026/05/11/976f85bdb54668c3ecbebf9a052f86b9.png)

### 图库

![图库界面](https://tncache1-f1.v3mh.com/image/2026/05/11/1019050da0e76d8d7efcf8a81fb61eea.png)

## 功能

- **画布工作台**：多会话保存提示词草稿、模型、比例、尺寸、质量、数量和高级参数。设置面板只在画布页显示。
- **文生图与图生图**：无参考图时请求 `/v1/images/generations`，有参考图时请求 `/v1/images/edits`。每个会话最多 8 张参考图，单张不超过 20MB，格式为 PNG、JPEG、WebP。
- **并发生成与取消**：数量 `n` 会被限制在 1 到 10，服务端按这个数量并发发出单图请求。单张完成后立即写入历史。取消指定序号时只中止对应请求；用户取消的图片不写入失败历史。
- **失败重试与超时**：会话可配置重试次数（0 到 10，默认 0）和单次超时秒数（默认 300）。开启流式后，若 60 秒没有新的图片数据，会回退到非流式请求。
- **提示词辅助**：调用 `/v1/responses`。可以生成一条灵感提示词，或在保留原意的前提下丰富当前提示词。模型默认 `gpt-5.4-mini`。
- **提示词库**：内置 12 条模板（`src/renderer/src/prompt-library.ts`）。浏览器里的旧数据会在服务端提示词表为空时导入 SQLite。之后支持新增、编辑、删除、导入、筛选和套用到当前会话。
- **手抄报**：独立工作区。按主题、年级、横竖版、密度和用途生成彩色确认稿，再以确认稿为参考图生成黑白线稿和浅线稿。
- **图库**：按全部、画布或手抄报筛选，支持搜索、按时间排序、只看收藏、删除、批量触发浏览器下载、作为参考图以及参数回填。关闭「自动写入历史」后，新结果的 `global_visible` 为 0，图库列表不再显示这些记录。
- **预览**：缩放、滚轮缩放、拖拽、左右切换、复制、下载和系统全屏。
- **访问保护与维护**：可设置一把访问密码，下载 `data/` 的完整备份，恢复备份，并查看数据量和磁盘占用。
- **界面**：白天/黑夜主题（只保存在当前页面内存里）、可收起的画布设置面板、可拖拽的会话栏宽度（写入 `localStorage` 键 `canvasforge-sidebar-width`）。

## 技术栈

| 部分 | 实现 |
| --- | --- |
| 运行时 | Node.js 22（Dockerfile 基础镜像 `node:22-bookworm-slim`；`package.json` 没有 `engines` 字段） |
| 包管理 | pnpm 10.26.2（`packageManager` 字段） |
| 前端 | React 19、Vite 5、Zustand 5、lucide-react |
| 语言 | TypeScript 5 |
| 服务 | Node.js `http` 模块，Vite 以 SSR 方式打包成 `out/server/index.mjs` |
| 数据 | better-sqlite3，WAL 模式 |
| 测试 | Vitest 2，测试环境为 Node |

## 环境要求

- Node.js 22
- pnpm 10.26.2。Node 22 自带 Corepack，可先执行 `corepack enable`
- 可用的 OpenAI-compatible API Key
- 使用容器部署时还需要 Docker 与 Docker Compose

`better-sqlite3` 是原生模块。本机如果没有对应预编译包，安装时需要 Python 3 和 C++ 构建工具。镜像里已经安装了 `python3`、`build-essential` 和 `tini`。

## 本地开发

仓库没有 `dev` 脚本，也没有热更新的本地命令。本地流程是安装、构建、启动：

```bash
pnpm install
pnpm build
pnpm start
```

`pnpm build` 与 `pnpm build:web` 相同，依次执行：

1. `tsc --noEmit`
2. `vite build --config vite.web.config.ts`，输出到 `out/renderer`
3. `vite build --config vite.server.config.ts`，输出到 `out/server/index.mjs`

`pnpm start` 执行 `node out/server/index.mjs`。默认监听 `0.0.0.0:3000`，数据目录是当前工作目录下的 `data/`。浏览器打开：

```text
http://localhost:3000
```

改完 `src/` 后需要重新执行 `pnpm build`，再重新执行 `pnpm start`。服务进程不会监视源码。

首次打开后，在顶部「API」里填写：

| 字段 | 默认值 | 保存位置 |
| --- | --- | --- |
| `baseURL` | `https://api.openai.com` | `data/settings.json` |
| API Key | 空 | 用 `data/secret.key` 做 AES-256-GCM 加密后写入 `settings.json` |
| 默认图片模型 | `gpt-image-2` | `data/settings.json` |
| 提示词辅助模型 | `gpt-5.4-mini` | `data/settings.json` |

模型列表来自 `GET {baseURL}/v1/models`。接口返回的 `id` 会按字母序显示，也可以手工输入未列出的模型名。

运行测试：

```bash
pnpm test
```

该命令执行 `vitest run`，匹配 `src/**/*.test.ts`。仓库没有 lint 脚本，也没有端到端测试。

## 构建与部署

仓库当前没有 `.github/workflows` 或其他 CI 配置。发布方式就是在目标机器上构建并运行容器，或者直接运行上一节的 `pnpm build` 与 `pnpm start`。

两种 Compose 文件都把容器内端口 `3000` 映射到宿主机 `${CANVASFORGE_WEB_PORT:-3002}`，并把 `./data` 挂到 `/app/data`。Dockerfile 的健康检查访问 `http://127.0.0.1:3000/healthz`，间隔 30 秒，启动宽限期 60 秒。

### 开发容器（源码挂载，热更新）

`docker-compose.yaml` 把整个项目目录挂进容器，并用命名卷单独保存 `node_modules`：

```text
./:/app
./data:/app/data
canvasforge_node_modules:/app/node_modules
```

启动：

```bash
docker compose up -d --build
```

浏览器访问 `http://localhost:3002`。容器入口是 `docker/start-dev.sh`：启用 Corepack，缺少 `tsc` 时按 lockfile 安装依赖并重建 `esbuild`、`better-sqlite3`，然后执行 `docker/hot-reload.mjs`。

热更新监视 `src/`、`package.json`、`pnpm-lock.yaml`、`tsconfig.json` 和三份 Vite/Vitest 配置。文件变化后等待 1.5 秒，执行 `pnpm build:web` 并重启 `node out/server/index.mjs`。依赖文件变化时会先重新安装。新构建失败时保留上一份正在运行的服务。`data/`、`out/`、`node_modules/` 和 `.git` 不触发重建。

因此日常更新源码后不需要重新构建镜像。只有改了 `Dockerfile`、`docker-compose.yaml`、基础镜像或系统依赖时才需要 `--build` 或重建容器。

```bash
docker compose logs -f canvasforge
docker compose restart canvasforge
docker compose down
```

改宿主机端口：

```bash
CANVASFORGE_WEB_PORT=8080 docker compose up -d
```

默认基础镜像是 `docker.m.daocloud.io/library/node:22-bookworm-slim`。拉取失败时可以覆盖构建参数：

```bash
NODE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim docker compose up -d --build
```

Dockerfile 默认把 Debian apt 源换成清华镜像。可以在构建时覆盖：

```bash
APT_MIRROR=http://mirrors.aliyun.com/debian APT_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security docker compose up -d --build
```

开发 Compose 默认把 `NPM_REGISTRY` 设为 `https://registry.npmmirror.com`。`docker/start-dev.sh` 和 `docker/hot-reload.mjs` 会执行 `pnpm config set registry`。要改回官方源：

```bash
NPM_REGISTRY=https://registry.npmjs.org docker compose up -d
```

### 生产容器（只挂载数据目录）

```bash
docker compose -f docker-compose.prod.yaml up -d --build
```

生产 Compose 不挂载源码。镜像构建阶段只安装系统依赖并 `COPY` 源码；真正的 `pnpm install --frozen-lockfile`、`pnpm build` 和 `node out/server/index.mjs` 发生在容器每次启动时。更新代码需要重新构建或重启容器。这条启动命令不读取 `NPM_REGISTRY`。

生产 Compose 会把 `CANVASFORGE_STATIC_DIR=/app/out/renderer` 和 `CANVASFORGE_MAX_JSON_BODY_BYTES` 传给进程。开发 Compose 不传后者，进程使用代码里的默认值 `29360128`。

在绿联 NAS 上使用同一套 Compose。访问地址是 `http://<NAS IP>:<宿主机端口>`。更新应用时覆盖源码和配置，保留 NAS 上的 `data/`。

建议随部署一起保留的文件：

```text
Dockerfile
docker-compose.yaml
docker-compose.prod.yaml
.dockerignore
package.json
pnpm-lock.yaml
tsconfig.json
vite.web.config.ts
vite.server.config.ts
vitest.config.ts
docker/
src/
docs/
README.md
LICENSE
```

## 环境变量与配置

Node 进程只读取运行环境里的变量，项目没有使用 `dotenv`，也不会自动加载 `.env`。Docker Compose 会用项目根目录的 `.env` 或当前 shell 替换 `${...}`，但变量必须写进对应 Compose 文件的 `environment`，才会进入容器。

### 进程直接读取

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `3000` | 监听端口。容器内固定为 3000 |
| `CANVASFORGE_DATA_DIR` | `<cwd>/data` | SQLite、设置、密钥和图片目录 |
| `CANVASFORGE_STATIC_DIR` | `<cwd>/out/renderer` | 前端构建产物目录 |
| `CANVASFORGE_MAX_JSON_BODY_BYTES` | `29360128`（约 28MB） | JSON 请求体上限，影响参考图上传和备份恢复 |

本地示例：

```bash
PORT=3000 CANVASFORGE_DATA_DIR=./data pnpm start
```

生产 Compose 调整请求体上限：

```bash
CANVASFORGE_MAX_JSON_BODY_BYTES=52428800 docker compose -f docker-compose.prod.yaml up -d
```

开发 Compose 的 `environment` 没有这项，在 `docker compose up` 前面加同名变量不会传到进程。

### 只由 Compose 或镜像构建使用

| 变量或构建参数 | 默认值 | 使用位置 |
| --- | --- | --- |
| `CANVASFORGE_WEB_PORT` | `3002` | 两个 Compose 文件的宿主机端口 |
| `CANVASFORGE_HOT_RELOAD_INTERVAL_MS` | `2500`，代码里最小按 1000 毫秒计 | 仅开发容器热更新轮询 |
| `NPM_REGISTRY` | Compose 默认 `https://registry.npmmirror.com`；脚本未设置时用 `https://registry.npmjs.org` | 仅 `docker/start-dev.sh` 与 `docker/hot-reload.mjs` |
| `NODE_ENV` | 开发 Compose 为 `development`，生产 Compose 为 `production` | 传入容器；应用代码未读取 |
| `TZ` | `Asia/Shanghai` | 容器时区 |
| `CI` | 开发 Compose 设为 `true` | 应用代码未读取 |
| `NODE_IMAGE` | `docker.m.daocloud.io/library/node:22-bookworm-slim` | Dockerfile 基础镜像 |
| `APT_MIRROR` | `http://mirrors.tuna.tsinghua.edu.cn/debian` | 构建时替换 Debian 源 |
| `APT_SECURITY_MIRROR` | `http://mirrors.tuna.tsinghua.edu.cn/debian-security` | 构建时替换 Debian security 源 |

服务配置（接口地址、模型、加密后的 API Key）不放在环境变量里，而放在 `data/settings.json`。访问密码放在 `data/access.json`。

## 目录结构

```text
.
├─ docker/
│  ├─ start-dev.sh          # 开发容器入口：安装依赖并启动热更新
│  └─ hot-reload.mjs        # 轮询源码、构建并重启 Node 服务
├─ docs/                    # 架构、维护手册，以及早期设计备忘
├─ src/
│  ├─ core/                 # SQLite、设置、图片请求、提示词请求
│  ├─ server/               # HTTP API、静态资源、备份和访问密码
│  ├─ renderer/             # React 页面
│  └─ shared/               # 前后端共用类型、默认参数和版本号
├─ Dockerfile
├─ docker-compose.yaml      # 源码挂载 + 热更新
├─ docker-compose.prod.yaml # 只持久化 data/
├─ package.json
├─ vite.web.config.ts
├─ vite.server.config.ts
└─ vitest.config.ts
```

运行后还会出现这些未纳入版本控制的目录：

```text
data/    # 设置、数据库、密钥和图片
out/     # pnpm build 的前端与服务端产物
node_modules/
```

`src/renderer/src` 下的主要界面：

| 路径 | 职责 |
| --- | --- |
| `App.tsx` | 主题根节点和访问密码门闩 |
| `browser-api.ts` | 把 `window.canvasForge` 映射到 `/api` |
| `store/app-store.ts` | 会话、生成、图库和提示词的页面状态 |
| `components/layout/` | 顶栏和三栏布局 |
| `components/workspace/` | 画布提示词、结果网格、生成中卡片和错误详情 |
| `components/hand-poster/` | 手抄报确认稿与线稿流程 |
| `components/gallery/` | 图库筛选和批量操作 |
| `components/prompt-library/` | 提示词模板页面 |
| `components/settings/` | API 弹窗和当前会话参数 |
| `components/maintenance/` | 备份、恢复、访问密码和磁盘占用 |
| `components/preview/` | 图片和参考图预览 |

模块之间怎么配合，见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。备份、升级和排障见 [docs/MAINTENANCE.md](docs/MAINTENANCE.md)。

## 外部接口

图片和提示词请求都发往用户配置的 `baseURL`：

```text
POST {baseURL}/v1/images/generations
POST {baseURL}/v1/images/edits
POST {baseURL}/v1/responses
GET  {baseURL}/v1/models
```

图片请求体由当前会话参数组装，字段包括 `prompt`、`model`、`size`、`quality`、`n`，以及按需附带的 `output_format`、`output_compression`、`background`、`moderation`、`stream`、`partial_images`。模型名以 `gpt-image-2` 开头时不发送 `input_fidelity`。响应需要包含 `b64_json` 或 `url`，服务端再把文件写到 `data/images/`。

## 常见问题

**打开页面提示 “Web assets not built. Run pnpm build:web first.”**

`CANVASFORGE_STATIC_DIR`（默认 `out/renderer`）里没有 `index.html`。先执行 `pnpm build`。开发容器第一次启动时，要等热更新日志出现构建完成后再访问。

**顶栏显示 “等待密钥”。**

`data/settings.json` 里还没有 API Key。在「API」中保存后，状态点会变成已配置。Key 本身不会返回给浏览器。

**容器一直 unhealthy。**

健康检查的启动宽限期是 60 秒。第一次 `pnpm install` 加构建经常超过这个时间，Docker 会把容器标成 unhealthy，热更新进程仍会继续。用 `docker compose logs -f canvasforge` 看是否已经打印 `CanvasForge web server listening`。

**开发容器里恢复备份后页面打不开。**

恢复接口会在写完文件后让 Node 服务进程退出。生产 Compose 的主进程就是这个服务，`restart: unless-stopped` 会把容器拉起来。开发 Compose 的主进程是 `hot-reload.mjs`，子进程退出后不会自动再启动，需要 `docker compose restart canvasforge`，或改一次被监视的源码触发重建。本地 `pnpm start` 退出后也要手动重新启动。

**设置了访问密码，图片地址仍能直接打开。**

密码只拦截 `/api/*`（登录和状态接口除外）。`/images/...` 和前端静态文件不校验 cookie。密码适合挡住工作台操作，不适合作为图片直链的授权。

**换机器或清空 `data/` 后，原来的 API Key 无法解密。**

密钥在 `data/secret.key`。丢失该文件后，`settings.json` 里的 `encryptedApiKey` 无法还原，需要重新填写 API Key。

**请求报“请求内容不能超过 28MB”。**

参考图和备份恢复都走 JSON。单张参考图上限是 20MB，多张一起上传或恢复很大的备份时会先碰到 JSON 体上限。生产环境用 `CANVASFORGE_MAX_JSON_BODY_BYTES` 调整。

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [维护手册](docs/MAINTENANCE.md)
- [设计方案](docs/设计方案.md)：早期界面备忘，不作为当前实现依据
- [实现总结](docs/实现总结.md)：阶段性记录，不作为当前实现依据

## 贡献

提交前运行：

```bash
pnpm test
pnpm build
```

Pull Request 请写明变更目的、实现方式、测试结果，以及是否影响 `data/` 里的数据或配置。

## 许可证

本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE)。

可以用于个人学习、研究、实验和非商业二次开发。未经 CanvasForge 明确书面授权，不得将本项目或其衍生作品用于商业用途。

该许可证包含非商业限制，因此本项目属于 source-available 软件，不属于 OSI 定义下的开源软件。如需商业授权，请联系项目作者。
