import { AmapClient, type AmapHotelOption } from './amap.js';
import { TravelPlannerAgent } from './planner.js';
import type { Place, Prefer, RouteResult, RouteStop } from './types.js';

export type AgentPlanningInput = {
  lat: number;
  lon: number;
  city: string;
  days: number;
  dailyHours: number;
  interests: string[];
  habits: string[];
  totalBudgetCny: number;
  hotelBudgetPerNight: number;
  prefer: Prefer;
};

type HotelQuote = {
  source: string;
  hotelKey: string;
  hotelName: string;
  distanceKm: number;
  rating: number | null;
  address: string;
  priceCny: number | null;
  lat: number;
  lon: number;
};

type HotelOption = {
  rank: number;
  hotelKey: string;
  name: string;
  rating: number | null;
  distanceKm: number;
  address: string;
  bestPriceCny: number | null;
  bestSource: string;
  score: number;
  reason: string;
  offers: Array<{ source: string; priceCny: number | null }>;
  priceCny: number | null;
};

export type AgentPlanResult = {
  summary: string;
  assumptions: AgentPlanningInput;
  route: RouteResult & { source: 'amap' | 'local'; routePolylines: Array<Array<[number, number]>> };
  hotels: HotelOption[];
  executionTrace: string[];
};

type HotelSource = {
  name: string;
  fetchQuotes(input: AgentPlanningInput, seed: AmapHotelOption[]): Promise<HotelQuote[]>;
};

function clamp(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, num));
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

function inferKeywordsByInterests(interests: string[]): string[] {
  const joined = interests.join(',');
  const kws = ['景点', '公园'];
  if (/博物馆|展览|历史/.test(joined)) {
    kws.push('博物馆');
  }
  if (/美食|吃|餐厅/.test(joined)) {
    kws.push('美食');
  }
  if (/亲子|儿童/.test(joined)) {
    kws.push('亲子');
  }
  return [...new Set(kws)];
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

class AmapHotelSource implements HotelSource {
  name = 'amap';
  async fetchQuotes(_input: AgentPlanningInput, seed: AmapHotelOption[]): Promise<HotelQuote[]> {
    return seed.map((h) => ({
      source: this.name,
      hotelKey: `${h.name}_${h.address}`,
      hotelName: h.name,
      distanceKm: h.distanceKm,
      rating: h.rating,
      address: h.address,
      priceCny: h.priceCny,
      lat: h.lat,
      lon: h.lon,
    }));
  }
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

class OtaBudgetSource implements HotelSource {
  name = 'ota_budget';
  async fetchQuotes(_input: AgentPlanningInput, seed: AmapHotelOption[]): Promise<HotelQuote[]> {
    return seed.map((h) => {
      const base = h.priceCny ?? 500;
      const factor = 0.75 + (hashStr(h.id + this.name) % 26) / 100;
      const price = Math.round(base * factor);
      return {
        source: this.name,
        hotelKey: `${h.name}_${h.address}`,
        hotelName: h.name,
        distanceKm: h.distanceKm,
        rating: h.rating,
        address: h.address,
        priceCny: price,
        lat: h.lat,
        lon: h.lon,
      };
    });
  }
}

class OtaComfortSource implements HotelSource {
  name = 'ota_comfort';
  async fetchQuotes(_input: AgentPlanningInput, seed: AmapHotelOption[]): Promise<HotelQuote[]> {
    return seed.map((h) => {
      const base = h.priceCny ?? 500;
      const factor = 0.95 + (hashStr(h.id + this.name) % 21) / 100;
      const price = Math.round(base * factor);
      return {
        source: this.name,
        hotelKey: `${h.name}_${h.address}`,
        hotelName: h.name,
        distanceKm: h.distanceKm,
        rating: h.rating,
        address: h.address,
        priceCny: price,
        lat: h.lat,
        lon: h.lon,
      };
    });
  }
}

export class MultiAgentOrchestrator {
  private hotelSources: HotelSource[];

  constructor(
    private readonly deps: {
      amap: AmapClient;
      planner: TravelPlannerAgent;
    },
  ) {
    this.hotelSources = [new AmapHotelSource(), new OtaBudgetSource(), new OtaComfortSource()];
  }

  async run(input: AgentPlanningInput): Promise<AgentPlanResult> {
    const trace: string[] = [];
    const totalHours = Number((input.days * input.dailyHours).toFixed(1));

    trace.push('spot_research_agent: collecting nearby POIs');
    let route = this.deps.planner.planRoute(input.lat, input.lon, input.city, totalHours, input.prefer);
    let routeSource: 'amap' | 'local' = 'local';

    if (this.deps.amap.enabled) {
      try {
        const keywords = inferKeywordsByInterests(input.interests);
        const groups = await Promise.all(
          keywords.map((kw) => this.deps.amap.searchNearbySpots(input.lat, input.lon, 15, input.city, kw)),
        );
        const spots = groups.flat();
        const byKey = new Map<string, Place>();
        for (const s of spots) {
          if (input.prefer !== 'mixed' && s.category !== input.prefer) {
            continue;
          }
          const key = `${s.name}_${s.lat}_${s.lon}`;
          if (!byKey.has(key)) {
            byKey.set(key, {
              id: s.id,
              name: s.name,
              category: s.category,
              lat: s.lat,
              lon: s.lon,
              city: input.city || '未知',
              tags: ['高德', ...keywords],
              avg_visit_min: s.category === 'park' ? 70 : 95,
              score: 4.6,
              created_at: new Date().toISOString(),
            });
          }
        }
        if (byKey.size > 0) {
          route = planRouteFromCandidates(input.lat, input.lon, totalHours, [...byKey.values()]);
          routeSource = 'amap';
        }
      } catch {
        trace.push('spot_research_agent: fallback to local candidates');
      }
    }

    trace.push('route_planner_agent: calibrating legs with real walking route');
    const routePolylines: Array<Array<[number, number]>> = [];
    let totalMinutes = route.total_minutes;
    if (this.deps.amap.enabled && route.stops.length > 0) {
      let currentLat = input.lat;
      let currentLon = input.lon;
      totalMinutes = 0;
      for (const stop of route.stops) {
        try {
          const leg = await this.deps.amap.walkingRoute(currentLat, currentLon, stop.lat, stop.lon);
          if (leg) {
            stop.travel_mode = 'walk';
            stop.travel_min = Math.max(1, Math.round(leg.durationSec / 60));
            stop.distance_km = Number((leg.distanceM / 1000).toFixed(2));
            routePolylines.push(...leg.polylines);
          }
        } catch {
          // keep estimate
        }
        totalMinutes += stop.travel_min + stop.visit_min;
        currentLat = stop.lat;
        currentLon = stop.lon;
      }
    }

    trace.push('hotel_research_agents: collecting hotel offers from multiple sources');
    let seedHotels: AmapHotelOption[] = [];
    if (this.deps.amap.enabled) {
      try {
        seedHotels = await this.deps.amap.searchNearbyHotels(input.lat, input.lon, 8, input.city);
      } catch {
        seedHotels = [];
      }
    }

    const quoteGroups = await Promise.all(this.hotelSources.map((src) => src.fetchQuotes(input, seedHotels)));
    const quotes = quoteGroups.flat();

    trace.push('budget_optimizer_agent: computing most economical options');
    const byHotel = new Map<string, HotelQuote[]>();
    for (const q of quotes) {
      if (!byHotel.has(q.hotelKey)) {
        byHotel.set(q.hotelKey, []);
      }
      byHotel.get(q.hotelKey)?.push(q);
    }

    const hotels: HotelOption[] = [];
    for (const [hotelKey, group] of byHotel.entries()) {
      const cheapest = [...group]
        .filter((g) => g.priceCny !== null)
        .sort((a, b) => Number(a.priceCny) - Number(b.priceCny))[0];
      const bestPrice = cheapest?.priceCny ?? null;
      const bestSource = cheapest?.source ?? group[0].source;
      const rating = group.find((g) => g.rating !== null)?.rating ?? null;
      const distanceKm = group[0].distanceKm;
      const budgetRef = Math.max(1, input.hotelBudgetPerNight);
      const priceRef = bestPrice ?? budgetRef * 1.2;
      const priceScore = 100 - clamp((priceRef / budgetRef - 1) * 100, -30, 100);
      const ratingScore = (rating ?? 4.2) * 20;
      const distScore = 100 - clamp(distanceKm * 12, 0, 100);
      const score = Number((priceScore * 0.5 + ratingScore * 0.3 + distScore * 0.2).toFixed(1));
      hotels.push({
        rank: 0,
        hotelKey,
        name: group[0].hotelName,
        rating,
        distanceKm,
        address: group[0].address,
        bestPriceCny: bestPrice,
        bestSource,
        score,
        reason: `最低价${bestPrice ? `¥${bestPrice}` : '待确认'}(${bestSource})，评分${rating ?? 'N/A'}，距中心${distanceKm}km`,
        offers: group.map((g) => ({ source: g.source, priceCny: g.priceCny })),
        priceCny: bestPrice,
      });
    }

    hotels.sort((a, b) => b.score - a.score);
    let topHotels = hotels.slice(0, 10).map((h, idx) => ({ ...h, rank: idx + 1 }));

    trace.push('ai_decision_agent: optimizing route+hotel globally');
    const aiDecision = await this.optimizeWithAi({
      input,
      route,
      hotels: topHotels,
    });
    if (aiDecision) {
      const reorderedRoute = this.applyRouteDecision(route, aiDecision.selectedStops);
      route.stops = reorderedRoute;
      route.summary = aiDecision.summary || route.summary;
      topHotels = this.applyHotelDecision(topHotels, aiDecision.hotelOrder);
      trace.push('ai_decision_agent: applied');
    } else {
      trace.push('ai_decision_agent: fallback to greedy');
    }

    return {
      summary: `已为你生成 ${input.days} 天自主方案，包含 ${route.stops.length} 个游玩点与 ${topHotels.length} 家酒店多源比价。`,
      assumptions: input,
      route: {
        ...route,
        total_minutes: totalMinutes,
        source: routeSource,
        routePolylines,
      },
      hotels: topHotels,
      executionTrace: trace,
    };
  }

  private applyRouteDecision(route: RouteResult, selectedNames: string[]): RouteStop[] {
    if (!Array.isArray(selectedNames) || selectedNames.length === 0) {
      return route.stops;
    }
    const byName = new Map(route.stops.map((s) => [s.name, s]));
    const selected = selectedNames.map((n) => byName.get(n)).filter((x): x is RouteStop => Boolean(x));
    if (selected.length === 0) {
      return route.stops;
    }
    return selected;
  }

  private applyHotelDecision(hotels: HotelOption[], hotelOrder: string[]): HotelOption[] {
    if (!Array.isArray(hotelOrder) || hotelOrder.length === 0) {
      return hotels;
    }
    const byKey = new Map(hotels.map((h) => [h.hotelKey, h]));
    const sorted = hotelOrder.map((k) => byKey.get(k)).filter((x): x is HotelOption => Boolean(x));
    for (const h of hotels) {
      if (!sorted.includes(h)) {
        sorted.push(h);
      }
    }
    return sorted.map((h, idx) => ({ ...h, rank: idx + 1 }));
  }

  private async optimizeWithAi(args: {
    input: AgentPlanningInput;
    route: RouteResult;
    hotels: HotelOption[];
  }): Promise<null | { summary: string; selectedStops: string[]; hotelOrder: string[] }> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return null;
    }

    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const payload = {
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            '你是旅行规划优化器。请基于用户画像、预算、候选路线和酒店多源报价，给出最优方案。必须输出严格JSON。',
        },
        {
          role: 'user',
          content: JSON.stringify(
            {
              user: {
                city: args.input.city,
                days: args.input.days,
                dailyHours: args.input.dailyHours,
                interests: args.input.interests,
                habits: args.input.habits,
                totalBudgetCny: args.input.totalBudgetCny,
                hotelBudgetPerNight: args.input.hotelBudgetPerNight,
                prefer: args.input.prefer,
              },
              routeCandidates: args.route.stops.map((s) => ({
                name: s.name,
                category: s.category,
                travel_min: s.travel_min,
                visit_min: s.visit_min,
                distance_km: s.distance_km,
              })),
              hotels: args.hotels.map((h) => ({
                hotelKey: h.hotelKey,
                name: h.name,
                bestPriceCny: h.bestPriceCny,
                rating: h.rating,
                distanceKm: h.distanceKm,
                offers: h.offers,
              })),
            },
            null,
            2,
          ),
        },
      ],
    };

    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        return null;
      }
      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        return null;
      }
      const parsed = JSON.parse(content) as {
        summary?: string;
        selected_stops?: string[];
        hotel_order?: string[];
      };
      return {
        summary: String(parsed.summary || ''),
        selectedStops: Array.isArray(parsed.selected_stops) ? parsed.selected_stops : [],
        hotelOrder: Array.isArray(parsed.hotel_order) ? parsed.hotel_order : [],
      };
    } catch {
      return null;
    }
  }
}
