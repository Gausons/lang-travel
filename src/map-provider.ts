export type MapProviderName = 'amap' | 'google' | (string & {});

export type MapNearbyPark = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
  address: string;
  type: string;
};

export type MapNearbySpot = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
  address: string;
  type: string;
  category: 'park' | 'attraction';
};

export type MapWalkingLeg = {
  distanceM: number;
  durationSec: number;
  steps: string[];
  polylines: Array<Array<[number, number]>>;
};

export type MapCityResult = {
  city: string;
  province: string;
  district: string;
};

export type MapHotelOption = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
  address: string;
  priceCny: number | null;
  rating: number | null;
};

export type MapProvider = {
  readonly name: MapProviderName;
  readonly displayName: string;
  readonly enabled: boolean;
  searchNearbyParks(
    lat: number,
    lon: number,
    radiusKm?: number,
    city?: string,
  ): Promise<MapNearbyPark[]>;
  searchNearbySpots(
    lat: number,
    lon: number,
    radiusKm?: number,
    city?: string,
    keywords?: string,
  ): Promise<MapNearbySpot[]>;
  searchNearbyHotels(
    lat: number,
    lon: number,
    radiusKm?: number,
    city?: string,
  ): Promise<MapHotelOption[]>;
  walkingRoute(
    originLat: number,
    originLon: number,
    destLat: number,
    destLon: number,
  ): Promise<MapWalkingLeg | null>;
  reverseGeocode(lat: number, lon: number): Promise<MapCityResult | null>;
};

export function isFilledSecret(value: string | undefined): value is string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return false;
  }
  return !/^(你的|your_|changeme|replace_me|xxx)/i.test(trimmed);
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
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
