# Travel Planner Agent (TypeScript)

一个本地可运行的游玩规划 Agent，支持：

1. 周边景点/公园录入
2. “散步”场景下查找附近小公园
3. “陌生地点”场景下自动规划可行路线

## 技术栈

- Node.js 18+
- TypeScript
- `tsx` 直接运行 TS

## 项目结构

- `src/types.ts`: 领域类型定义
- `src/store.ts`: 点位数据读写与初始化
- `src/planner.ts`: 规划核心逻辑（附近公园、路线、chat 意图）
- `src/cli.ts`: 命令行参数解析和命令分发
- `src/agent.ts`: 入口文件（错误处理 + 启动 CLI）
- `src/index.ts`: 复用导出（便于后续接 API）

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
AMAP_KEY=你的高德Web服务Key
AMAP_JS_KEY=你的高德JSAPI Key
AMAP_SECURITY_JS_CODE=你的安全密钥(可选)
```

打开：`http://localhost:3000`

页面支持：

- 录入景点/公园
- 查询附近散步公园
- 生成陌生地点路线规划
- 对话式调用 Agent
- 查看当前城市已录入点位

## 高德地图接入说明

- 需要高德开放平台 Web 服务 Key（环境变量：`AMAP_KEY`）
- 地图展示需要 JS API Key（环境变量：`AMAP_JS_KEY`，未设置时回退用 `AMAP_KEY`）
- 如启用了高德安全密钥，可配置：`AMAP_SECURITY_JS_CODE`
- 已接入能力：
  - `/api/parks`：优先调用高德周边公园检索，失败自动回退本地数据
  - `/api/route`：对本地规划结果的交通段，按高德步行路线时长做校准
  - `/api/health`：返回 `amapEnabled` 字段，方便检查是否生效

示例：

```bash
export AMAP_KEY=你的key
curl "http://127.0.0.1:3000/api/health"
curl "http://127.0.0.1:3000/api/parks?lat=31.2304&lon=121.4737&city=%E4%B8%8A%E6%B5%B7&radiusKm=5"
```

## 数据文件

- 点位持久化在 `data/places.json`
- 首次运行会自动写入少量示例点位
