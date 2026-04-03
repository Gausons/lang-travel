export type Category = 'park' | 'attraction';
export type Prefer = 'mixed' | 'park' | 'attraction';

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

export type RouteResult = {
  summary: string;
  stops: RouteStop[];
  total_minutes: number;
};
