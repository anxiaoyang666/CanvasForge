# CanvasForge

CanvasForge 是一个面向 Docker 部署的 Web 图片生成工作台，使用 Node.js、React 和 TypeScript 构建，支持接入 OpenAI-compatible 图片生成接口。

它面向本地化的 AI 绘画工作流：在多会话中管理提示词、参考图和生成参数，将生成结果保存到本地 SQLite 历史库，并提供图库检索、预览、收藏、复制、下载和参数回填。

## 界面截图

### 控制台

![控制台界面](https://tncache1-f1.v3mh.com/image/2026/05/11/9ea034f922a51ecbdc2f9c8db47b006a.png)

### 预览

![预览界面](https://tncache1-f1.v3mh.com/image/2026/05/11/976f85bdb54668c3ecbebf9a052f86b9.png)

### 图库

![图库界面](https://tncache1-f1.v3mh.com/image/2026/05/11/1019050da0e76d8d7efcf8a81fb61eea.png)

## 功能特性

- OpenAI-compatible 接口：配置 `baseURL`、`apiKey`、图片模型和提示词辅助模型。
- 文生图与图生图：支持会话参考图，调用 `/v1/images/generations` 和 `/v1/images/edits`。
- 多会话工作台：每个会话独立保存 prompt 草稿、模型、比例、尺寸、质量、数量和高级参数。
- 并发生成与单图取消：当 `n > 1` 时并发请求，单张完成后立即写入历史并更新工作区。
- 提示词辅助：支持一键生成灵感提示词，并对当前提示词进行丰富和优化。
- 提示词库：内置常用模板，支持新增、编辑、删除、筛选、复制和一键套用到当前会话。
- 本地图库：支持搜索、排序、筛选、收藏、删除、批量下载、作为参考图图生图和参数回填。
- 图片预览：支持智能缩放、滚轮缩放、拖拽平移、左右切换、复制、下载和系统全屏。
- 本地持久化：使用 SQLite 保存会话、生成轮次和图片历史，生成图片保存到本地文件夹。
- 访问保护与维护：支持设置访问密码、下载完整备份、恢复备份、查看数据量和磁盘占用。
- 工作台体验：支持白天/黑夜主题、可收起设置面板、可拖拽调整会话栏宽度。

## 技术栈

- Node.js 22
- Vite
- React 19
- TypeScript 5
- Zustand
- better-sqlite3
- Vitest

## 环境要求

- Docker 与 Docker Compose
- Node.js 22 或兼容版本
- pnpm 10
- 可用的 OpenAI-compatible API Key

项目声明的包管理器为：

```text
pnpm@10.26.2
```

## 快速开始

安装依赖：

```powershell
pnpm install
```

构建 Web 版本：

```powershell
pnpm build
```

启动服务：

```powershell
pnpm start
```

打开浏览器访问服务地址后，在右侧设置面板填写：

- `baseURL`：默认 `https://api.openai.com`
- `apiKey`：图片生成服务的 API Key
- 默认图片模型：默认 `gpt-image-2`
- 提示词辅助模型：默认 `gpt-5.4-mini`

## 绿联 NAS / Docker 运行

CanvasForge 现在只保留 Web/Docker 部署方式：容器内启动 Node.js 后端，浏览器打开地址后直接进入 CanvasForge 界面，不需要远程桌面或 noVNC。

在绿联 NAS 的 Docker 项目目录里放入源码后，首次启动需要构建一次：

```bash
docker compose up -d --build
```

打开浏览器访问：

```text
http://localhost:3002
```

本地数据会挂载到项目根目录的 `data/`：

```text
data/
├─ settings.json
├─ secret.key
├─ canvasforge.sqlite
├─ images/
└─ reference-images/
```

常用命令：

```bash
docker compose logs -f canvasforge
docker compose restart canvasforge
docker compose down
```

如需修改浏览器访问端口：

```bash
CANVASFORGE_WEB_PORT=8080 docker compose up -d
```

默认 compose 已把 Node 基础镜像指向 `docker.m.daocloud.io/library/node:22-bookworm-slim`，避免部分绿联环境的 Docker Hub 镜像源解析失败。

Dockerfile 默认使用清华 Debian apt 镜像源安装构建依赖，避免卡在 `apt-get update`。如果你的网络访问其他源更快，可以通过构建参数覆盖：

```bash
APT_MIRROR=http://mirrors.aliyun.com/debian APT_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security docker compose up -d --build
```

如果绿联 NAS 拉取 npm 官方源较慢，可以在启动前指定 npm 镜像源：

```bash
NPM_REGISTRY=https://registry.npmmirror.com docker compose up -d
```

如果构建仍卡在 `load metadata for docker.io/library/node`，或报 `docker.1ms.run ... not found`，可以换一个基础镜像源再构建：

```bash
NODE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim docker compose up -d --build
```

在绿联 Docker / Compose 面板里可以使用同样的 compose 配置。端口映射保持为 `3000` 容器端口，宿主端口默认用 `3002`，也可按需要改成 `8080` 或其他未占用端口；访问地址就是 `http://绿联NAS_IP:宿主端口`。

当前 compose 使用 NAS 热更新模式：源码目录挂载进容器，运行数据单独挂载到 `data/`。

```text
./:/app
./data:/app/data
canvasforge_node_modules:/app/node_modules
```

容器启动后会运行 `docker/hot-reload.mjs`：

- 首次启动自动安装依赖并构建 Web 版本。
- 上传 `src/`、配置文件或 lockfile 的新版本后，容器会自动重新构建并重载 Node 服务。
- 新构建失败时，旧服务会继续运行；修正文件并再次上传后会自动重试。

镜像构建阶段只安装系统依赖，项目依赖安装和 Web 构建都放到容器启动后的热更新流程里完成。日常更新只需要上传新文件，不需要手动重启容器，也不需要重新构建镜像。只有改了 `Dockerfile`、`docker-compose.yaml`、基础镜像或系统依赖时，才需要重新构建或重启容器。

如果希望使用更稳的生产运行方式，不挂载完整源码，只保留 `data/` 持久化目录，可以使用：

```bash
docker compose -f docker-compose.prod.yaml up -d --build
```

生产 compose 会在容器启动时安装依赖、构建前后端并运行 `node out/server/index.mjs`。这种模式更新代码时需要重新构建或重启，但运行时不会把整个源码目录暴露给容器。

浏览器右上角的「维护」入口可以设置访问密码、下载完整备份和恢复备份。恢复备份会先在 `data/restore-safety-copy/` 留一份恢复前文件副本，然后覆盖备份中的同名文件，并让服务重启以重新打开 SQLite 数据库。

参考图上传和备份恢复请求默认限制为约 28MB JSON 请求体，可通过环境变量调整：

```bash
CANVASFORGE_MAX_JSON_BODY_BYTES=52428800 docker compose up -d
```

绿联 NAS 部署时建议上传这些文件和目录：

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

不要用本地空目录覆盖绿联 NAS 上的 `data/`，这个目录是运行数据、设置、加密密钥和生成图片的持久化位置。建议在绿联文件管理器里把 `data/` 当作生产数据目录长期保留，更新应用时只覆盖源码和配置文件。

## 常用脚本

```powershell
pnpm test     # 运行单元测试
pnpm build    # TypeScript 检查并构建 Web 前端和 Node.js 服务
pnpm start    # 启动已构建的 Web 服务
```

## 本地数据

Docker Compose 默认把数据挂载到项目根目录的 `data/` 目录。

```text
data/
├─ settings.json
├─ canvasforge.sqlite
├─ images/
└─ reference-images/
```

- `settings.json`：服务配置和 API Key 存储状态。
- `canvasforge.sqlite`：会话、生成轮次、图片历史和参考图索引。
- `images/`：生成后的图片文件。
- `reference-images/`：导入或从历史复制出的参考图文件。

API Key 会通过 Web 服务生成的 `secret.key` 加密保存；不要删除或用空目录覆盖生产环境的 `data/`。

## 项目结构

```text
src/
├─ core/          # SQLite、设置、图片请求、文件处理等核心服务
├─ renderer/      # React 前端界面
├─ server/        # Web API、静态资源和图片访问服务
└─ shared/        # 前后端共享类型与工具

docs/             # 设计方案与实现总结
data/             # 开发环境本地数据，未纳入版本控制
out/              # 构建输出
```

## 接口配置

CanvasForge 默认按 OpenAI-compatible 规范请求：

```text
POST {baseURL}/v1/images/generations
POST {baseURL}/v1/images/edits
POST {baseURL}/v1/responses
```

图片生成请求由当前会话参数决定，包括 prompt、模型、尺寸、质量、输出格式、背景、审核等级、流式参数和参考图。提示词辅助功能使用 `/v1/responses`。

## 测试与质量

运行全部测试：

```powershell
pnpm test
```

运行构建检查：

```powershell
pnpm build
```

当前测试覆盖了图片参数构造、生成进度、取消逻辑、错误详情、设置存储、历史筛选、工作区摘要、预览元数据和批量下载等核心逻辑。

## 文档

- [设计方案](docs/设计方案.md)
- [实现总结](docs/实现总结.md)

## 贡献

欢迎通过 Issue 或 Pull Request 反馈问题和改进建议。

建议在提交前运行：

```powershell
pnpm test
pnpm build
```

提交 PR 时请说明：

- 变更目的
- 主要实现方式
- 测试结果
- 可能影响的数据或配置

## 许可证

本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE)。

你可以将本项目用于个人学习、研究、实验和非商业二次开发。未经 CanvasForge 明确书面授权，不得将本项目或其衍生作品用于商业用途。

该许可证包含非商业限制，因此本项目属于 source-available 软件，不属于 OSI 定义下的开源软件。如需商业授权，请联系项目作者。
