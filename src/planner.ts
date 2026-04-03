import { PlaceStore } from './store.js';
import type { Place, Prefer, RouteResult, RouteStop } from './types.js';

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

export class TravelPlannerAgent {
  constructor(public readonly store: PlaceStore = new PlaceStore()) {}

  findNearbyParks(lat: number, lon: number, radiusKm = 3, limit = 5): Array<{ place: Place; distanceKm: number }> {
    const parks = this.store.listPlaces().filter((p) => p.category === 'park');
    const ranked = parks
      .map((place) => ({ place, distanceKm: haversineKm(lat, lon, place.lat, place.lon) }))
      .filter((x) => x.distanceKm <= radiusKm)
      .sort((a, b) => (a.distanceKm !== b.distanceKm ? a.distanceKm - b.distanceKm : b.place.score - a.place.score));

    return ranked.slice(0, limit);
  }

  planRoute(startLat: number, startLon: number, city: string, hours = 4, prefer: Prefer = 'mixed'): RouteResult {
    const budgetMin = Math.floor(hours * 60);
    let candidates = this.store.listPlaces(city);

    if (prefer === 'park') {
      candidates = candidates.filter((p) => p.category === 'park');
    } else if (prefer === 'attraction') {
      candidates = candidates.filter((p) => p.category === 'attraction');
    }

    if (candidates.length === 0) {
      return {
        summary: `当前没有 ${city} 的可用点位数据，请先录入。`,
        stops: [],
        total_minutes: 0,
      };
    }

    const remaining = [...candidates];
    const route: RouteStop[] = [];
    let current: [number, number] = [startLat, startLon];
    let usedMin = 0;

    const transitSpeedKmh = 20;
    const walkSpeedKmh = 4.5;

    while (remaining.length > 0 && usedMin < budgetMin) {
      const scored: Array<{ utility: number; place: Place; dist: number }> = [];

      for (const p of remaining) {
        const dist = haversineKm(current[0], current[1], p.lat, p.lon);
        const travelMinWalk = Math.floor((dist / walkSpeedKmh) * 60);
        const travelMinTransit = Math.floor((dist / transitSpeedKmh) * 60) + 8;
        const travelMin = dist <= 1.2 ? travelMinWalk : Math.min(travelMinTransit, travelMinWalk);
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
      const travelMode: 'walk' | 'transit' = chosen.dist <= 1.2 ? 'walk' : 'transit';
      const travelMin =
        travelMode === 'walk'
          ? Math.floor((chosen.dist / walkSpeedKmh) * 60)
          : Math.floor((chosen.dist / transitSpeedKmh) * 60) + 8;

      usedMin += travelMin + chosen.place.avg_visit_min;
      route.push({
        name: chosen.place.name,
        category: chosen.place.category,
        lat: chosen.place.lat,
        lon: chosen.place.lon,
        distance_km: Number(chosen.dist.toFixed(2)),
        travel_mode: travelMode,
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

  chat(message: string, context: { lat?: number; lon?: number; city?: string; hours?: number; radius_km?: number; prefer?: Prefer }): string {
    const msg = message.trim();
    const lat = context.lat ?? 0;
    const lon = context.lon ?? 0;
    const city = context.city ?? '';

    if (!lat || !lon) {
      return '请先提供当前位置坐标（lat/lon）。';
    }

    if (/(散步|公园|走走)/.test(msg)) {
      const radius = context.radius_km ?? 3;
      const parks = this.findNearbyParks(lat, lon, radius, 5);
      if (parks.length === 0) {
        return `${radius}km 内暂时没找到合适公园。你可以先录入新的公园点位。`;
      }

      const lines = ['为你找到这些附近适合散步的小公园：'];
      for (const item of parks) {
        lines.push(`- ${item.place.name}（${item.distanceKm.toFixed(2)}km，评分${item.place.score}，建议停留${item.place.avg_visit_min}分钟）`);
      }
      return lines.join('\n');
    }

    if (/(路线|规划|陌生|怎么玩)/.test(msg)) {
      const hours = context.hours ?? 4;
      const prefer = context.prefer ?? 'mixed';
      const result = this.planRoute(lat, lon, city, hours, prefer);
      if (result.stops.length === 0) {
        return result.summary;
      }

      const lines = [result.summary, '推荐路线：'];
      result.stops.forEach((stop, i) => {
        lines.push(
          `${i + 1}. ${stop.name} | ${stop.category} | ${stop.distance_km}km | ${stop.travel_mode} ${stop.travel_min}分钟 + 游玩${stop.visit_min}分钟`,
        );
      });
      lines.push(`总时长约 ${result.total_minutes} 分钟。`);
      return lines.join('\n');
    }

    return '我可以帮你：1) 找附近公园散步 2) 规划陌生地点游玩路线。';
  }
}
