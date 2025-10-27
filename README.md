docker pull ghcr.io/username/repo:latest
# AI Travel Planner

面向个人出行与小团队旅行的智能行程规划应用。结合语音识别、LLM 行程生成、高德地图地理信息和云端同步能力，为用户提供「输入—规划—保存—再编辑」的一体化体验。

## 项目简介与功能点

- 通过语音或文本输入旅行需求，解析出结构化行程偏好。
- 调用 Qwen / OpenAI 等 LLM 生成行程草案，并结合高德地图补全地理坐标与置信度说明。
- 支持行程的云端保存、编辑、删除与快速切换，数据托管在 Supabase Postgres。
- 采用 Next.js App Router + tRPC 作为 BFF（Backend For Frontend），统一管理 API、鉴权与缓存。
- 使用 Redis 进行热点行程与地理反查的缓存，加速多用户请求。
- 提供 Docker 镜像与 GitHub Actions 流水线，方便本地开发、预发与生产部署。

## 技术栈与架构

- **前端 / BFF**：Next.js 14 App Router（Server Components + Route Handlers）充当 BFF，聚合外部服务并暴露 tRPC 与 REST API。
- **身份与数据存储**：Supabase（Auth + Postgres + Edge Functions）用于用户认证、行程计划表与历史记录存储。
- **大模型**：可切换 Qwen（阿里云百炼 DashScope）与 OpenAI，依据 `AI_PROVIDER` 动态调用。
- **地图与地理编码**：Amap（高德地图）REST 与 JS SDK，提供地点建议、静态地图渲染与坐标置信度。
- **语音识别**：科大讯飞 iFLYTEK ASR，将语音输入转换为文本。
- **缓存层**：Redis（通过 ioredis）缓存地理反查、LLM 中间结果与计划快照。
- **API 编排**：tRPC 提供前后端类型安全调用；Next.js API Route 处理 Webhook / REST 访问信道。
- **算法与服务**：服务层（`src/services/*`）封装计划、行程、费用等业务逻辑；适配器层连接外部 API（LLM、地图、ASR）。
- **基础设施**：多阶段 Dockerfile 构建，GitHub Actions (`.github/workflows/docker-build-and-push.yml`) 负责多架构镜像推送。

**文字架构图**：
终端用户浏览器 → Next.js BFF（App Router / tRPC / API Routes）→ { Supabase Auth & Postgres | Redis | Amap REST | Qwen/OpenAI LLM | iFLYTEK ASR } → 返回规划结果 → 前端展示并可保存至云端 → Docker 部署提供统一运行时。

## 本地运行

1. 安装依赖（默认使用 `pnpm`）：

	 ```bash
	 pnpm install
	 ```

2. 复制环境变量示例并按需修改：

	 ```bash
	 copy .env.example .env.local
	 ```

	 关键配置（详见 `.env.example`）：

	 - `NEXT_PUBLIC_APP_NAME`: 前端展示名称。
	 - `NEXT_PUBLIC_AMAP_WEB_KEY` / `AMAP_REST_KEY`: 高德地图 Web 与 REST Key。
	 - `AI_PROVIDER`: `qwen` 或 `openai`；
		 - Qwen：设置 `ALIYUN_DASHSCOPE_API_KEY`（阿里云百炼 DashScope Key）。
		 - OpenAI：设置 `OPENAI_API_KEY` 及可选 `OPENAI_BASE_URL`。
	 - `IFLYTEK_APP_ID` / `IFLYTEK_API_KEY` / `IFLYTEK_API_SECRET`: 讯飞语音识别凭证。
	 - `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`: Supabase 项目配置。
	 - `REDIS_URL`: Redis 连接串（如 `redis://default:password@redis:6379`）。
	 - 其他：`LOGTAIL_SOURCE_TOKEN`、`NEXT_TELEMETRY_DISABLED=1` 等。

3. 初始化数据库（可选）：

	 ```powershell
	 pwsh ./scripts/applySchema.ps1
	 ```

4. 启动本地开发服务器：

	 ```bash
	 pnpm dev
	 ```

- 生产构建：`pnpm build`
- 启动生产服务：`pnpm start`
- 类型与 ESLint 检查：`pnpm lint`

## Docker 部署

- **本地构建镜像**：

	```bash
	docker build -t ghcr.io/username/repo:latest .
	```

- **远程拉取镜像**：

	```bash
	docker pull ghcr.io/username/repo:latest
	```

- **运行容器**（确保 `.env.local` 或自定义 env 文件包含 Supabase、Redis、阿里云百炼等密钥）：

	```bash
	docker run -p 3000:3000 --env-file .env.local ghcr.io/username/repo:latest
	```

	生产环境推荐通过编排系统（Kubernetes / ECS 等）传递 `ALIYUN_DASHSCOPE_API_KEY`、`SUPABASE_*`、`REDIS_URL` 等凭证，避免写死在镜像内。

## CI / CD 配置

- GitHub Actions 工作流：`.github/workflows/docker-build-and-push.yml`。
	- 触发条件：推送到 `main` 或手动 `workflow_dispatch`。
	- 构建多架构镜像（`linux/amd64`, `linux/arm64`）。
	- 根据是否配置 `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` 决定推送到 Docker Hub 或 GHCR。
	- 使用 `docker/metadata-action` 自动生成 `latest`、分支、commit SHA 等标签。

## API 说明

- 完整接口契约、字段说明与交互流程详见 [`docs/PRD.md`](docs/PRD.md)。

## 安全注意事项

- 不要将任何 Supabase、LLM、ASR、Redis 等密钥提交到仓库或硬编码在前端代码中。
- 使用 `.env.local`、部署平台密钥管理或密文管理（如 GitHub Secrets、Vault）。
- 为 `SUPABASE_SERVICE_ROLE_KEY` 等高权限变量设置最小访问范围，并仅在受信任服务侧使用。
- 定期轮换 `ALIYUN_DASHSCOPE_API_KEY` 与其他第三方凭证，监控授权使用情况。

## 常见问题（FAQ）

- **ASR 调用失败**
	- 检查 `IFLYTEK_*` 凭证是否正确，是否具有语音听写权限。
	- 确认网络出口可访问讯飞 API，必要时开启代理或配置专线。
	- 查看服务日志（`pnpm dev` 控制台或 Docker 容器日志）获取具体错误码。

- **LLM 响应为空或报错**
	- 确认 `AI_PROVIDER` 与对应 key（`ALIYUN_DASHSCOPE_API_KEY` 或 `OPENAI_API_KEY`）已配置且额度充足。
	- 若使用自定义网关（`OPENAI_BASE_URL`），确保路由正确、证书可信。
	- 在 `tmp/llmSmoke.ts` 中有示例脚本，可通过 `pnpm tsx tmp/llmSmoke.ts` 验证连接。

## Docker 镜像命令速查

```bash
docker pull ghcr.io/username/repo:latest
docker run -p 3000:3000 --env-file .env.local ghcr.io/username/repo:latest
```

运行容器前务必提供阿里云百炼 `ALIYUN_DASHSCOPE_API_KEY`（或其他 LLM/OAuth 密钥）等环境变量，避免在镜像内写死敏感信息。