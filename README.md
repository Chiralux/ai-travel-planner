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

## 目录结构

```
app/            # Next.js App Router 入口
styles/         # 全局样式（Tailwind 指令）
lib/store/      # Zustand 示例 Store
```

完成上述安装后即可访问欢迎页，并根据项目需求继续集成 tRPC API、Redis 缓存、高德地图、Logtail 等能力。