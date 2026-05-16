import { haversineKm, isFilledSecret } from './map-provider.js';
import type {
  MapCityResult,
  MapHotelOption,
  MapNearbyPark,
  MapNearbySpot,
  MapProvider,
  MapWalkingLeg,
} from './map-provider.js';

type GoogleLatLng = {
  latitude?: number;
  longitude?: number;
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: GoogleLatLng;
  types?: string[];
  rating?: number;
};

type GoogleNearbyResp = {
  places?: GooglePlace[];
  error?: { message?: string };
};

type GoogleRouteStep = {
  distanceMeters?: number;
  staticDuration?: string;
  navigationInstruction?: { instructions?: string };
  polyline?: { encodedPolyline?: string };
};

type GoogleRoute = {
  distanceMeters?: number;
  duration?: string;
  polyline?: { encodedPolyline?: string };
  legs?: Array<{ steps?: GoogleRouteStep[] }>;
};

type GoogleRoutesResp = {
  routes?: GoogleRoute[];
  error?: { message?: string };
};

type GoogleGeocodeResp = {
  status?: string;
  error_message?: string;
  results?: Array<{
    address_components?: Array<{
      long_name?: string;
      short_name?: string;
      types?: string[];
    }>;
  }>;
};

function parseDurationSeconds(value?: string): number {
  if (!value) {
    return 0;
  }
  const n = Number(value.replace(/s$/, ''));
  return Number.isFinite(n) ? n : 0;
}

function decodePolyline(encoded?: string): Array<[number, number]> {
  if (!encoded) {
    return [];
  }

  const points: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lon / 1e5, lat / 1e5]);
  }

  return points;
}

function categoryFor(types: string[] | undefined, keywords?: string): 'park' | 'attraction' {
  const joined = `${types?.join(',') ?? ''},${keywords ?? ''}`;
  return /park|公园/i.test(joined) ? 'park' : 'attraction';
}

function includedTypesFor(keywords?: string): string[] {
  const text = keywords ?? '';
  if (/公园|park/i.test(text)) {
    return ['park'];
  }
  if (/酒店|hotel|lodging/i.test(text)) {
    return ['lodging'];
  }
  if (/博物馆|museum/i.test(text)) {
    return ['museum'];
  }
  if (/美食|吃|餐厅|restaurant|food/i.test(text)) {
    return ['restaurant'];
  }
  return ['tourist_attraction'];
}

function pickAddressComponent(
  components: NonNullable<GoogleGeocodeResp['results']>[number]['address_components'],
  types: string[],
): string {
  const found = components?.find((item) => types.some((type) => item.types?.includes(type)));
  return found?.long_name ?? found?.short_name ?? '';
}

export class GoogleMapsClient implements MapProvider {
  readonly name = 'google';
  readonly displayName = 'Google Maps';
  private readonly key?: string;
  private readonly placesBase = 'https://places.googleapis.com/v1';
  private readonly routesBase = 'https://routes.googleapis.com/directions/v2';
  private readonly geocodeBase = 'https://maps.googleapis.com/maps/api/geocode/json';

  constructor(key = process.env.GOOGLE_MAPS_API_KEY) {
    this.key = isFilledSecret(key) ? key : undefined;
  }

  get enabled(): boolean {
    return Boolean(this.key);
  }

  private ensureKey(): string {
    if (!this.key) {
      throw new Error('未配置 GOOGLE_MAPS_API_KEY');
    }
    return this.key;
  }

  private async postJson<T>(url: string, body: unknown, fieldMask: string): Promise<T> {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': this.ensureKey(),
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify(body),
    });
    const data = (await resp.json()) as T & { error?: { message?: string } };
    if (!resp.ok) {
      throw new Error(`Google Maps 请求失败: ${data.error?.message ?? resp.status}`);
    }
    return data as T;
  }

  private async getJson<T>(url: string, params: Record<string, string>): Promise<T> {
    const query = new URLSearchParams({ ...params, key: this.ensureKey() }).toString();
    const resp = await fetch(`${url}?${query}`);
    const data = (await resp.json()) as T & { status?: string; error_message?: string };
    if (!resp.ok) {
      throw new Error(`Google Maps 请求失败: ${resp.status}`);
    }
    return data as T;
  }

  async searchNearbyParks(
    lat: number,
    lon: number,
    radiusKm = 3,
    city?: string,
  ): Promise<MapNearbyPark[]> {
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
    _city?: string,
    keywords = '景点',
  ): Promise<MapNearbySpot[]> {
    const radius = Math.min(50000, Math.max(500, Math.round(radiusKm * 1000)));
    const data = await this.postJson<GoogleNearbyResp>(
      `${this.placesBase}/places:searchNearby`,
      {
        includedTypes: includedTypesFor(keywords),
        maxResultCount: 20,
        rankPreference: 'DISTANCE',
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lon },
            radius,
          },
        },
      },
      'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating',
    );

    return (data.places ?? [])
      .map((place): MapNearbySpot | null => {
        const pLat = place.location?.latitude;
        const pLon = place.location?.longitude;
        const name = place.displayName?.text;
        if (!name || pLat === undefined || pLon === undefined) {
          return null;
        }
        return {
          id: place.id ?? `google_${name}_${pLat}_${pLon}`,
          name,
          lat: pLat,
          lon: pLon,
          distanceKm: Number(haversineKm(lat, lon, pLat, pLon).toFixed(2)),
          address: place.formattedAddress ?? '',
          type: (place.types ?? []).join('|'),
          category: categoryFor(place.types, keywords),
        };
      })
      .filter((x): x is MapNearbySpot => Boolean(x));
  }

  async searchNearbyHotels(
    lat: number,
    lon: number,
    radiusKm = 5,
    city?: string,
  ): Promise<MapHotelOption[]> {
    const hotels = await this.searchNearbySpots(lat, lon, radiusKm, city, '酒店');
    return hotels.map((h) => ({
      id: h.id,
      name: h.name,
      lat: h.lat,
      lon: h.lon,
      distanceKm: h.distanceKm,
      address: h.address,
      priceCny: null,
      rating: null,
    }));
  }

  async walkingRoute(
    originLat: number,
    originLon: number,
    destLat: number,
    destLon: number,
  ): Promise<MapWalkingLeg | null> {
    const data = await this.postJson<GoogleRoutesResp>(
      `${this.routesBase}:computeRoutes`,
      {
        origin: { location: { latLng: { latitude: originLat, longitude: originLon } } },
        destination: { location: { latLng: { latitude: destLat, longitude: destLon } } },
        travelMode: 'WALK',
        computeAlternativeRoutes: false,
        polylineEncoding: 'ENCODED_POLYLINE',
      },
      'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.steps.navigationInstruction.instructions,routes.legs.steps.polyline.encodedPolyline',
    );
    const route = data.routes?.[0];
    if (!route) {
      return null;
    }
    const stepLines =
      route.legs
        ?.flatMap((leg) => leg.steps ?? [])
        .map((step) => decodePolyline(step.polyline?.encodedPolyline))
        .filter((line) => line.length > 1) ?? [];
    const routeLine = decodePolyline(route.polyline?.encodedPolyline);
    const polylines = stepLines.length > 0 ? stepLines : routeLine.length > 1 ? [routeLine] : [];
    const steps =
      route.legs
        ?.flatMap((leg) => leg.steps ?? [])
        .map((step) => step.navigationInstruction?.instructions ?? '')
        .filter(Boolean) ?? [];
    return {
      distanceM: route.distanceMeters ?? 0,
      durationSec: parseDurationSeconds(route.duration),
      steps,
      polylines,
    };
  }

  async reverseGeocode(lat: number, lon: number): Promise<MapCityResult | null> {
    const data = await this.getJson<GoogleGeocodeResp>(this.geocodeBase, {
      latlng: `${lat},${lon}`,
      language: 'zh-CN',
    });
    if (data.status !== 'OK') {
      throw new Error(`Google Maps 逆地理编码失败: ${data.error_message ?? data.status ?? 'unknown'}`);
    }
    const components = data.results?.[0]?.address_components;
    if (!components) {
      return null;
    }
    const city =
      pickAddressComponent(components, ['locality', 'postal_town']) ||
      pickAddressComponent(components, ['administrative_area_level_2']) ||
      pickAddressComponent(components, ['administrative_area_level_1']);
    const province = pickAddressComponent(components, ['administrative_area_level_1']);
    const district =
      pickAddressComponent(components, ['sublocality', 'sublocality_level_1']) ||
      pickAddressComponent(components, ['administrative_area_level_3']);
    return {
      city: city.replace(/市$/, ''),
      province: province.replace(/市$/, ''),
      district,
    };
  }
}
