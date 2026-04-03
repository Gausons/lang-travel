import fs from 'node:fs';
import path from 'node:path';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

import { AmapClient } from './amap.js';
import { TravelPlannerAgent } from './planner.js';
import type { Category, Prefer } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_DIR = path.join(__dirname, '..', 'web');
const PORT = Number(process.env.PORT ?? 3000);

const agent = new TravelPlannerAgent();
const amap = new AmapClient(process.env.AMAP_KEY);

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

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url || !req.method) {
      sendText(res, 400, 'Bad Request');
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

    if (pathname === '/api/places' && req.method === 'GET') {
      const city = searchParams.get('city') ?? undefined;
      sendJson(res, 200, { places: agent.store.listPlaces(city) });
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
      if (!body.name || !body.category || body.lat === undefined || body.lon === undefined || !body.city) {
        sendJson(res, 400, { error: 'name/category/lat/lon/city 为必填' });
        return;
      }
      if (body.category !== 'park' && body.category !== 'attraction') {
        sendJson(res, 400, { error: 'category 只能是 park 或 attraction' });
        return;
      }
      const place = agent.store.addPlace({
        name: body.name,
        category: body.category,
        lat: Number(body.lat),
        lon: Number(body.lon),
        city: body.city,
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
      const result = agent.planRoute(lat, lon, city, hours, prefer);
      if (!amap.enabled || result.stops.length === 0) {
        sendJson(res, 200, {
          ...result,
          source: 'local',
          warning: amap.enabled ? undefined : '未配置 AMAP_KEY，当前使用本地估算时长。',
        });
        return;
      }

      let currentLat = lat;
      let currentLon = lon;
      let totalMinutes = 0;

      for (const stop of result.stops) {
        try {
          const leg = await amap.walkingRoute(currentLat, currentLon, stop.lat, stop.lon);
          if (leg) {
            stop.travel_mode = 'walk';
            stop.travel_min = Math.max(1, Math.round(leg.durationSec / 60));
            stop.distance_km = Number((leg.distanceM / 1000).toFixed(2));
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: msg });
  }
});

server.listen(PORT, () => {
  console.log(`Travel Planner Web 已启动: http://localhost:${PORT}`);
});
