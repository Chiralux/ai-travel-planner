# AI Travel Planner

面向个人与小团队的智能行程规划应用。系统结合语音识别、LLM 行程生成、国内外地图服务与云端同步能力，为用户提供从需求采集到行程落地的完整体验。

## 在线体验与演示

> ℹ️ 若已上线生产环境，可将以下示例替换为真实信息。

- 生产站点（示例）：<https://travel.example.com>
- 体验账号：`demo@example.com` / `Demo@1234`
- 预览视频：<https://youtu.be/demo-travel-planner>
- 截图资源：`docs/screenshots/`

## 核心功能

- **多模态旅行输入**：支持语音（iFLYTEK ASR）与文本两种形式采集需求，自动提取目的地、预算、偏好等关键信息。
- **AI 行程生成与润色**：基于 Qwen 或 OpenAI 生成多日行程草案，补全活动描述、时间安排与预算拆分。
- **智能地理定位**：联合高德、Google、百度多方定位，自动填充地理坐标并在置信度不足时提示“位置信息由AI辅助推断，请注意核实。”。
- **地图与导航体验**：主地图与浮动小地图联动展示活动与路线，支持街景、静态图快照与路线聚焦切换。
- **媒体与参考信息**：按优先级顺序懒加载活动照片、附近地标与参考地址，平衡体验与 API 配额。
- **云端行程管理**：借助 Supabase Postgres 与 Auth 保存、复制、删除行程，支持多端同步。
- **预算与费用概览**：自动归类住宿、交通、餐饮、活动等预算，提供日均花费参考。
- **离线草稿缓存**：未登录用户可临时保存行程草稿并稍后继续填写。
- **日志与可观测性**：整合 Redis 缓存与 Logtail 日志，追踪关键请求。

## 架构与技术栈

- **前端 / BFF**：Next.js 14 App Router（Server Components + Route Handlers）+ tRPC，统一处理鉴权、缓存与类型安全 API。
- **状态管理**：Zustand 协调地图焦点、媒体加载队列与 Planner UI 状态。
- **LLM 层**：按 `AI_PROVIDER` 在 Qwen（DashScope）与 OpenAI 间切换，提供目的地国际化判定与提示词管理。
- **地图服务**：高德 REST/JS、Google Maps Places & Directions、百度地图 REST。
- **语音服务**：科大讯飞实时语音识别。
- **数据与缓存**：Supabase（Auth + Postgres + Edge Functions）、Redis（热点行程与地理反查缓存）。
- **可观测性**：Logtail 收集服务日志，辅助脚本位于 `tmp/`。
- **基础设施**：多阶段 Dockerfile、GitHub Actions 构建并推送多架构镜像。

### 架构流程概览

终端用户 → Next.js BFF（App Router / tRPC / API Routes）→ { Supabase | Redis | 地图服务 | LLM | ASR } → 行程与媒体结果 → 前端地图与时间轴渲染。

## 目录说明

- `src/app`：Next.js 页面、API Route、前端 Provider。
- `src/services`：行程、费用、地图、媒体等业务逻辑。
- `src/adapters`：外部服务适配层（LLM、地图、ASR）。
- `ui/components`：页面级组件与地图视图。
- `db`：数据库 schema 与初始化脚本。
- `tmp`：调试脚本（LLM、地图、tRPC 冒烟测试等）。
- `scripts`：数据库初始化、测试账号、批量脚本。
- `docs`：PRD、体验说明与素材。

## 快速开始

1. **安装依赖**
	```bash
	pnpm install
	```
2. **复制并配置环境变量**
	```bash
	copy .env.example .env.local
	```
	关键变量（详见 `.env.example`）：
	- `NEXT_PUBLIC_AMAP_WEB_KEY` / `AMAP_REST_KEY`：高德 Web 与 REST Key。
	- `GOOGLE_MAPS_API_KEY` / `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`：Google Maps client/server key。
	- `AI_PROVIDER`：`qwen` 或 `openai`；分别配置 `ALIYUN_DASHSCOPE_API_KEY` 或 `OPENAI_API_KEY`。
	- `IFLYTEK_*`：讯飞 ASR 凭证。
	- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`：Supabase 项目密钥。
	- `REDIS_URL`：Redis 连接串。
	- `LOGTAIL_SOURCE_TOKEN`：日志来源 Token。
3. **初始化数据库（可选）**
	```powershell
	pwsh ./scripts/applySchema.ps1
	```
4. **启动开发服务器**
	```bash
	pnpm dev
	```

### 常用脚本

- 构建生产包：`pnpm build`
- 启动生产模式：`pnpm start`
- 代码质量检查：`pnpm lint`
- 单元测试（Vitest）：`pnpm test`
- tRPC 冒烟测试：`pnpm tsx tmp/trpcSmoke.ts`
- 地图接口冒烟测试：`pnpm tsx tmp/mapsSmoke.ts`
- LLM 通路验证：`pnpm tsx tmp/llmSmoke.ts`

## 环境变量清单

| 变量 | 说明 |
| --- | --- |
| `NEXT_PUBLIC_APP_NAME` | 前端展示的应用名称 |
| `NEXT_PUBLIC_AMAP_WEB_KEY` / `AMAP_REST_KEY` | 高德地图 Web / REST Key |
| `NEXT_PUBLIC_AMAP_SECURITY_JS_CODE` | 高德 JS 安全校验码（需开启安全域名时配置） |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` / `GOOGLE_MAPS_API_KEY` | Google Maps client/server Key |
| `GOOGLE_MAPS_PROXY_URL` | 访问 Google API 时的代理地址（可选） |
| `BAIDU_MAP_AK` | 百度地图开放平台 AK |
| `MAPS_PROVIDER` | 地图服务偏好，控制默认加载逻辑 |
| `AI_PROVIDER` | `qwen` / `openai`，切换大模型供应商 |
| `ALIYUN_DASHSCOPE_API_KEY` / `OPENAI_API_KEY` | DashScope 或 OpenAI 凭证 |
| `IFLYTEK_APP_ID` / `IFLYTEK_API_KEY` / `IFLYTEK_API_SECRET` | 讯飞 ASR 凭证 |
| `IFLYTEK_HOST` / `IFLYTEK_PATH` / `IFLYTEK_DOMAIN` | 讯飞接口参数（可选） |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase 项目密钥 |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 前端 Supabase 凭证 |
| `REDIS_URL` | Redis 连接串，用于缓存 |
| `LOGTAIL_SOURCE_TOKEN` | Logtail 日志来源 Token |
| `NEXT_TELEMETRY_DISABLED` | 设为 `1` 以禁用 Next.js 遥测 |

## Docker 部署

1. 构建镜像
	```bash
	pnpm docker-build
	# 或 docker build -t ghcr.io/chiralux/ai-travel-planner:latest .
	```
2. 运行容器
	```bash
	docker run -p 3000:3000 --env-file .env.local ghcr.io/chiralux/ai-travel-planner:latest
	```
3. 拉取远程镜像
	```bash
	docker pull ghcr.io/chiralux/ai-travel-planner:latest
	```

生产环境推荐使用编排系统（Kubernetes / ECS 等）管理敏感凭证，避免写死在镜像中。

## CI / CD

- GitHub Actions：`.github/workflows/docker-build-and-push.yml`
  - 触发：推送到 `main` 或手动 `workflow_dispatch`。
  - 构建 `linux/amd64` 与 `linux/arm64` 多架构镜像。
  - 如果配置 `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN`，可额外推送到 Docker Hub。
  - 使用 `docker/metadata-action` 自动生成 `latest`、分支、commit SHA 等标签。
- 可选扩展：结合 Supabase Edge Functions、Logtail 或自建 Prometheus / Grafana 做监控。

## API 说明

- 完整接口契约与业务流程详见 [`docs/PRD.md`](docs/PRD.md)。
- 行程、地理定位、媒体等核心接口位于 `src/app/api/*`，可通过 `pnpm lint`、`pnpm test` 或临时脚本进行验证。

## 安全与合规

- 不要将任何 Supabase、LLM、ASR、Redis 等密钥提交到仓库或硬编码到前端。
- 优先使用 `.env.local`、部署平台密钥管理或密文存储（GitHub Secrets、Vault 等）。
- 为 `SUPABASE_SERVICE_ROLE_KEY` 等高权限凭证设置最小访问范围，仅在受信任的服务端使用。
- 定期轮换 `ALIYUN_DASHSCOPE_API_KEY`、`OPENAI_API_KEY` 等外部密钥，监控调用情况。
- 地图与媒体请求采用限速队列，避免触发外部 API 限流。
- 当 AI 无法精准定位活动地点时，行程卡片会提示“位置信息由AI辅助推断，请注意核实。”，提醒用户自行确认。

## 常见问题

- **ASR 调用失败**
  - 检查 `IFLYTEK_*` 凭证及语音听写权限。
  - 确认出口网络可访问讯飞 API，必要时配置代理。
  - 查看终端或容器日志获取错误码。

- **LLM 响应为空或异常**
  - 确认 `AI_PROVIDER` 与对应 Key 是否配置且额度充足。
  - 若使用自定义网关（例如 `OPENAI_BASE_URL`），确保路由与证书配置正确。
  - 使用 `pnpm tsx tmp/llmSmoke.ts` 验证连接性。

- **地图或媒体无法加载**
  - 检查地图 Key 是否启用对应 API 权限，或是否触发配额限制。
  - 查看临时脚本 `tmp/mapsSmoke.ts` / `tmp/asrRouteTest.ts` 输出。
  - 确认 `REDIS_URL` 配置避免缓存失效导致重复请求。

## 许可

项目遵循仓库根目录中的 [LICENSE](LICENSE) 文件所述条款。