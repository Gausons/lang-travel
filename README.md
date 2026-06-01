# Lang Travel

一个本地运行的旅行规划 Agent，用 TypeScript 构建。它可以录入和查询点位、查找附近公园、生成步行路线、调用地图服务拉取实时 POI，并通过 AI 做路线优化、偏好访谈和多 Agent 行程规划。

## 功能概览

- CLI：录入点位、查看本地点位、查找附近公园、生成路线、简单对话调用。
- Web UI：地图可视化、当前位置回填城市、点位录入、公园检索、路线规划、一键 Agent 规划。
- 地图 Provider：支持高德和 Google Maps，缺少或调用失败时保留本地数据兜底。
- AI 能力：AI 路线排序、偏好聊天、旅行记忆更新、多 Agent 行程/酒店/预算编排。
- 移动端：Expo / React Native 客户端，通过本地 Web 服务访问后端能力，避免暴露敏感密钥。
- 长期记忆：按 tenant/user 保存旅行偏好、预算、节奏、雷点和历史规划事件。

## 技术栈

- Node.js 18+
- TypeScript + ESM
- `tsx` 开发运行
- 静态 Web：`web/`
- 移动端：Expo SDK 55 + React Native 0.83 + TypeScript
- 包管理器：`pnpm`

移动端本机调试建议使用 Node.js 20.19+。

## 快速开始

```bash
pnpm install
pnpm dev list
```

启动 Web 服务：

```bash
pnpm dev:web
```

默认访问：

```text
http://localhost:3000
```

构建后运行：

```bash
pnpm build
pnpm start -- list
pnpm start:web
```

## 项目结构

- `src/agent.ts`：CLI 入口错误处理。
- `src/cli.ts`：命令行参数解析和命令分发。
- `src/server.ts`：HTTP API 和静态 Web 服务。
- `src/types.ts`：共享领域类型。
- `src/store.ts`：本地点位存储。
- `src/planner.ts`：核心规划逻辑和基础 chat 意图。
- `src/map-provider.ts`：地图 Provider 接口和通用类型。
- `src/map-providers.ts`：地图 Provider 注册和选择。
- `src/amap.ts`、`src/google-maps.ts`：高德和 Google Maps 实现。
- `src/ai-route-planner.ts`：AI 辅助路线排序。
- `src/preference-chat.ts`：AI 偏好访谈和偏好提取。
- `src/memory-store.ts`、`src/memory-service.ts`：长期记忆读写和事件记录。
- `src/multi-agent.ts`：多 Agent 行程、酒店和预算编排。
- `web/`：浏览器 UI。
- `apps/mobile/`：Expo / React Native 客户端。
- `data/places.json`：本地点位数据。
- `data/tenants/`：按租户和用户保存的旅行记忆。

## 环境变量

项目根目录的 `.env` 会在启动 `src/server.ts` 时自动加载。可以从 `.env.example` 复制一份本地配置：

```bash
cp .env.example .env
```

常用变量：

```dotenv
MAP_PROVIDER=amap
AMAP_KEY=你的高德Web服务Key
AMAP_JS_KEY=你的高德JSAPI Key
AMAP_SECURITY_JS_CODE=
GOOGLE_MAPS_API_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
OPENAI_BASE_URL=https://api.openai.com
MEMORY_MAX_LINES=300
LOG_LEVEL=info
PORT=3000
```

说明：

- `MAP_PROVIDER` 可选 `amap` 或 `google`，默认使用高德。
- `AMAP_KEY` 用于后端高德 Web 服务能力，例如 POI、逆地理编码和步行路线。
- `AMAP_JS_KEY` 用于 Web 页面中的高德 JS 地图渲染；未配置时会尝试回退到 `AMAP_KEY`。
- `GOOGLE_MAPS_API_KEY` 在 `MAP_PROVIDER=google` 时使用。
- `OPENAI_API_KEY` 配置后启用 AI 路线优化、多 Agent 全局优化和偏好聊天。
- `OPENAI_BASE_URL` 支持 OpenAI 兼容接口，会自动补全到 `/v1/chat/completions`。
- 不要把真实密钥提交到仓库。

## CLI 用法

查看本地点位：

```bash
pnpm dev list
pnpm dev list --city 上海
```

录入点位：

```bash
pnpm dev add \
  --name "滨江森林公园" \
  --category park \
  --lat 31.3812 \
  --lon 121.5597 \
  --city 上海 \
  --tags 散步,绿地 \
  --avg-visit-min 80 \
  --score 4.6
```

查找附近公园：

```bash
pnpm dev parks --lat 31.2304 --lon 121.4737 --radius-km 8
```

规划路线：

```bash
pnpm dev route \
  --lat 31.2304 \
  --lon 121.4737 \
  --city 上海 \
  --hours 4 \
  --prefer mixed
```

对话方式调用基础 Agent：

```bash
pnpm dev chat \
  --message "我想去散个步，找个附近公园" \
  --lat 31.2304 \
  --lon 121.4737 \
  --city 上海 \
  --radius-km 5
```

## Web 与 API

启动：

```bash
pnpm dev:web
```

Web 页面支持：

- 读取当前位置并通过 `/api/regeo` 回填城市。
- 查询 `/api/places`、`/api/parks` 并在地图上展示。
- 通过 `/api/route` 生成路线和步行折线。
- 通过 `/api/preference-chat` 访谈旅行偏好并写入长期记忆。
- 通过 `/api/agent/plan` 生成多天行程、酒店候选和预算方案。
- 读取 `/api/memory` 展示当前用户偏好记忆。

主要接口：

- `GET /api/health`：服务健康状态和当前地图 Provider。
- `GET /api/client-config`：前端地图渲染所需的非服务端配置。
- `GET /api/mobile/config`：移动端非敏感能力开关。
- `GET /api/regeo?lat=...&lon=...`：逆地理编码。
- `GET /api/places?lat=...&lon=...&city=...&radiusKm=...`：点位列表，优先实时地图数据。
- `POST /api/places`：录入本地点位。
- `GET /api/parks?lat=...&lon=...&city=...&radiusKm=...`：附近公园。
- `GET /api/route?lat=...&lon=...&city=...&hours=4&prefer=mixed`：路线规划。
- `POST /api/chat`：基础 chat 意图调用。
- `POST /api/preference-chat`：AI 偏好访谈并更新记忆。
- `GET /api/memory`：读取当前 tenant/user 的记忆。
- `GET /api/memory/events`：读取记忆事件。
- `POST /api/memory/patch`：手动写入偏好补丁。
- `POST /api/agent/plan`：多 Agent 自主规划。

示例：

```bash
curl "http://127.0.0.1:3000/api/health"
curl "http://127.0.0.1:3000/api/parks?lat=31.2304&lon=121.4737&city=%E4%B8%8A%E6%B5%B7&radiusKm=5"
```

## 地图 Provider

后端地图服务通过 `MapProvider` 抽象接入，业务层依赖统一能力：

- `searchNearbySpots`
- `searchNearbyParks`
- `searchNearbyHotels`
- `walkingRoute`
- `reverseGeocode`

使用高德：

```bash
MAP_PROVIDER=amap
AMAP_KEY=你的高德Web服务Key
AMAP_JS_KEY=你的高德JS API Key
pnpm dev:web
```

使用 Google Maps：

```bash
MAP_PROVIDER=google
GOOGLE_MAPS_API_KEY=你的 Google Maps Platform API Key
pnpm dev:web
```

新增 Provider 时，实现 `MapProvider` 接口，并在 `src/map-providers.ts` 中注册即可。

## AI 与偏好记忆

配置 `OPENAI_API_KEY` 后会启用以下能力：

- `/api/route`：基于候选点位和用户记忆做 AI 路线重排。
- `/api/preference-chat`：从自然语言里提取兴趣、习惯、预算、节奏、偏好类型和雷点。
- `/api/agent/plan`：在行程、酒店和预算候选之间做全局优化。

记忆数据按 tenant/user 保存：

```text
data/tenants/<tenantId>/users/<userId>/memory.md
data/tenants/<tenantId>/users/<userId>/memory-events.md
```

接口会从 header、query 或 body 读取上下文：

```text
x-tenant-id
x-user-id
x-session-id
```

未传时默认使用 `default` / `local-user`。`MEMORY_MAX_LINES` 控制记忆文件保留行数，当前硬上限为 300。

## 移动端

移动端位于 `apps/mobile`，通过本地 Web 服务访问后端能力。服务端继续保存高德 Web 服务 Key、OpenAI Key 等敏感密钥；移动端只放 API 地址和原生地图展示 Key。

先启动服务：

```bash
pnpm dev:web
```

在 `apps/mobile/.env.local` 写入：

```dotenv
# iOS 模拟器访问本机服务
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3000

# Android 模拟器访问本机服务时改为：
# EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:3000

# 真机调试时改为 Mac 的局域网 IP，例如：
# EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:3000

AMAP_IOS_KEY=你的高德iOS移动端Key
AMAP_ANDROID_KEY=你的高德Android移动端Key
```

运行：

```bash
pnpm mobile:start
pnpm mobile:ios
pnpm mobile:android
pnpm mobile:typecheck
```

`pnpm mobile:ios` 和 `pnpm mobile:android` 会触发 Expo 原生工程生成；`ios/`、`android/`、`.expo/` 和本地 env 文件都按本地生成物处理。

## 数据与安全

- `data/places.json` 是本地点位数据，除非明确需要，不要随意覆盖。
- `data/tenants/` 是用户偏好和规划事件记忆。
- 根目录 `.env` 和 `apps/mobile/.env.local` 都应保持本地私有。
- 移动端配置接口只返回非敏感开关，不返回后端服务 Key。

## 常用验证

修改根目录 TypeScript 后：

```bash
pnpm build
```

修改移动端后：

```bash
pnpm mobile:typecheck
```

目前没有独立单元测试脚本；改动 CLI、API、Web 或移动端流程时，优先做对应的手动检查。
