type AmapPoi = {
  id?: string;
  name?: string;
  location?: string;
  address?: string;
  distance?: string;
  type?: string;
  typecode?: string;
  biz_ext?: {
    cost?: string;
    rating?: string;
  };
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

type AmapRegeoResp = {
  status?: string;
  info?: string;
  regeocode?: {
    addressComponent?: {
      city?: string | string[];
      province?: string;
      district?: string;
    };
  };
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

export type AmapNearbySpot = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
  address: string;
  type: string;
  category: 'park' | 'attraction';
};

export type AmapWalkingLeg = {
  distanceM: number;
  durationSec: number;
  steps: string[];
  polylines: Array<Array<[number, number]>>;
};

export type AmapCityResult = {
  city: string;
  province: string;
  district: string;
};

export type AmapHotelOption = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
  address: string;
  priceCny: number | null;
  rating: number | null;
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

function parsePolyline(polyline?: string): Array<[number, number]> {
  if (!polyline) {
    return [];
  }
  return polyline
    .split(';')
    .map((pair) => {
      const [lonRaw, latRaw] = pair.split(',');
      const lon = Number(lonRaw);
      const lat = Number(latRaw);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
      }
      return [lon, lat] as [number, number];
    })
    .filter((x): x is [number, number] => Boolean(x));
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
    const spots = await this.searchNearbySpots(lat, lon, radiusKm, city, '公园');
    return spots.map((s) => ({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      distanceKm: s.distanceKm,
      address: s.address,
      type: s.type,
    }));
  }

  async searchNearbySpots(
    lat: number,
    lon: number,
    radiusKm = 3,
    city?: string,
    keywords = '景点',
  ): Promise<AmapNearbySpot[]> {
    const radiusMeter = String(Math.min(50000, Math.max(500, Math.round(radiusKm * 1000))));
    const data = await this.getJson<AmapPlaceAroundResp>('/v3/place/around', {
      location: `${lon},${lat}`,
      keywords,
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

    const spots: AmapNearbySpot[] = [];
    for (const poi of data.pois ?? []) {
      if (!poi.name || !poi.location) {
        continue;
      }
      const location = splitLocation(poi.location);
      if (!location) {
        continue;
      }
      const distanceM = Number(poi.distance ?? '0');
      const name = poi.name;
      const category = /公园/.test(name) || /公园/.test(poi.type ?? '') ? 'park' : 'attraction';
      spots.push({
        id: poi.id ?? `amap_${poi.name}`,
        name: poi.name,
        lat: location.lat,
        lon: location.lon,
        distanceKm: Number((distanceM / 1000).toFixed(2)),
        address: poi.address ?? '',
        type: poi.type ?? poi.typecode ?? '',
        category,
      });
    }
    return spots;
  }

  async searchNearbyHotels(
    lat: number,
    lon: number,
    radiusKm = 5,
    city?: string,
  ): Promise<AmapHotelOption[]> {
    const radiusMeter = String(Math.min(50000, Math.max(1000, Math.round(radiusKm * 1000))));
    const data = await this.getJson<AmapPlaceAroundResp>('/v3/place/around', {
      location: `${lon},${lat}`,
      keywords: '酒店',
      sortrule: 'distance',
      radius: radiusMeter,
      offset: '30',
      page: '1',
      city: city ?? '',
      citylimit: city ? 'true' : 'false',
      extensions: 'all',
      types: '100000',
    });

    if (data.status !== '1') {
      throw new Error(`高德酒店检索失败: ${data.info ?? 'unknown'}`);
    }

    const hotels: AmapHotelOption[] = [];
    for (const poi of data.pois ?? []) {
      if (!poi.name || !poi.location) {
        continue;
      }
      const location = splitLocation(poi.location);
      if (!location) {
        continue;
      }
      const distanceM = Number(poi.distance ?? '0');
      const cost = Number(poi.biz_ext?.cost ?? '');
      const rating = Number(poi.biz_ext?.rating ?? '');
      hotels.push({
        id: poi.id ?? `amap_hotel_${poi.name}`,
        name: poi.name,
        lat: location.lat,
        lon: location.lon,
        distanceKm: Number((distanceM / 1000).toFixed(2)),
        address: poi.address ?? '',
        priceCny: Number.isFinite(cost) && cost > 0 ? Number(cost.toFixed(0)) : null,
        rating: Number.isFinite(rating) && rating > 0 ? Number(rating.toFixed(1)) : null,
      });
    }
    return hotels;
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
    const polylines = (path.steps ?? [])
      .map((s) => parsePolyline(s.polyline))
      .filter((line) => line.length > 1);
    return { distanceM, durationSec, steps, polylines };
  }

  async reverseGeocode(lat: number, lon: number): Promise<AmapCityResult | null> {
    const data = await this.getJson<AmapRegeoResp>('/v3/geocode/regeo', {
      location: `${lon},${lat}`,
      extensions: 'base',
    });
    if (data.status !== '1') {
      throw new Error(`高德逆地理编码失败: ${data.info ?? 'unknown'}`);
    }
    const comp = data.regeocode?.addressComponent;
    if (!comp) {
      return null;
    }
    const cityRaw = comp.city;
    const city =
      (Array.isArray(cityRaw) ? cityRaw[0] : cityRaw) || comp.province || comp.district || '';
    return {
      city: String(city).replace(/市$/, ''),
      province: String(comp.province ?? '').replace(/市$/, ''),
      district: String(comp.district ?? ''),
    };
  }
}
