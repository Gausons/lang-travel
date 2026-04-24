import { log } from './logger.js';
import type { Place, Prefer, RouteResult, RouteStop } from './types.js';

type AiRouteInput = {
  startLat: number;
  startLon: number;
  city: string;
  hours: number;
  prefer: Prefer;
  candidates: Place[];
};

type AiRouteOutput = {
  summary: string;
  selectedStopIds: string[];
};

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

function estimateTravel(distKm: number): { mode: 'walk' | 'transit'; minutes: number } {
  const transitSpeedKmh = 20;
  const walkSpeedKmh = 4.5;
  if (distKm <= 1.2) {
    return {
      mode: 'walk',
      minutes: Math.max(1, Math.floor((distKm / walkSpeedKmh) * 60)),
    };
  }
  return {
    mode: 'transit',
    minutes: Math.max(1, Math.floor((distKm / transitSpeedKmh) * 60) + 8),
  };
}

function resolveChatCompletionsUrl(baseUrlRaw: string | undefined): string {
  const base = (baseUrlRaw || '').trim().replace(/\/+$/, '');
  if (!base) {
    return 'https://api.openai.com/v1/chat/completions';
  }
  if (base.endsWith('/chat/completions')) {
    return base;
  }
  if (base.endsWith('/models')) {
    const withoutModels = base.slice(0, -'/models'.length);
    return `${withoutModels}/chat/completions`;
  }
  if (/\/v\d+$/.test(base)) {
    return `${base}/chat/completions`;
  }
  return `${base}/v1/chat/completions`;
}

function parseAiRouteOutput(content: string): AiRouteOutput | null {
  const tryParse = (raw: string): AiRouteOutput | null => {
    const parsed = JSON.parse(raw) as { summary?: unknown; selected_stop_ids?: unknown };
    if (!Array.isArray(parsed.selected_stop_ids)) {
      return null;
    }
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
      selectedStopIds: parsed.selected_stop_ids.map((x) => String(x)).filter(Boolean),
    };
  };

  try {
    return tryParse(content);
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return null;
    }
    try {
      return tryParse(content.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function buildRouteFromOrderedPlaces(
  startLat: number,
  startLon: number,
  hours: number,
  orderedPlaces: Place[],
  summary: string,
): RouteResult {
  const budgetMin = Math.floor(hours * 60);
  const route: RouteStop[] = [];
  let usedMin = 0;
  let currentLat = startLat;
  let currentLon = startLon;

  for (const place of orderedPlaces) {
    const distKm = haversineKm(currentLat, currentLon, place.lat, place.lon);
    const travel = estimateTravel(distKm);
    const needMin = travel.minutes + place.avg_visit_min;
    if (usedMin + needMin > budgetMin) {
      continue;
    }
    usedMin += needMin;
    route.push({
      name: place.name,
      category: place.category,
      lat: place.lat,
      lon: place.lon,
      distance_km: Number(distKm.toFixed(2)),
      travel_mode: travel.mode,
      travel_min: travel.minutes,
      visit_min: place.avg_visit_min,
      tags: place.tags,
    });
    currentLat = place.lat;
    currentLon = place.lon;
  }

  return {
    summary: summary || `AI 已为你生成 ${hours.toFixed(1)} 小时路线，包含 ${route.length} 个点位。`,
    stops: route,
    total_minutes: usedMin,
  };
}

export async function planRouteWithAi(input: AiRouteInput): Promise<RouteResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    return null;
  }

  const model = process.env.OPENAI_CHAT_MODEL || process.env.OPENAI_MODEL || 'gpt-5.4-mini';
  const endpoint = resolveChatCompletionsUrl(process.env.OPENAI_BASE_URL);
  const limited = [...input.candidates]
    .sort((a, b) => b.score - a.score)
    .slice(0, 40)
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      lat: p.lat,
      lon: p.lon,
      score: p.score,
      avg_visit_min: p.avg_visit_min,
      tags: p.tags,
      distance_from_start_km: Number(haversineKm(input.startLat, input.startLon, p.lat, p.lon).toFixed(2)),
    }));

  const payload = {
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          '你是旅行路线规划助手。请基于候选点位生成可执行路线。必须输出严格 JSON，字段: summary(string), selected_stop_ids(string[])。只返回 JSON。',
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            constraints: {
              city: input.city,
              start: { lat: input.startLat, lon: input.startLon },
              hours: input.hours,
              prefer: input.prefer,
              hard_rule: 'selected_stop_ids 必须来自 candidates.id，顺序即游玩顺序',
            },
            candidates: limited,
          },
          null,
          2,
        ),
      },
    ],
  };

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      log('warn', 'route.ai.http_failed', { status: resp.status });
      return null;
    }
    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }
    const parsed = parseAiRouteOutput(content);
    if (!parsed || parsed.selectedStopIds.length === 0) {
      return null;
    }
    const byId = new Map(input.candidates.map((p) => [p.id, p]));
    const ordered = parsed.selectedStopIds
      .map((id) => byId.get(id))
      .filter((p): p is Place => Boolean(p));
    if (ordered.length === 0) {
      return null;
    }
    return buildRouteFromOrderedPlaces(
      input.startLat,
      input.startLon,
      input.hours,
      ordered,
      parsed.summary,
    );
  } catch (error) {
    log('warn', 'route.ai.exception', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
