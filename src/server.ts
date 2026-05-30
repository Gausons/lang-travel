import fs from 'node:fs';
import path from 'node:path';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { planRouteWithAi } from './ai-route-planner.js';
import { log } from './logger.js';
import { isFilledSecret } from './map-provider.js';
import { createMapProvider, listMapProviderNames } from './map-providers.js';
import { MemoryService } from './memory-service.js';
import type { MemoryPatch, UserMemory } from './memory-types.js';
import { MultiAgentOrchestrator } from './multi-agent.js';
import { TravelPlannerAgent } from './planner.js';
import {
  PreferenceChatAiError,
  resolvePreferenceChat,
  type PreferenceChatMessage,
} from './preference-chat.js';
import { resolveTenantContext } from './tenant-context.js';
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

const AMAP_JS_KEY = isFilledSecret(process.env.AMAP_JS_KEY)
  ? process.env.AMAP_JS_KEY
  : isFilledSecret(process.env.AMAP_KEY)
    ? process.env.AMAP_KEY
    : '';
const AMAP_SECURITY_JS_CODE = isFilledSecret(process.env.AMAP_SECURITY_JS_CODE)
  ? process.env.AMAP_SECURITY_JS_CODE
  : '';
const AMAP_SERVICE_KEY = isFilledSecret(process.env.AMAP_KEY) ? process.env.AMAP_KEY : '';

const agent = new TravelPlannerAgent();
const mapProvider = createMapProvider();
const orchestrator = new MultiAgentOrchestrator({ mapProvider, planner: agent });
const memoryService = new MemoryService();

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

function cleanStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((s) => String(s).trim()).filter(Boolean);
}

function mergeStringArrays(...groups: string[][]): string[] {
  const next = new Map<string, string>();
  for (const group of groups) {
    for (const value of group) {
      const cleaned = value.trim();
      if (cleaned) {
        next.set(cleaned.toLowerCase(), cleaned);
      }
    }
  }
  return [...next.values()];
}

function normalizePrefer(value: unknown, fallback?: Prefer): Prefer | undefined {
  return value === 'park' || value === 'attraction' || value === 'mixed' ? value : fallback;
}

function preferWithMemory(value: unknown, memory: UserMemory): Prefer {
  const prefer = normalizePrefer(value, 'mixed') ?? 'mixed';
  return prefer === 'mixed' ? memory.preferences.prefer : prefer;
}

function buildManualMemoryPatch(body: unknown): MemoryPatch {
  if (!body || typeof body !== 'object') {
    return {};
  }
  const raw = body as Record<string, unknown>;
  const num = (value: unknown): number | undefined => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };
  const pace = raw.pace === 'relaxed' || raw.pace === 'normal' || raw.pace === 'packed' ? raw.pace : undefined;
  return {
    profile: {
      homeCity: typeof raw.homeCity === 'string' ? raw.homeCity.trim() : undefined,
      language: typeof raw.language === 'string' ? raw.language.trim() : undefined,
      travelStyleAdd: cleanStringArray(raw.travelStyleAdd),
    },
    interestsAdd: cleanStringArray(raw.interestsAdd ?? raw.interests),
    habitsAdd: cleanStringArray(raw.habitsAdd ?? raw.habits),
    dislikesAdd: cleanStringArray(raw.dislikesAdd ?? raw.dislikes),
    constraintsAdd: cleanStringArray(raw.constraintsAdd ?? raw.constraints),
    budget: {
      dailyCny: num(raw.dailyCny),
      totalCny: num(raw.totalBudgetCny ?? raw.totalCny),
      hotelPerNightCny: num(raw.hotelBudgetPerNightCny ?? raw.hotelPerNightCny),
    },
    pace,
    prefer: normalizePrefer(raw.prefer),
  };
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
        mapProvider: mapProvider.name,
        mapProviderEnabled: mapProvider.enabled,
        amapEnabled: mapProvider.name === 'amap' && mapProvider.enabled,
      });
      return;
    }

    if (pathname === '/api/mobile/config' && req.method === 'GET') {
      sendJson(res, 200, {
        apiVersion: 1,
        mapProvider: mapProvider.name,
        mapProviderDisplayName: mapProvider.displayName,
        mapProviderEnabled: mapProvider.enabled,
        availableMapProviders: listMapProviderNames(),
        amapEnabled: mapProvider.name === 'amap' && mapProvider.enabled,
        amapServiceConfigured: mapProvider.name === 'amap' && mapProvider.enabled,
        aiPlanningEnabled: Boolean(process.env.OPENAI_API_KEY),
      });
      return;
    }

    if (pathname === '/api/client-config') {
      sendJson(res, 200, {
        amapJsKey: AMAP_JS_KEY,
        amapSecurityJsCode: AMAP_SECURITY_JS_CODE,
        amapEnabled: Boolean(AMAP_JS_KEY),
        amapServiceConfigured: Boolean(AMAP_SERVICE_KEY),
      });
      return;
    }

    if (pathname === '/api/memory' && req.method === 'GET') {
      const tenant = resolveTenantContext(req, searchParams);
      sendJson(res, 200, {
        tenant,
        memory: memoryService.recall(tenant),
      });
      return;
    }

    if (pathname === '/api/memory/events' && req.method === 'GET') {
      const tenant = resolveTenantContext(req, searchParams);
      sendJson(res, 200, {
        tenant,
        events: memoryService.listEvents(tenant),
      });
      return;
    }

    if (pathname === '/api/memory/patch' && req.method === 'POST') {
      const body = await readBody(req);
      const tenant = resolveTenantContext(req, searchParams, body);
      const memory = memoryService.applyPatch(
        tenant,
        buildManualMemoryPatch(body),
        'manual_patch',
        { requestId },
      );
      sendJson(res, 200, { tenant, memory });
      return;
    }

    if (pathname === '/api/regeo' && req.method === 'GET') {
      const lat = toNum(searchParams.get('lat'), 'lat');
      const lon = toNum(searchParams.get('lon'), 'lon');
      if (!mapProvider.enabled) {
        sendJson(res, 200, {
          city: '',
          source: 'local',
          warning: `未配置 ${mapProvider.displayName} 地图服务，无法逆地理编码。`,
        });
        return;
      }
      try {
        const info = await mapProvider.reverseGeocode(lat, lon);
        sendJson(res, 200, {
          city: info?.city ?? '',
          province: info?.province ?? '',
          district: info?.district ?? '',
          source: mapProvider.name,
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

      if (mapProvider.enabled && latRaw && lonRaw) {
        const lat = toNum(latRaw, 'lat');
        const lon = toNum(lonRaw, 'lon');
        try {
          const scenic = await mapProvider.searchNearbySpots(lat, lon, radiusKm, city, '景点');
          const parks = await mapProvider.searchNearbySpots(lat, lon, radiusKm, city, '公园');
          const remote = [...scenic, ...parks].map((p) => ({
            id: p.id,
            name: p.name,
            category: p.category,
            lat: p.lat,
            lon: p.lon,
            city: city ?? '',
            tags: [mapProvider.displayName, '实时'],
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
            source: mapProvider.name,
          });
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          sendJson(res, 200, {
            places: localPlaces,
            source: 'local',
            warning: `${mapProvider.displayName} 点位拉取失败，已回退本地数据: ${msg}`,
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
      if (!city && mapProvider.enabled) {
        try {
          const info = await mapProvider.reverseGeocode(Number(body.lat), Number(body.lon));
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

      if (!mapProvider.enabled) {
        sendJson(res, 200, {
          parks: localParks,
          source: 'local',
          warning: `未配置 ${mapProvider.displayName} 地图服务，当前使用本地点位数据。`,
        });
        return;
      }

      try {
        const parks = await mapProvider.searchNearbyParks(lat, lon, radiusKm, city);
        sendJson(res, 200, {
          parks: parks.map((p) => ({
            place: {
              id: p.id,
              name: p.name,
              category: 'park',
              lat: p.lat,
              lon: p.lon,
              city: city ?? '',
              tags: [mapProvider.displayName, '实时'],
              avg_visit_min: 60,
              score: 4.6,
              created_at: new Date().toISOString(),
            },
            distanceKm: p.distanceKm,
            source: mapProvider.name,
            address: p.address,
            poiType: p.type,
          })),
          source: mapProvider.name,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        sendJson(res, 200, {
          parks: localParks,
          source: 'local',
          warning: `${mapProvider.displayName} 接口调用失败，已回退本地点位：${msg}`,
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
      if (!['mixed', 'park', 'attraction'].includes(preferRaw)) {
        sendJson(res, 400, { error: 'prefer 只能是 mixed|park|attraction' });
        return;
      }
      const tenant = resolveTenantContext(req, searchParams);
      const memory = memoryService.recall(tenant);
      const prefer = preferWithMemory(preferRaw, memory);
      let result = agent.planRoute(lat, lon, city, hours, prefer);
      let routeCandidates = pickLocalRouteCandidates(agent, city, prefer);
      let planningSource = 'local';
      let aiApplied = false;

      if (mapProvider.enabled) {
        try {
          const spots =
            prefer === 'park'
              ? await mapProvider.searchNearbySpots(lat, lon, 12, city, '公园')
              : prefer === 'attraction'
                ? await mapProvider.searchNearbySpots(lat, lon, 12, city, '景点')
                : [
                    ...(await mapProvider.searchNearbySpots(lat, lon, 12, city, '景点')),
                    ...(await mapProvider.searchNearbySpots(lat, lon, 12, city, '公园')),
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
                tags: [mapProvider.displayName, '实时'],
                avg_visit_min: s.category === 'park' ? 60 : 90,
                score: 4.6,
                created_at: new Date().toISOString(),
              });
            }
          }
          if (byKey.size > 0) {
            routeCandidates = [...byKey.values()];
            result = planRouteFromCandidates(lat, lon, hours, routeCandidates);
            planningSource = mapProvider.name;
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
        memory,
      });
      if (aiRoute && aiRoute.stops.length > 0) {
        result = aiRoute;
        aiApplied = true;
      }

      if (!mapProvider.enabled || result.stops.length === 0) {
        sendJson(res, 200, {
          ...result,
          source: planningSource,
          aiApplied,
          warning: mapProvider.enabled
            ? undefined
            : `未配置 ${mapProvider.displayName} 地图服务，当前使用本地估算时长。`,
        });
        return;
      }

      let currentLat = lat;
      let currentLon = lon;
      let totalMinutes = 0;
      const routePolylines: Array<Array<[number, number]>> = [];

      for (const stop of result.stops) {
        try {
          const leg = await mapProvider.walkingRoute(currentLat, currentLon, stop.lat, stop.lon);
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
        summary: `${result.summary}（交通时长已按${mapProvider.displayName}步行路线校准）`,
        source: mapProvider.name,
        aiApplied,
        routePolylines,
      });
      return;
    }

    if (pathname === '/api/agent/plan' && req.method === 'POST') {
      const body = (await readBody(req)) as {
        tenantId?: string;
        userId?: string;
        sessionId?: string;
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
      const tenant = resolveTenantContext(req, searchParams, body);
      const memory = memoryService.recall(tenant);
      const bodyInterests = cleanStringArray(body.interests);
      const bodyHabits = cleanStringArray(body.habits);
      const totalBudgetRaw = Number(body.totalBudgetCny);
      const hotelBudgetRaw = Number(body.hotelBudgetPerNight);
      log('info', 'agent.plan.input', {
        ...requestMeta,
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        city: body.city ?? '',
        days: body.days ?? 2,
        dailyHours: body.dailyHours ?? 6,
        prefer: preferWithMemory(body.prefer ?? 'mixed', memory),
      });
      const planInput = {
        tenant,
        memory,
        lat: Number(body.lat),
        lon: Number(body.lon),
        city: (body.city ?? '').trim(),
        days: Math.max(1, Math.min(7, Math.floor(Number(body.days ?? 2)))),
        dailyHours: Math.max(2, Math.min(12, Number(body.dailyHours ?? 6))),
        interests: mergeStringArrays(memory.preferences.interests, bodyInterests),
        habits: mergeStringArrays(memory.preferences.habits, memory.preferences.constraints, bodyHabits),
        totalBudgetCny:
          Number.isFinite(totalBudgetRaw) && totalBudgetRaw > 0
            ? totalBudgetRaw
            : memory.preferences.budget.totalCny ?? 3000,
        hotelBudgetPerNight:
          Number.isFinite(hotelBudgetRaw) && hotelBudgetRaw > 0
            ? hotelBudgetRaw
            : memory.preferences.budget.hotelPerNightCny ?? 600,
        prefer: preferWithMemory(body.prefer ?? 'mixed', memory),
      };
      const result = await orchestrator.run(planInput);
      memoryService.recordAgentPlan(tenant, planInput, result);
      result.executionTrace.push('memory_write_agent: recorded planning event');
      sendJson(res, 200, result);
      log('info', 'agent.plan.output', {
        ...requestMeta,
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        stops: result.route.stops.length,
        hotels: result.hotels.length,
        routeSource: result.route.source,
        aiApplied: result.executionTrace.some((x) => x.includes('ai_decision_agent: applied')),
      });
      return;
    }

    if (pathname === '/api/preference-chat' && req.method === 'POST') {
      const body = (await readBody(req)) as {
        tenantId?: string;
        userId?: string;
        sessionId?: string;
        message?: string;
        interests?: string[];
        habits?: string[];
        prefer?: Prefer;
        history?: PreferenceChatMessage[];
      };
      const message = String(body.message ?? '').trim();
      if (!message) {
        sendJson(res, 400, { error: 'message 为必填' });
        return;
      }
      const tenant = resolveTenantContext(req, searchParams, body);
      const memory = memoryService.recall(tenant);
      const bodyInterests = cleanStringArray(body.interests);
      const bodyHabits = cleanStringArray(body.habits);
      const result = await resolvePreferenceChat({
        message,
        interests: mergeStringArrays(memory.preferences.interests, bodyInterests),
        habits: mergeStringArrays(memory.preferences.habits, memory.preferences.constraints, bodyHabits),
        prefer: preferWithMemory(body.prefer ?? 'mixed', memory),
        memory,
        history: Array.isArray(body.history)
          ? body.history
              .map((item): PreferenceChatMessage => ({
                role: item?.role === 'user' ? 'user' : 'assistant',
                text: String(item?.text ?? '').trim(),
              }))
              .filter((item) => item.text)
          : [],
      });
      const updatedMemory = memoryService.applyPatch(tenant, result.memoryPatch, 'preference_patch', {
        message,
        aiApplied: result.aiApplied,
      });
      sendJson(res, 200, {
        ...result,
        memory: updatedMemory,
      });
      log('info', 'preference.chat.output', {
        ...requestMeta,
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        aiApplied: result.aiApplied,
        interests: result.interests.length,
        habits: result.habits.length,
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
    sendJson(res, err instanceof PreferenceChatAiError ? err.statusCode : 500, { error: msg });
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
