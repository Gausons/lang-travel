import { Platform } from 'react-native';

export type Category = 'park' | 'attraction';
export type Prefer = 'mixed' | 'park' | 'attraction';

export type TravelContext = {
  lat: number;
  lon: number;
  city: string;
};

export type Place = {
  id: string;
  name: string;
  category: Category;
  lat: number;
  lon: number;
  city: string;
  tags: string[];
  avg_visit_min: number;
  score: number;
  created_at: string;
};

export type ParkResult = {
  place: Place;
  distanceKm: number;
  source?: 'amap' | 'local';
  address?: string;
  poiType?: string;
};

export type RouteStop = {
  name: string;
  category: Category;
  lat: number;
  lon: number;
  distance_km: number;
  travel_mode: 'walk' | 'transit';
  travel_min: number;
  visit_min: number;
  tags: string[];
};

export type RouteResponse = {
  summary: string;
  stops: RouteStop[];
  total_minutes: number;
  source?: 'amap' | 'local';
  aiApplied?: boolean;
  warning?: string;
  routePolylines?: Array<Array<[number, number]>>;
};

export type HotelOption = {
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

export type AgentPlanResponse = {
  summary: string;
  assumptions: {
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
  route: RouteResponse & {
    source: 'amap' | 'local';
    routePolylines: Array<Array<[number, number]>>;
  };
  hotels: HotelOption[];
  executionTrace: string[];
};

export type MobileConfigResponse = {
  apiVersion: number;
  amapEnabled: boolean;
  amapServiceConfigured: boolean;
  aiPlanningEnabled: boolean;
};

export type PlacesResponse = {
  places: Place[];
  source: 'amap' | 'local';
  warning?: string;
};

export type ParksResponse = {
  parks: ParkResult[];
  source: 'amap' | 'local';
  warning?: string;
};

export type RegeoResponse = {
  city?: string;
  province?: string;
  district?: string;
  source: 'amap' | 'local';
  warning?: string;
};

const defaultApiBase =
  Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://127.0.0.1:3000';

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || defaultApiBase
).replace(/\/+$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  const raw = await response.text();
  let data: unknown = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`接口返回非 JSON: ${path}`);
  }
  if (!response.ok) {
    const message =
      typeof data === 'object' && data && 'error' in data ? String(data.error) : '请求失败';
    throw new Error(message);
  }
  return data as T;
}

function contextParams(ctx: TravelContext, extra?: Record<string, string>): string {
  return new URLSearchParams({
    lat: String(ctx.lat),
    lon: String(ctx.lon),
    city: ctx.city,
    ...(extra ?? {}),
  }).toString();
}

export function fetchMobileConfig(): Promise<MobileConfigResponse> {
  return request<MobileConfigResponse>('/api/mobile/config');
}

export function reverseGeocode(ctx: Pick<TravelContext, 'lat' | 'lon'>): Promise<RegeoResponse> {
  const query = new URLSearchParams({
    lat: String(ctx.lat),
    lon: String(ctx.lon),
  }).toString();
  return request<RegeoResponse>(`/api/regeo?${query}`);
}

export function fetchPlaces(ctx: TravelContext, radiusKm = 8): Promise<PlacesResponse> {
  return request<PlacesResponse>(
    `/api/places?${contextParams(ctx, { radiusKm: String(radiusKm) })}`,
  );
}

export function fetchParks(ctx: TravelContext, radiusKm: number): Promise<ParksResponse> {
  return request<ParksResponse>(
    `/api/parks?${contextParams(ctx, { radiusKm: String(radiusKm) })}`,
  );
}

export function fetchRoute(
  ctx: TravelContext,
  hours: number,
  prefer: Prefer,
): Promise<RouteResponse> {
  return request<RouteResponse>(
    `/api/route?${contextParams(ctx, {
      hours: String(hours),
      prefer,
    })}`,
  );
}

export function fetchAgentPlan(
  ctx: TravelContext,
  input: {
    days: number;
    dailyHours: number;
    interests: string[];
    habits: string[];
    totalBudgetCny: number;
    hotelBudgetPerNight: number;
    prefer: Prefer;
  },
): Promise<AgentPlanResponse> {
  return request<AgentPlanResponse>('/api/agent/plan', {
    method: 'POST',
    body: JSON.stringify({
      lat: ctx.lat,
      lon: ctx.lon,
      city: ctx.city,
      ...input,
    }),
  });
}
