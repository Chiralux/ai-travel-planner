# AI Travel Planner Starter

最小可运行的 Next.js 14 + TypeScript + Tailwind CSS + Zustand 骨架，同时预置 @ant-design/maps、tRPC、ioredis、@logtail/node 等依赖，方便后续扩展。

## 快速开始

示例使用 `pnpm`，可根据需要替换为 npm 或 yarn。

```bash
pnpm install
pnpm dev
```

- 本地开发地址：<http://localhost:3000>
- 生产构建：`pnpm build`
- 启动生产服务：`pnpm start`
- 代码检查：`pnpm lint`
- Docker 构建示例：`pnpm docker-build`

## 环境变量

根据 `.env.example` 创建 `.env.local` 或部署环境所需文件并补全值：

- `NEXT_PUBLIC_APP_NAME`：前端展示的应用名称。
- `NEXT_PUBLIC_AMAP_WEB_KEY`、`AMAP_REST_KEY`：高德地图 Web 与 REST API Key。
- `AI_PROVIDER`、`ALIYUN_DASHSCOPE_API_KEY`：LLM 服务商标识与阿里云百炼（DashScope）API Key。
- `IFLYTEK_APP_ID`、`IFLYTEK_API_KEY`、`IFLYTEK_API_SECRET`：科大讯飞语音识别凭证。
- `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`：Supabase 项目配置。
- `REDIS_URL`：Redis 连接串（例如 `redis://default:password@redis:6379`）。
- `LOGTAIL_SOURCE_TOKEN`：Logtail Source Token，用于日志流转。
- `NEXT_TELEMETRY_DISABLED`：设为 `1` 以禁用 Next.js 遥测。

## 目录结构

```
app/            # Next.js App Router 入口
styles/         # 全局样式（Tailwind 指令）
lib/store/      # Zustand 示例 Store
```

完成上述安装后即可访问欢迎页，并根据项目需求继续集成 tRPC API、Redis 缓存、高德地图、Logtail 等能力。

## Docker 镜像

使用多阶段 `Dockerfile` 生成 standalone 产物，可通过以下方式构建与运行：

```bash
docker build -t ghcr.io/username/repo:latest .
docker run -p 3000:3000 --env-file .env.local ghcr.io/username/repo:latest
```

若已配置 CI/CD，可直接拉取远程镜像：

```bash
docker pull ghcr.io/username/repo:latest
```

## CI / CD

`.github/workflows/docker-build-and-push.yml` 会在推送到 `main` 时自动构建并发布容器镜像：

- 若配置 `DOCKERHUB_USERNAME` 和 `DOCKERHUB_TOKEN`，镜像推送到 Docker Hub（例如 `docker.io/<username>/ai-travel-planner`）。
- 否则默认推送到 GitHub Container Registry（`ghcr.io/<owner>/<repo>`），使用仓库自带的 `GITHUB_TOKEN`。