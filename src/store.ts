import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Category, Place } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
export const DATA_FILE = path.join(DATA_DIR, 'places.json');

export class PlaceStore {
  private readonly filePath: string;

  constructor(filePath: string = DATA_FILE) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.seed();
    }
  }

  private seed(): void {
    const now = new Date().toISOString();
    const places: Place[] = [
      {
        id: 'p_001',
        name: '世纪公园',
        category: 'park',
        lat: 31.2214,
        lon: 121.5442,
        city: '上海',
        tags: ['散步', '绿地', '亲子'],
        avg_visit_min: 90,
        score: 4.7,
        created_at: now,
      },
      {
        id: 'p_002',
        name: '鲁迅公园',
        category: 'park',
        lat: 31.2797,
        lon: 121.4838,
        city: '上海',
        tags: ['散步', '晨练', '本地'],
        avg_visit_min: 60,
        score: 4.5,
        created_at: now,
      },
      {
        id: 'a_001',
        name: '外滩',
        category: 'attraction',
        lat: 31.24,
        lon: 121.49,
        city: '上海',
        tags: ['地标', '夜景', '拍照'],
        avg_visit_min: 80,
        score: 4.8,
        created_at: now,
      },
      {
        id: 'a_002',
        name: '豫园',
        category: 'attraction',
        lat: 31.2273,
        lon: 121.4925,
        city: '上海',
        tags: ['历史', '园林', '美食'],
        avg_visit_min: 100,
        score: 4.6,
        created_at: now,
      },
    ];

    this.save(places);
  }

  private load(): Place[] {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }
    const raw = fs.readFileSync(this.filePath, 'utf-8');
    return JSON.parse(raw) as Place[];
  }

  private save(places: Place[]): void {
    fs.writeFileSync(this.filePath, JSON.stringify(places, null, 2), 'utf-8');
  }

  addPlace(input: {
    name: string;
    category: Category;
    lat: number;
    lon: number;
    city: string;
    tags?: string[];
    avgVisitMin?: number;
    score?: number;
  }): Place {
    const places = this.load();
    const prefix = input.category === 'park' ? 'p' : 'a';
    const count = places.filter((p) => p.id.startsWith(`${prefix}_`)).length + 1;

    const place: Place = {
      id: `${prefix}_${String(count).padStart(3, '0')}`,
      name: input.name,
      category: input.category,
      lat: input.lat,
      lon: input.lon,
      city: input.city,
      tags: input.tags ?? [],
      avg_visit_min: input.avgVisitMin ?? 60,
      score: input.score ?? 4.5,
      created_at: new Date().toISOString(),
    };

    places.push(place);
    this.save(places);
    return place;
  }

  listPlaces(city?: string): Place[] {
    const places = this.load();
    if (!city) {
      return places;
    }
    return places.filter((p) => p.city === city);
  }
}

