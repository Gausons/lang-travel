import fs from 'node:fs';
import path from 'node:path';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { AmapClient } from './amap.js';
import { planRouteWithAi } from './ai-route-planner.js';
import { log } from './logger.js';
import { MultiAgentOrchestrator } from './multi-agent.js';
import { TravelPlannerAgent } from './planner.js';
import type { Category, Place, Prefer, RouteResult, RouteStop } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const WEB_DIR = path.join(__dirname, '..', 'web');
const PORT = Number(process.env.PORT ?? 3000);

function loadDotEnv(): void {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const idx = line.indexOf('=');
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const AMAP_JS_KEY = process.env.AMAP_JS_KEY ?? process.env.AMAP_KEY ?? '';
const AMAP_SECURITY_JS_CODE = process.env.AMAP_SECURITY_JS_CODE ?? '';
const AMAP_SERVICE_KEY = process.env.AMAP_KEY ?? '';

const agent = new TravelPlannerAgent();
const amap = new AmapClient(AMAP_SERVICE_KEY);
const orchestrator = new MultiAgentOrchestrator({ amap, planner: agent });

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function sendJson(res: ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendText(res: ServerResponse, code: number, text: string): void {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function toNum(value: string | null, key: string): number {
  if (value === null || value === '') {
    throw new Error(`缺少参数: ${key}`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`参数 ${key} 不是有效数字`);
  }
  return n;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function serveStatic(reqPath: string, res: ServerResponse): void {
  const safePath = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
  const filePath = path.resolve(WEB_DIR, safePath);
  if (!filePath.startsWith(path.resolve(WEB_DIR))) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, 'Not Found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': contentType });
  fs.createReadStream(filePath).pipe(res);
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

function planRouteFromCandidates(
  startLat: number,
  startLon: number,
  hours: number,
  candidates: Place[],
): RouteResult {
  const budgetMin = Math.floor(hours * 60);
  const remaining = [...candidates];
  const route: RouteStop[] = [];
  let current: [number, number] = [startLat, startLon];
  let usedMin = 0;

  const walkSpeedKmh = 4.5;

  while (remaining.length > 0 && usedMin < budgetMin) {
    const scored: Array<{ utility: number; place: Place; dist: number }> = [];
    for (const p of remaining) {
      const dist = haversineKm(current[0], current[1], p.lat, p.lon);
      const travelMin = Math.max(1, Math.floor((dist / walkSpeedKmh) * 60));
      const totalNeed = travelMin + p.avg_visit_min;
      if (usedMin + totalNeed <= budgetMin) {
        const utility = p.score * 20 - dist * 3 - p.avg_visit_min / 30;
        scored.push({ utility, place: p, dist });
      }
    }
    if (scored.length === 0) {
      break;
    }
    scored.sort((a, b) => b.utility - a.utility);
    const chosen = scored[0];
    const travelMin = Math.max(1, Math.floor((chosen.dist / walkSpeedKmh) * 60));
    usedMin += travelMin + chosen.place.avg_visit_min;
    route.push({
      name: chosen.place.name,
      category: chosen.place.category,
      lat: chosen.place.lat,
      lon: chosen.place.lon,
      distance_km: Number(chosen.dist.toFixed(2)),
      travel_mode: 'walk',
      travel_min: travelMin,
      visit_min: chosen.place.avg_visit_min,
      tags: chosen.place.tags,
    });
    current = [chosen.place.lat, chosen.place.lon];
    const idx = remaining.findIndex((p) => p.id === chosen.place.id);
    if (idx >= 0) {
      remaining.splice(idx, 1);
    }
  }

  return {
    summary: `在 ${hours.toFixed(1)} 小时内，为你规划了 ${route.length} 个点位。`,
    stops: route,
    total_minutes: usedMin,
  };
}

function pickLocalRouteCandidates(agentRef: TravelPlannerAgent, city: string, prefer: Prefer): Place[] {
  let candidates = agentRef.store.listPlaces(city);
  if (prefer === 'park') {
    candidates = candidates.filter((p) => p.category === 'park');
  } else if (prefer === 'attraction') {
    candidates = candidates.filter((p) => p.category === 'attraction');
  }
  return candidates;
}

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID().slice(0, 8);
  const requestMeta = {
    requestId,
    method: req.method || '',
    url: req.url || '',
  };
  log('info', 'request.start', requestMeta);

  try {
    if (!req.url || !req.method) {
      sendText(res, 400, 'Bad Request');
      log('warn', 'request.invalid', requestMeta);
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const { pathname, searchParams } = url;

    if (pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        now: new Date().toISOString(),
        amapEnabled: amap.enabled,
      });
      return;
    }

    if (pathname === '/api/client-config') {
      sendJson(res, 200, {
        amapJsKey: AMAP_JS_KEY,
        amapSecurityJsCode: AMAP_SECURITY_JS_CODE,
        amapEnabled: amap.enabled,
        amapServiceConfigured: Boolean(AMAP_SERVICE_KEY),
      });
      return;
    }

    if (pathname === '/api/regeo' && req.method === 'GET') {
      const lat = toNum(searchParams.get('lat'), 'lat');
      const lon = toNum(searchParams.get('lon'), 'lon');
      if (!amap.enabled) {
        sendJson(res, 200, {
          city: '',
          source: 'local',
          warning: '未配置 AMAP_KEY，无法逆地理编码。',
        });
        return;
      }
      try {
        const info = await amap.reverseGeocode(lat, lon);
        sendJson(res, 200, {
          city: info?.city ?? '',
          province: info?.province ?? '',
          district: info?.district ?? '',
          source: 'amap',
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sendJson(res, 200, {
          city: '',
          source: 'local',
          warning: `逆地理编码失败: ${msg}`,
        });
      }
      return;
    }

    if (pathname === '/api/places' && req.method === 'GET') {
      const city = searchParams.get('city') ?? undefined;
      const latRaw = searchParams.get('lat');
      const lonRaw = searchParams.get('lon');
      const radiusKm = searchParams.get('radiusKm') ? toNum(searchParams.get('radiusKm'), 'radiusKm') : 8;
      const localPlaces = agent.store.listPlaces(city);

      if (amap.enabled && latRaw && lonRaw) {
        const lat = toNum(latRaw, 'lat');
        const lon = toNum(lonRaw, 'lon');
        try {
          const scenic = await amap.searchNearbySpots(lat, lon, radiusKm, city, '景点');
          const parks = await amap.searchNearbySpots(lat, lon, radiusKm, city, '公园');
          const remote = [...scenic, ...parks].map((p) => ({
            id: p.id,
            name: p.name,
            category: p.category,
            lat: p.lat,
            lon: p.lon,
            city: city ?? '',
            tags: ['高德', '实时'],
            avg_visit_min: p.category === 'park' ? 60 : 90,
            score: 4.6,
            created_at: new Date().toISOString(),
          }));

          const byKey = new Map<string, (typeof remote)[number]>();
          for (const p of [...remote, ...localPlaces]) {
            byKey.set(`${p.name}_${p.lat}_${p.lon}`, p);
          }
          sendJson(res, 200, {
            places: [...byKey.values()],
            source: 'amap',
          });
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          sendJson(res, 200, {
            places: localPlaces,
            source: 'local',
            warning: `高德点位拉取失败，已回退本地数据: ${msg}`,
          });
          return;
        }
      }

      sendJson(res, 200, { places: localPlaces, source: 'local' });
      return;
    }

    if (pathname === '/api/places' && req.method === 'POST') {
      const body = (await readBody(req)) as {
        name?: string;
        category?: Category;
        lat?: number;
        lon?: number;
        city?: string;
        tags?: string[];
        avgVisitMin?: number;
        score?: number;
      };
      if (!body.name || !body.category || body.lat === undefined || body.lon === undefined) {
        sendJson(res, 400, { error: 'name/category/lat/lon 为必填' });
        return;
      }
      if (body.category !== 'park' && body.category !== 'attraction') {
        sendJson(res, 400, { error: 'category 只能是 park 或 attraction' });
        return;
      }

      let city = (body.city ?? '').trim();
      if (!city && amap.enabled) {
        try {
          const info = await amap.reverseGeocode(Number(body.lat), Number(body.lon));
          city = info?.city || info?.district || info?.province || '';
        } catch {
          // ignore
        }
      }
      if (!city) {
        city = '未知';
      }

      const place = agent.store.addPlace({
        name: body.name,
        category: body.category,
        lat: Number(body.lat),
        lon: Number(body.lon),
        city,
        tags: Array.isArray(body.tags) ? body.tags : [],
        avgVisitMin: body.avgVisitMin,
        score: body.score,
      });
      sendJson(res, 200, { place });
      return;
    }

    if (pathname === '/api/parks' && req.method === 'GET') {
      const lat = toNum(searchParams.get('lat'), 'lat');
      const lon = toNum(searchParams.get('lon'), 'lon');
      const city = searchParams.get('city') ?? undefined;
      const radiusKm = searchParams.get('radiusKm') ? toNum(searchParams.get('radiusKm'), 'radiusKm') : 3;
      const localParks = agent.findNearbyParks(lat, lon, radiusKm, 10);

      if (!amap.enabled) {
        sendJson(res, 200, {
          parks: localParks,
          source: 'local',
          warning: '未配置 AMAP_KEY，当前使用本地点位数据。',
        });
        return;
      }

      try {
        const parks = await amap.searchNearbyParks(lat, lon, radiusKm, city);
        sendJson(res, 200, {
          parks: parks.map((p) => ({
            place: {
              id: p.id,
              name: p.name,
              category: 'park',
              lat: p.lat,
              lon: p.lon,
              city: city ?? '',
              tags: ['高德', '实时'],
              avg_visit_min: 60,
              score: 4.6,
              created_at: new Date().toISOString(),
            },
            distanceKm: p.distanceKm,
            source: 'amap',
            address: p.address,
            poiType: p.type,
          })),
          source: 'amap',
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sendJson(res, 200, {
          parks: localParks,
          source: 'local',
          warning: `高德接口调用失败，已回退本地点位：${msg}`,
        });
      }
      return;
    }

    if (pathname === '/api/route' && req.method === 'GET') {
      const lat = toNum(searchParams.get('lat'), 'lat');
      const lon = toNum(searchParams.get('lon'), 'lon');
      const city = searchParams.get('city') ?? '';
      const hours = searchParams.get('hours') ? toNum(searchParams.get('hours'), 'hours') : 4;
      const preferRaw = searchParams.get('prefer') ?? 'mixed';
      const prefer = preferRaw as Prefer;
      if (!['mixed', 'park', 'attraction'].includes(prefer)) {
        sendJson(res, 400, { error: 'prefer 只能是 mixed|park|attraction' });
        return;
      }
      let result = agent.planRoute(lat, lon, city, hours, prefer);
      let routeCandidates = pickLocalRouteCandidates(agent, city, prefer);
      let planningSource: 'local' | 'amap' = 'local';
      let aiApplied = false;

      if (amap.enabled) {
        try {
          const spots =
            prefer === 'park'
              ? await amap.searchNearbySpots(lat, lon, 12, city, '公园')
              : prefer === 'attraction'
                ? await amap.searchNearbySpots(lat, lon, 12, city, '景点')
                : [
                    ...(await amap.searchNearbySpots(lat, lon, 12, city, '景点')),
                    ...(await amap.searchNearbySpots(lat, lon, 12, city, '公园')),
                  ];

          const byKey = new Map<string, Place>();
          for (const s of spots) {
            const key = `${s.name}_${s.lat}_${s.lon}`;
            if (!byKey.has(key)) {
              byKey.set(key, {
                id: s.id,
                name: s.name,
                category: s.category,
                lat: s.lat,
                lon: s.lon,
                city,
                tags: ['高德', '实时'],
                avg_visit_min: s.category === 'park' ? 60 : 90,
                score: 4.6,
                created_at: new Date().toISOString(),
              });
            }
          }
          if (byKey.size > 0) {
            routeCandidates = [...byKey.values()];
            result = planRouteFromCandidates(lat, lon, hours, routeCandidates);
            planningSource = 'amap';
          }
        } catch {
          // ignore and keep local fallback
        }
      }

      const aiRoute = await planRouteWithAi({
        startLat: lat,
        startLon: lon,
        city,
        hours,
        prefer,
        candidates: routeCandidates,
      });
      if (aiRoute && aiRoute.stops.length > 0) {
        result = aiRoute;
        aiApplied = true;
      }

      if (!amap.enabled || result.stops.length === 0) {
        sendJson(res, 200, {
          ...result,
          source: planningSource,
          aiApplied,
          warning: amap.enabled ? undefined : '未配置 AMAP_KEY，当前使用本地估算时长。',
        });
        return;
      }

      let currentLat = lat;
      let currentLon = lon;
      let totalMinutes = 0;
      const routePolylines: Array<Array<[number, number]>> = [];

      for (const stop of result.stops) {
        try {
          const leg = await amap.walkingRoute(currentLat, currentLon, stop.lat, stop.lon);
          if (leg) {
            stop.travel_mode = 'walk';
            stop.travel_min = Math.max(1, Math.round(leg.durationSec / 60));
            stop.distance_km = Number((leg.distanceM / 1000).toFixed(2));
            routePolylines.push(...leg.polylines);
          }
        } catch {
          // 某段失败时保留本地估算值
        }
        totalMinutes += stop.travel_min + stop.visit_min;
        currentLat = stop.lat;
        currentLon = stop.lon;
      }

      sendJson(res, 200, {
        ...result,
        total_minutes: totalMinutes,
        summary: `${result.summary}（交通时长已按高德步行路线校准）`,
        source: 'amap',
        aiApplied,
        routePolylines,
      });
      return;
    }

    if (pathname === '/api/agent/plan' && req.method === 'POST') {
      const body = (await readBody(req)) as {
        lat?: number;
        lon?: number;
        city?: string;
        days?: number;
        dailyHours?: number;
        interests?: string[];
        habits?: string[];
        totalBudgetCny?: number;
        hotelBudgetPerNight?: number;
        prefer?: Prefer;
      };
      if (body.lat === undefined || body.lon === undefined) {
        sendJson(res, 400, { error: 'lat/lon 为必填' });
        log('warn', 'agent.plan.invalid_input', requestMeta);
        return;
      }
      log('info', 'agent.plan.input', {
        ...requestMeta,
        city: body.city ?? '',
        days: body.days ?? 2,
        dailyHours: body.dailyHours ?? 6,
        prefer: body.prefer ?? 'mixed',
      });
      const result = await orchestrator.run({
        lat: Number(body.lat),
        lon: Number(body.lon),
        city: (body.city ?? '').trim(),
        days: Math.max(1, Math.min(7, Math.floor(Number(body.days ?? 2)))),
        dailyHours: Math.max(2, Math.min(12, Number(body.dailyHours ?? 6))),
        interests: Array.isArray(body.interests)
          ? body.interests.map((s) => String(s).trim()).filter(Boolean)
          : [],
        habits: Array.isArray(body.habits)
          ? body.habits.map((s) => String(s).trim()).filter(Boolean)
          : [],
        totalBudgetCny: Number(body.totalBudgetCny ?? 3000),
        hotelBudgetPerNight: Number(body.hotelBudgetPerNight ?? 600),
        prefer: (body.prefer ?? 'mixed') as Prefer,
      });
      sendJson(res, 200, result);
      log('info', 'agent.plan.output', {
        ...requestMeta,
        stops: result.route.stops.length,
        hotels: result.hotels.length,
        routeSource: result.route.source,
        aiApplied: result.executionTrace.some((x) => x.includes('ai_decision_agent: applied')),
      });
      return;
    }

    if (pathname === '/api/chat' && req.method === 'POST') {
      const body = (await readBody(req)) as {
        message?: string;
        lat?: number;
        lon?: number;
        city?: string;
        hours?: number;
        radiusKm?: number;
        prefer?: Prefer;
      };
      if (!body.message) {
        sendJson(res, 400, { error: 'message 为必填' });
        return;
      }
      const text = agent.chat(body.message, {
        lat: body.lat,
        lon: body.lon,
        city: body.city,
        hours: body.hours,
        radius_km: body.radiusKm,
        prefer: body.prefer,
      });
      sendJson(res, 200, { text });
      return;
    }

    if (req.method === 'GET') {
      serveStatic(pathname, res);
      return;
    }

    sendText(res, 404, 'Not Found');
    log('warn', 'request.not_found', { ...requestMeta, pathname });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('error', 'request.error', { ...requestMeta, error: msg });
    sendJson(res, 500, { error: msg });
  } finally {
    log('info', 'request.end', {
      ...requestMeta,
      durationMs: Date.now() - startedAt,
    });
  }
});

server.listen(PORT, () => {
  console.log(`Travel Planner Web 已启动: http://localhost:${PORT}`);
});
