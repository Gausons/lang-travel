import { AmapClient } from './amap.js';
import { GoogleMapsClient } from './google-maps.js';
import type { MapProvider, MapProviderName } from './map-provider.js';

export type MapProviderFactory = () => MapProvider;

const factories: Record<string, MapProviderFactory> = {
  amap: () => new AmapClient(),
  google: () => new GoogleMapsClient(),
};

export function registerMapProvider(name: MapProviderName, factory: MapProviderFactory): void {
  factories[name] = factory;
}

export function listMapProviderNames(): string[] {
  return Object.keys(factories);
}

export function createMapProvider(name = process.env.MAP_PROVIDER ?? 'amap'): MapProvider {
  const providerName = name.trim().toLowerCase();
  const factory = factories[providerName];
  if (!factory) {
    throw new Error(
      `未知地图服务商: ${name}。可用服务商: ${listMapProviderNames().join(', ')}`,
    );
  }
  return factory();
}
