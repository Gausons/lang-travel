# Travel Planner Agent (TypeScript)

一个本地可运行的游玩规划 Agent，支持：

1. 周边景点/公园录入
2. “散步”场景下查找附近小公园
3. “陌生地点”场景下自动规划可行路线

## 技术栈

- Node.js 18+
- TypeScript
- `tsx` 直接运行 TS
- 移动端：Expo SDK 55 + React Native 0.83 + TypeScript（本机移动端调试建议 Node.js 20.19+）

## 项目结构

- `src/types.ts`: 领域类型定义
- `src/store.ts`: 点位数据读写与初始化
- `src/planner.ts`: 规划核心逻辑（附近公园、路线、chat 意图）
- `src/multi-agent.ts`: 多 Agent 编排（行程研究、酒店多源比价、预算优化）
- `src/cli.ts`: 命令行参数解析和命令分发
- `src/agent.ts`: 入口文件（错误处理 + 启动 CLI）
- `src/index.ts`: 复用导出（便于后续接 API）
- `web/`: 现有 Web 可视化页面
- `apps/mobile/`: Expo / React Native iOS + Android 客户端

## 安装依赖

```bash
pnpm install
```

## 快速开始

```bash
pnpm dev list
```

## 录入点位

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

## 查找附近小公园（散步）

```bash
pnpm dev parks --lat 31.2304 --lon 121.4737 --radius-km 8
```

## 陌生地点自动规划路线

```bash
pnpm dev route \
  --lat 31.2304 \
  --lon 121.4737 \
  --city 上海 \
  --hours 4 \
  --prefer mixed
```

## 对话方式调用

```bash
pnpm dev chat \
  --message "我想去散个步，找个附近公园" \
  --lat 31.2304 \
  --lon 121.4737 \
  --city 上海 \
  --radius-km 5
```

```bash
pnpm dev chat \
  --message "我第一次来这边，帮我规划一个路线" \
  --lat 31.2304 \
  --lon 121.4737 \
  --city 上海 \
  --hours 5
```

## 构建与运行

```bash
pnpm build
pnpm start -- list
```

## 可视化页面

启动 Web 服务：

```bash
export AMAP_KEY=你的高德Web服务Key
export AMAP_JS_KEY=你的高德JSAPI Key
pnpm dev:web
```

或写入项目根目录 `.env`（服务会自动加载）：

```bash
MAP_PROVIDER=amap(可选：amap/google，默认amap)
AMAP_KEY=你的高德Web服务Key(用于后端地图Provider，如逆地理编码/路线/POI)
AMAP_JS_KEY=你的高德JSAPI Key(用于前端地图渲染)
AMAP_SECURITY_JS_CODE=你的安全密钥(可选)
GOOGLE_MAPS_API_KEY=你的Google Maps Platform API Key(MAP_PROVIDER=google时使用)
OPENAI_API_KEY=你的OpenAI API Key(可选，用于AI全局优化决策)
OPENAI_MODEL=gpt-4.1-mini(可选)
LOG_LEVEL=info(debug/info/warn/error)
```

打开：`http://localhost:3000`

页面支持：

- 录入景点/公园
- 查询附近散步公园
- 生成陌生地点路线规划
- Agent 一键自主规划（行程 + 酒店筛选比价）
- 对话式调用 Agent
- 查看当前城市已录入点位

## 地图服务 Provider 接入说明

- 后端地图数据服务已抽象为可插拔 Provider（`src/map-provider.ts`）
- 使用 `MAP_PROVIDER=amap` 时，需要高德开放平台 Web 服务 Key（环境变量：`AMAP_KEY`）
- 使用 `MAP_PROVIDER=google` 时，需要 Google Maps Platform API Key（环境变量：`GOOGLE_MAPS_API_KEY`）
- Web 地图展示当前仍使用高德 JS API，需要 JS API Key（环境变量：`AMAP_JS_KEY`，未设置时回退用 `AMAP_KEY`）
- 如启用了高德安全密钥，可配置：`AMAP_SECURITY_JS_CODE`
- 已接入能力：
  - `/api/parks`：优先调用当前地图 Provider 周边公园检索，失败自动回退本地数据
- `/api/route`：对本地规划结果的交通段，按当前地图 Provider 步行路线时长做校准
- `/api/agent/plan`：多 Agent 自主规划（多源酒店比价 + 最经济方案）
  - 若配置 `OPENAI_API_KEY`：由 AI 基于用户习惯/预算/候选信息做全局优化
  - 若 AI 调用失败：自动回退贪心结果（稳定兜底）
  - `/api/health`：返回 `mapProvider`、`mapProviderEnabled` 字段，方便检查当前 Provider 是否生效

示例：

```bash
export MAP_PROVIDER=amap
export AMAP_KEY=你的key
curl "http://127.0.0.1:3000/api/health"
curl "http://127.0.0.1:3000/api/parks?lat=31.2304&lon=121.4737&city=%E4%B8%8A%E6%B5%B7&radiusKm=5"
```

切换 Google Maps：

```bash
export MAP_PROVIDER=google
export GOOGLE_MAPS_API_KEY=你的Google Maps Platform API Key
pnpm dev:web
```

新增 Provider 时，实现 `MapProvider` 接口并通过 `registerMapProvider(name, factory)` 或在 `src/map-providers.ts` 注册即可。业务层只依赖统一的 `searchNearbySpots`、`searchNearbyParks`、`searchNearbyHotels`、`walkingRoute`、`reverseGeocode` 能力。

## 数据文件

- 点位持久化在 `data/places.json`
- 默认不再预置写死景点；页面会优先按当前位置从高德拉取实时点位

## React Native 多端客户端

移动端工程位于 `apps/mobile`，使用现有 Node Web 服务作为远端代理。服务端继续保存 `AMAP_KEY`、`OPENAI_API_KEY` 等敏感密钥；移动端只配置 API 地址和高德 iOS/Android 地图展示 Key。

先启动代理服务：

```bash
export AMAP_KEY=你的高德Web服务Key
export OPENAI_API_KEY=你的OpenAI API Key # 可选
pnpm dev:web
```

移动端环境变量写入 `apps/mobile/.env.local`：

```bash
# iOS 模拟器访问本机服务
EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3000

# Android 模拟器访问本机服务时改为：
# EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:3000

# 真机调试时改为 Mac 的局域网 IP，例如：
# EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:3000

# 高德移动端地图 Key，通过 Expo config plugin 写入原生配置
AMAP_IOS_KEY=你的高德iOS移动端Key
AMAP_ANDROID_KEY=你的高德Android移动端Key
```

本机运行：

```bash
pnpm mobile:start
pnpm mobile:ios
pnpm mobile:android
```

`pnpm mobile:ios` / `pnpm mobile:android` 会使用 Expo Prebuild 生成本地原生工程；`ios/` 和 `android/` 已按生成物处理并加入忽略列表。

移动端首版支持：

- 定位并用 `/api/regeo` 回填城市
- 地图展示当前位置、点位、公园和路线折线
- 查询 `/api/places`、`/api/parks`
- 调用 `/api/route` 生成路线
- 调用 `/api/agent/plan` 生成 Agent 自主规划和酒店比价

移动端安全配置接口：

```bash
curl "http://127.0.0.1:3000/api/mobile/config"
```

该接口只返回 `apiVersion`、`amapEnabled`、`amapServiceConfigured`、`aiPlanningEnabled` 等非敏感开关，不返回高德 Web 服务 Key、OpenAI Key 或安全密钥。
