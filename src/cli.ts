import { TravelPlannerAgent } from './planner.js';
import type { Prefer } from './types.js';

function parseArgv(argv: string[]): { command?: string; args: Record<string, string> } {
  const [command, ...rest] = argv;
  const args: Record<string, string> = {};

  let i = 0;
  while (i < rest.length) {
    const token = rest[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const val = rest[i + 1];
      if (!val || val.startsWith('--')) {
        args[key] = 'true';
        i += 1;
        continue;
      }
      args[key] = val;
      i += 2;
      continue;
    }
    i += 1;
  }

  return { command, args };
}

function requireArg(args: Record<string, string>, key: string): string {
  const value = args[key];
  if (!value) {
    throw new Error(`缺少参数 --${key}`);
  }
  return value;
}

function toNumber(value: string, key: string): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`参数 --${key} 不是有效数字`);
  }
  return num;
}

function printHelp(): void {
  console.log(`周边景点/公园规划 Agent (TypeScript)

用法:
  pnpm dev list [--city 上海]
  pnpm dev add --name 世纪公园 --category park --lat 31.22 --lon 121.54 --city 上海 [--tags 散步,绿地] [--avg-visit-min 90] [--score 4.7]
  pnpm dev parks --lat 31.2304 --lon 121.4737 [--radius-km 5]
  pnpm dev route --lat 31.2304 --lon 121.4737 --city 上海 [--hours 4] [--prefer mixed|park|attraction]
  pnpm dev chat --message "我想去散个步" --lat 31.2304 --lon 121.4737 --city 上海 [--radius-km 5] [--hours 4]`);
}

export function runCli(argv = process.argv.slice(2)): void {
  const agent = new TravelPlannerAgent();
  const { command, args } = parseArgv(argv);

  if (!command) {
    printHelp();
    return;
  }

  if (command === 'add') {
    const category = requireArg(args, 'category');
    if (category !== 'park' && category !== 'attraction') {
      throw new Error('参数 --category 只能是 park 或 attraction');
    }

    const place = agent.store.addPlace({
      name: requireArg(args, 'name'),
      category,
      lat: toNumber(requireArg(args, 'lat'), 'lat'),
      lon: toNumber(requireArg(args, 'lon'), 'lon'),
      city: requireArg(args, 'city'),
      tags: (args.tags ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      avgVisitMin: args['avg-visit-min'] ? toNumber(args['avg-visit-min'], 'avg-visit-min') : 60,
      score: args.score ? toNumber(args.score, 'score') : 4.5,
    });

    console.log(`已录入: ${place.name} (${place.id})`);
    return;
  }

  if (command === 'list') {
    const places = agent.store.listPlaces(args.city);
    if (places.length === 0) {
      console.log('暂无点位数据。');
      return;
    }

    for (const p of places) {
      console.log(`${p.id} | ${p.name} | ${p.category} | ${p.city} | (${p.lat}, ${p.lon}) | 评分${p.score} | 建议${p.avg_visit_min}分钟`);
    }
    return;
  }

  if (command === 'parks') {
    const lat = toNumber(requireArg(args, 'lat'), 'lat');
    const lon = toNumber(requireArg(args, 'lon'), 'lon');
    const radius = args['radius-km'] ? toNumber(args['radius-km'], 'radius-km') : 3;
    const parks = agent.findNearbyParks(lat, lon, radius, 5);

    if (parks.length === 0) {
      console.log('附近没有匹配公园。');
      return;
    }

    parks.forEach((item, i) => {
      console.log(`${i + 1}. ${item.place.name} | ${item.distanceKm.toFixed(2)}km | 评分${item.place.score}`);
    });
    return;
  }

  if (command === 'route') {
    const lat = toNumber(requireArg(args, 'lat'), 'lat');
    const lon = toNumber(requireArg(args, 'lon'), 'lon');
    const city = requireArg(args, 'city');
    const hours = args.hours ? toNumber(args.hours, 'hours') : 4;
    const prefer = (args.prefer ?? 'mixed') as Prefer;

    if (!['mixed', 'park', 'attraction'].includes(prefer)) {
      throw new Error('参数 --prefer 只能是 mixed|park|attraction');
    }

    const result = agent.planRoute(lat, lon, city, hours, prefer);
    console.log(result.summary);
    result.stops.forEach((stop, i) => {
      console.log(`${i + 1}. ${stop.name} | ${stop.category} | ${stop.distance_km}km | ${stop.travel_mode} ${stop.travel_min}分钟 + 游玩${stop.visit_min}分钟`);
    });
    console.log(`总时长约 ${result.total_minutes} 分钟。`);
    return;
  }

  if (command === 'chat') {
    const message = requireArg(args, 'message');
    const lat = toNumber(requireArg(args, 'lat'), 'lat');
    const lon = toNumber(requireArg(args, 'lon'), 'lon');
    const city = args.city ?? '';
    const hours = args.hours ? toNumber(args.hours, 'hours') : 4;
    const radiusKm = args['radius-km'] ? toNumber(args['radius-km'], 'radius-km') : 3;
    const prefer = (args.prefer ?? 'mixed') as Prefer;

    if (!['mixed', 'park', 'attraction'].includes(prefer)) {
      throw new Error('参数 --prefer 只能是 mixed|park|attraction');
    }

    const text = agent.chat(message, {
      lat,
      lon,
      city,
      hours,
      radius_km: radiusKm,
      prefer,
    });
    console.log(text);
    return;
  }

  printHelp();
}

