type AmapPoi = {
  id?: string;
  name?: string;
  location?: string;
  address?: string;
  distance?: string;
  type?: string;
  typecode?: string;
};

type AmapPlaceAroundResp = {
  status?: string;
  info?: string;
  pois?: AmapPoi[];
};

type AmapWalkPath = {
  distance?: string;
  duration?: string;
  steps?: Array<{ instruction?: string; polyline?: string }>;
};

type AmapWalkResp = {
  status?: string;
  info?: string;
  route?: { paths?: AmapWalkPath[] };
};

export type AmapNearbyPark = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
  address: string;
  type: string;
};

export type AmapWalkingLeg = {
  distanceM: number;
  durationSec: number;
  steps: string[];
};

function splitLocation(location: string): { lon: number; lat: number } | null {
  const [lonRaw, latRaw] = location.split(',');
  const lon = Number(lonRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  return { lat, lon };
}

export class AmapClient {
  private readonly key?: string;
  private readonly base = 'https://restapi.amap.com';

  constructor(key = process.env.AMAP_KEY) {
    this.key = key;
  }

  get enabled(): boolean {
    return Boolean(this.key);
  }

  private ensureKey(): string {
    if (!this.key) {
      throw new Error('未配置 AMAP_KEY');
    }
    return this.key;
  }

  private async getJson<T>(pathname: string, params: Record<string, string>): Promise<T> {
    const key = this.ensureKey();
    const query = new URLSearchParams({ ...params, key }).toString();
    const resp = await fetch(`${this.base}${pathname}?${query}`);
    if (!resp.ok) {
      throw new Error(`高德请求失败: ${resp.status}`);
    }
    return (await resp.json()) as T;
  }

  async searchNearbyParks(lat: number, lon: number, radiusKm = 3, city?: string): Promise<AmapNearbyPark[]> {
    const radiusMeter = String(Math.min(50000, Math.max(500, Math.round(radiusKm * 1000))));
    const data = await this.getJson<AmapPlaceAroundResp>('/v3/place/around', {
      location: `${lon},${lat}`,
      keywords: '公园',
      sortrule: 'distance',
      radius: radiusMeter,
      offset: '20',
      page: '1',
      city: city ?? '',
      citylimit: city ? 'true' : 'false',
      extensions: 'base',
    });

    if (data.status !== '1') {
      throw new Error(`高德 POI 检索失败: ${data.info ?? 'unknown'}`);
    }

    const parks: AmapNearbyPark[] = [];
    for (const poi of data.pois ?? []) {
      if (!poi.name || !poi.location) {
        continue;
      }
      const location = splitLocation(poi.location);
      if (!location) {
        continue;
      }
      const distanceM = Number(poi.distance ?? '0');
      parks.push({
        id: poi.id ?? `amap_${poi.name}`,
        name: poi.name,
        lat: location.lat,
        lon: location.lon,
        distanceKm: Number((distanceM / 1000).toFixed(2)),
        address: poi.address ?? '',
        type: poi.type ?? poi.typecode ?? '',
      });
    }
    return parks;
  }

  async walkingRoute(
    originLat: number,
    originLon: number,
    destLat: number,
    destLon: number,
  ): Promise<AmapWalkingLeg | null> {
    const data = await this.getJson<AmapWalkResp>('/v3/direction/walking', {
      origin: `${originLon},${originLat}`,
      destination: `${destLon},${destLat}`,
      alternatives: '0',
    });

    if (data.status !== '1') {
      throw new Error(`高德步行路线失败: ${data.info ?? 'unknown'}`);
    }

    const path = data.route?.paths?.[0];
    if (!path) {
      return null;
    }
    const distanceM = Number(path.distance ?? '0');
    const durationSec = Number(path.duration ?? '0');
    const steps = (path.steps ?? []).map((s) => s.instruction ?? '').filter(Boolean);
    return { distanceM, durationSec, steps };
  }
}

