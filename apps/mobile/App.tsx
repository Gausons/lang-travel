import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { ExpoGaodeMapModule, MapView, Marker, Polyline } from 'expo-gaode-map';

import {
  API_BASE_URL,
  type AgentPlanResponse,
  type MobileConfigResponse,
  type MapSource,
  type ParkResult,
  type Place,
  type Prefer,
  type RouteResponse,
  type TravelContext,
  fetchAgentPlan,
  fetchMobileConfig,
  fetchParks,
  fetchPlaces,
  fetchRoute,
  reverseGeocode,
} from './src/api';

type Panel = 'places' | 'parks' | 'route' | 'agent';

type ContextForm = {
  lat: string;
  lon: string;
  city: string;
};

type LatLng = {
  latitude: number;
  longitude: number;
};

const DEFAULT_CONTEXT: TravelContext = {
  lat: 31.2304,
  lon: 121.4737,
  city: '',
};

const tabs: Array<{ id: Panel; label: string }> = [
  { id: 'places', label: '点位' },
  { id: 'parks', label: '公园' },
  { id: 'route', label: '路线' },
  { id: 'agent', label: 'Agent' },
];

function toContextForm(ctx: TravelContext): ContextForm {
  return {
    lat: ctx.lat.toFixed(6),
    lon: ctx.lon.toFixed(6),
    city: ctx.city,
  };
}

function normalizeCityName(name?: string): string {
  return String(name ?? '')
    .replace(/市$/, '')
    .trim();
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function positionOf(lat: number, lon: number): LatLng {
  return { latitude: lat, longitude: lon };
}

function routeSegments(ctx: TravelContext, route: RouteResponse | null): LatLng[][] {
  if (!route || route.stops.length === 0) {
    return [];
  }
  if (Array.isArray(route.routePolylines) && route.routePolylines.length > 0) {
    return route.routePolylines
      .map((line) =>
        line
          .map(([lon, lat]) => positionOf(Number(lat), Number(lon)))
          .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)),
      )
      .filter((line) => line.length > 1);
  }
  return [[positionOf(ctx.lat, ctx.lon), ...route.stops.map((stop) => positionOf(stop.lat, stop.lon))]];
}

function initializeGaodePrivacy(): void {
  try {
    const status = ExpoGaodeMapModule.getPrivacyStatus?.();
    if (!status?.isReady) {
      ExpoGaodeMapModule.setPrivacyConfig?.({
        hasShow: true,
        hasContainsPrivacy: true,
        hasAgree: true,
        privacyVersion: '2026-05-16',
      });
    }
  } catch {
    // The native module may not be available until a prebuild/dev-client runtime is used.
  }
}

export default function App() {
  const [contextForm, setContextForm] = useState<ContextForm>(toContextForm(DEFAULT_CONTEXT));
  const [config, setConfig] = useState<MobileConfigResponse | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [parks, setParks] = useState<ParkResult[]>([]);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [agentPlan, setAgentPlan] = useState<AgentPlanResponse | null>(null);
  const [activePanel, setActivePanel] = useState<Panel>('places');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<MapSource>('local');

  const [parkRadius, setParkRadius] = useState('5');
  const [routeHours, setRouteHours] = useState('4');
  const [prefer, setPrefer] = useState<Prefer>('mixed');
  const [agentDays, setAgentDays] = useState('2');
  const [agentHours, setAgentHours] = useState('6');
  const [agentBudget, setAgentBudget] = useState('3000');
  const [hotelBudget, setHotelBudget] = useState('600');
  const [interests, setInterests] = useState('公园,美食,地标');
  const [habits, setHabits] = useState('早起,步行可接受,地铁优先');

  const context = useMemo<TravelContext>(() => {
    const lat = Number(contextForm.lat);
    const lon = Number(contextForm.lon);
    return {
      lat: Number.isFinite(lat) ? lat : DEFAULT_CONTEXT.lat,
      lon: Number.isFinite(lon) ? lon : DEFAULT_CONTEXT.lon,
      city: contextForm.city.trim(),
    };
  }, [contextForm]);

  const mapCenter = useMemo(() => positionOf(context.lat, context.lon), [context.lat, context.lon]);
  const polylines = useMemo(() => routeSegments(context, route), [context, route]);

  useEffect(() => {
    initializeGaodePrivacy();
    void runTask('启动中', async () => {
      const [mobileConfig, placeResp] = await Promise.all([
        fetchMobileConfig(),
        fetchPlaces(context),
      ]);
      setConfig(mobileConfig);
      setPlaces(placeResp.places);
      setSource(placeResp.source);
    });
  }, []);

  function readContext(): TravelContext {
    const lat = Number(contextForm.lat);
    const lon = Number(contextForm.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error('请填写有效经纬度');
    }
    return {
      lat,
      lon,
      city: contextForm.city.trim(),
    };
  }

  async function runTask(label: string, task: () => Promise<void>): Promise<void> {
    setLoading(label);
    setError(null);
    try {
      await task();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      Alert.alert(label, message);
    } finally {
      setLoading(null);
    }
  }

  async function refreshPlaces(nextContext = readContext()): Promise<void> {
    const resp = await fetchPlaces(nextContext);
    setPlaces(resp.places);
    setSource(resp.source);
  }

  async function locateCurrent(): Promise<void> {
    await runTask('定位中', async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        throw new Error('定位权限未开启');
      }
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const lat = Number(current.coords.latitude.toFixed(6));
      const lon = Number(current.coords.longitude.toFixed(6));
      const regeo = await reverseGeocode({ lat, lon }).catch(() => null);
      const city = normalizeCityName(regeo?.city || regeo?.district || regeo?.province);
      const nextContext = { lat, lon, city };
      setContextForm(toContextForm(nextContext));
      await refreshPlaces(nextContext);
    });
  }

  async function queryParks(): Promise<void> {
    await runTask('查询公园', async () => {
      const radiusKm = Number(parkRadius || 5);
      const resp = await fetchParks(readContext(), Number.isFinite(radiusKm) ? radiusKm : 5);
      setParks(resp.parks);
      setSource(resp.source);
      setActivePanel('parks');
    });
  }

  async function generateRoute(): Promise<void> {
    await runTask('生成路线', async () => {
      const hours = Number(routeHours || 4);
      const result = await fetchRoute(readContext(), Number.isFinite(hours) ? hours : 4, prefer);
      setRoute(result);
      setSource(result.source ?? 'local');
      setActivePanel('route');
    });
  }

  async function generateAgentPlan(): Promise<void> {
    await runTask('Agent 规划', async () => {
      const result = await fetchAgentPlan(readContext(), {
        days: Math.max(1, Number(agentDays || 2)),
        dailyHours: Math.max(1, Number(agentHours || 6)),
        interests: splitList(interests),
        habits: splitList(habits),
        totalBudgetCny: Number(agentBudget || 3000),
        hotelBudgetPerNight: Number(hotelBudget || 600),
        prefer,
      });
      setAgentPlan(result);
      setRoute(result.route);
      setSource(result.route.source);
      setActivePanel('agent');
    });
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.mapArea}>
        <MapView
          key={`${mapCenter.latitude},${mapCenter.longitude}`}
          style={styles.map}
          initialCameraPosition={{ target: mapCenter, zoom: 13 }}
          myLocationEnabled
        >
          <Marker position={mapCenter} title="当前位置" pinColor="red" />
          {places.slice(0, 40).map((place) => (
            <Marker
              key={`place-${place.id}`}
              position={positionOf(place.lat, place.lon)}
              title={place.name}
              snippet={place.category}
              pinColor={place.category === 'park' ? 'green' : 'orange'}
            />
          ))}
          {parks.map((item) => (
            <Marker
              key={`park-${item.place.id}`}
              position={positionOf(item.place.lat, item.place.lon)}
              title={item.place.name}
              snippet={`${item.distanceKm.toFixed(2)}km`}
              pinColor="cyan"
            />
          ))}
          {route?.stops.map((stop, index) => (
            <Marker
              key={`route-${stop.name}-${index}`}
              position={positionOf(stop.lat, stop.lon)}
              title={`${index + 1}. ${stop.name}`}
              snippet={`${stop.travel_min}分钟路程`}
              pinColor="blue"
            />
          ))}
          {polylines.map((points, index) => (
            <Polyline
              key={`line-${index}`}
              points={points}
              strokeColor="#1677FF"
              strokeWidth={6}
              simplificationTolerance={2}
            />
          ))}
        </MapView>
        <View style={styles.statusBar}>
          <Text style={styles.statusText}>API {API_BASE_URL}</Text>
          <Text style={styles.statusPill}>数据 {source}</Text>
          <Text style={styles.statusPill}>{config?.aiPlanningEnabled ? 'AI on' : 'AI off'}</Text>
        </View>
      </View>

      <View style={styles.sheet}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Lang Travel</Text>
              <Text style={styles.subtitle}>地图式周边游玩 Agent</Text>
            </View>
            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color="#0F6EFF" />
                <Text style={styles.loadingText}>{loading}</Text>
              </View>
            ) : null}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.formBlock}>
            <View style={styles.formRow}>
              <Field
                label="纬度"
                value={contextForm.lat}
                onChangeText={(lat) => setContextForm((prev) => ({ ...prev, lat }))}
                keyboardType="decimal-pad"
              />
              <Field
                label="经度"
                value={contextForm.lon}
                onChangeText={(lon) => setContextForm((prev) => ({ ...prev, lon }))}
                keyboardType="decimal-pad"
              />
            </View>
            <Field
              label="城市"
              value={contextForm.city}
              onChangeText={(city) => setContextForm((prev) => ({ ...prev, city }))}
              placeholder="定位后回填"
            />
            <View style={styles.actionRow}>
              <ActionButton label="定位" onPress={locateCurrent} tone="secondary" />
              <ActionButton
                label="刷新点位"
                onPress={() => runTask('刷新点位', () => refreshPlaces())}
                tone="primary"
              />
            </View>
          </View>

          <View style={styles.tabs}>
            {tabs.map((tab) => (
              <Pressable
                key={tab.id}
                onPress={() => setActivePanel(tab.id)}
                style={[styles.tab, activePanel === tab.id && styles.tabActive]}
              >
                <Text style={[styles.tabText, activePanel === tab.id && styles.tabTextActive]}>
                  {tab.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {activePanel === 'places' ? (
            <PlacesPanel places={places} />
          ) : activePanel === 'parks' ? (
            <ParksPanel
              parks={parks}
              radius={parkRadius}
              onRadiusChange={setParkRadius}
              onQuery={queryParks}
            />
          ) : activePanel === 'route' ? (
            <RoutePanel
              route={route}
              hours={routeHours}
              prefer={prefer}
              onHoursChange={setRouteHours}
              onPreferChange={setPrefer}
              onGenerate={generateRoute}
            />
          ) : (
            <AgentPanel
              plan={agentPlan}
              days={agentDays}
              dailyHours={agentHours}
              budget={agentBudget}
              hotelBudget={hotelBudget}
              interests={interests}
              habits={habits}
              onDaysChange={setAgentDays}
              onDailyHoursChange={setAgentHours}
              onBudgetChange={setAgentBudget}
              onHotelBudgetChange={setHotelBudget}
              onInterestsChange={setInterests}
              onHabitsChange={setHabits}
              onGenerate={generateAgentPlan}
            />
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        keyboardType={props.keyboardType ?? 'default'}
        style={styles.input}
        placeholderTextColor="#8190A6"
      />
    </View>
  );
}

function ActionButton(props: {
  label: string;
  onPress: () => void | Promise<void>;
  tone?: 'primary' | 'secondary';
}) {
  const isSecondary = props.tone === 'secondary';
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        isSecondary && styles.buttonSecondary,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={[styles.buttonText, isSecondary && styles.buttonSecondaryText]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

function EmptyState({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

function PlacesPanel({ places }: { places: Place[] }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>已加载点位 ({places.length})</Text>
      {places.length === 0 ? <EmptyState text="暂无点位" /> : null}
      {places.slice(0, 12).map((place) => (
        <View key={place.id} style={styles.resultRow}>
          <View style={[styles.dot, place.category === 'park' ? styles.dotGreen : styles.dotAmber]} />
          <View style={styles.resultMain}>
            <Text style={styles.resultTitle}>{place.name}</Text>
            <Text style={styles.resultMeta}>
              {place.city || '未知'} · {place.category} · {place.lat.toFixed(4)}, {place.lon.toFixed(4)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function ParksPanel(props: {
  parks: ParkResult[];
  radius: string;
  onRadiusChange: (value: string) => void;
  onQuery: () => void | Promise<void>;
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.formRow}>
        <Field
          label="半径(km)"
          value={props.radius}
          onChangeText={props.onRadiusChange}
          keyboardType="decimal-pad"
        />
        <ActionButton label="查找" onPress={props.onQuery} />
      </View>
      {props.parks.length === 0 ? <EmptyState text="暂无附近公园结果" /> : null}
      {props.parks.map((item) => (
        <View key={item.place.id} style={styles.resultRow}>
          <View style={[styles.dot, styles.dotCyan]} />
          <View style={styles.resultMain}>
            <Text style={styles.resultTitle}>{item.place.name}</Text>
            <Text style={styles.resultMeta}>
              {item.distanceKm.toFixed(2)}km · {item.address || item.place.city || '未知位置'}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function PreferPicker(props: { prefer: Prefer; onChange: (value: Prefer) => void }) {
  const options: Prefer[] = ['mixed', 'park', 'attraction'];
  return (
    <View style={styles.preferPicker}>
      {options.map((item) => (
        <Pressable
          key={item}
          onPress={() => props.onChange(item)}
          style={[styles.preferOption, props.prefer === item && styles.preferOptionActive]}
        >
          <Text
            style={[
              styles.preferOptionText,
              props.prefer === item && styles.preferOptionTextActive,
            ]}
          >
            {item}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function RoutePanel(props: {
  route: RouteResponse | null;
  hours: string;
  prefer: Prefer;
  onHoursChange: (value: string) => void;
  onPreferChange: (value: Prefer) => void;
  onGenerate: () => void | Promise<void>;
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.formRow}>
        <Field
          label="时长(h)"
          value={props.hours}
          onChangeText={props.onHoursChange}
          keyboardType="decimal-pad"
        />
        <ActionButton label="生成" onPress={props.onGenerate} />
      </View>
      <PreferPicker prefer={props.prefer} onChange={props.onPreferChange} />
      {!props.route ? <EmptyState text="暂无路线结果" /> : null}
      {props.route ? (
        <View style={styles.summaryBox}>
          <Text style={styles.summaryText}>{props.route.summary}</Text>
          <Text style={styles.summaryMeta}>总时长约 {props.route.total_minutes} 分钟</Text>
          {props.route.warning ? <Text style={styles.warning}>{props.route.warning}</Text> : null}
        </View>
      ) : null}
      {props.route?.stops.map((stop, index) => (
        <View key={`${stop.name}-${index}`} style={styles.resultRow}>
          <Text style={styles.step}>{index + 1}</Text>
          <View style={styles.resultMain}>
            <Text style={styles.resultTitle}>{stop.name}</Text>
            <Text style={styles.resultMeta}>
              {stop.distance_km}km · {stop.travel_min}分钟路程 · 游玩{stop.visit_min}分钟
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function AgentPanel(props: {
  plan: AgentPlanResponse | null;
  days: string;
  dailyHours: string;
  budget: string;
  hotelBudget: string;
  interests: string;
  habits: string;
  onDaysChange: (value: string) => void;
  onDailyHoursChange: (value: string) => void;
  onBudgetChange: (value: string) => void;
  onHotelBudgetChange: (value: string) => void;
  onInterestsChange: (value: string) => void;
  onHabitsChange: (value: string) => void;
  onGenerate: () => void | Promise<void>;
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.formRow}>
        <Field label="天数" value={props.days} onChangeText={props.onDaysChange} keyboardType="number-pad" />
        <Field
          label="每日(h)"
          value={props.dailyHours}
          onChangeText={props.onDailyHoursChange}
          keyboardType="decimal-pad"
        />
      </View>
      <View style={styles.formRow}>
        <Field
          label="总预算"
          value={props.budget}
          onChangeText={props.onBudgetChange}
          keyboardType="number-pad"
        />
        <Field
          label="酒店/晚"
          value={props.hotelBudget}
          onChangeText={props.onHotelBudgetChange}
          keyboardType="number-pad"
        />
      </View>
      <Field label="偏好标签" value={props.interests} onChangeText={props.onInterestsChange} />
      <Field label="用户习惯" value={props.habits} onChangeText={props.onHabitsChange} />
      <ActionButton label="一键自主规划" onPress={props.onGenerate} />
      {!props.plan ? <EmptyState text="暂无 Agent 规划结果" /> : null}
      {props.plan ? (
        <View style={styles.summaryBox}>
          <Text style={styles.summaryText}>{props.plan.summary}</Text>
          <Text style={styles.summaryMeta}>
            {props.plan.route.stops.length} 个游玩点 · {props.plan.hotels.length} 家酒店
          </Text>
        </View>
      ) : null}
      {props.plan?.hotels.slice(0, 5).map((hotel) => (
        <View key={hotel.hotelKey} style={styles.resultRow}>
          <Text style={styles.step}>{hotel.rank}</Text>
          <View style={styles.resultMain}>
            <Text style={styles.resultTitle}>{hotel.name}</Text>
            <Text style={styles.resultMeta}>
              {hotel.bestPriceCny ? `¥${hotel.bestPriceCny}` : '价格待确认'} · 评分
              {hotel.rating ?? 'N/A'} · {hotel.distanceKm}km
            </Text>
          </View>
        </View>
      ))}
      {props.plan?.executionTrace.map((trace) => (
        <Text key={trace} style={styles.trace}>
          {trace}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F4F7FB',
  },
  mapArea: {
    flex: 1,
    minHeight: 280,
    backgroundColor: '#DDE8F5',
  },
  map: {
    flex: 1,
  },
  statusBar: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.94)',
    color: '#2A3C55',
    fontSize: 11,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusPill: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.94)',
    color: '#2A3C55',
    fontSize: 11,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  sheet: {
    flex: 1,
    maxHeight: '55%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderColor: '#DDE5F0',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#172236',
  },
  subtitle: {
    marginTop: 2,
    fontSize: 13,
    color: '#5E6F86',
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  loadingText: {
    color: '#315481',
    fontSize: 12,
  },
  error: {
    marginBottom: 10,
    color: '#A33131',
    backgroundColor: '#FFEDED',
    borderRadius: 8,
    padding: 10,
    fontSize: 12,
  },
  formBlock: {
    gap: 8,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  field: {
    flex: 1,
    gap: 4,
  },
  fieldLabel: {
    fontSize: 12,
    color: '#607089',
  },
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#D4DEEA',
    borderRadius: 8,
    paddingHorizontal: 10,
    color: '#172236',
    backgroundColor: '#F8FAFD',
    fontSize: 14,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    minHeight: 42,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#0F6EFF',
    paddingHorizontal: 14,
  },
  buttonSecondary: {
    backgroundColor: '#EEF4FF',
    borderWidth: 1,
    borderColor: '#C9DAF8',
  },
  buttonPressed: {
    opacity: 0.76,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonSecondaryText: {
    color: '#215CB0',
  },
  tabs: {
    marginTop: 14,
    marginBottom: 12,
    padding: 4,
    borderRadius: 9,
    backgroundColor: '#EDF2F7',
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
  },
  tabActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D7E1ED',
  },
  tabText: {
    color: '#667891',
    fontSize: 13,
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#172236',
  },
  panel: {
    gap: 10,
    paddingBottom: 28,
  },
  panelTitle: {
    fontSize: 16,
    color: '#172236',
    fontWeight: '800',
  },
  empty: {
    color: '#6D7E95',
    fontSize: 13,
    paddingVertical: 12,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F7',
    paddingBottom: 10,
  },
  resultMain: {
    flex: 1,
  },
  resultTitle: {
    color: '#172236',
    fontSize: 14,
    fontWeight: '700',
  },
  resultMeta: {
    color: '#63758D',
    fontSize: 12,
    marginTop: 3,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotGreen: {
    backgroundColor: '#2EAD6B',
  },
  dotAmber: {
    backgroundColor: '#D9822B',
  },
  dotCyan: {
    backgroundColor: '#16A3B8',
  },
  step: {
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0F6EFF',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '800',
    fontSize: 12,
  },
  preferPicker: {
    flexDirection: 'row',
    gap: 8,
  },
  preferOption: {
    flex: 1,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#F0F4F8',
    borderWidth: 1,
    borderColor: '#DCE5EF',
  },
  preferOptionActive: {
    backgroundColor: '#E8F6EF',
    borderColor: '#7CC89E',
  },
  preferOptionText: {
    color: '#61728A',
    fontSize: 12,
    fontWeight: '700',
  },
  preferOptionTextActive: {
    color: '#1F7A4D',
  },
  summaryBox: {
    borderWidth: 1,
    borderColor: '#DCE5EF',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#F8FBFE',
  },
  summaryText: {
    color: '#172236',
    fontSize: 14,
    fontWeight: '700',
  },
  summaryMeta: {
    color: '#5E6F86',
    fontSize: 12,
    marginTop: 5,
  },
  warning: {
    color: '#9A5B00',
    fontSize: 12,
    marginTop: 6,
  },
  trace: {
    color: '#687A91',
    fontSize: 11,
    borderLeftWidth: 2,
    borderLeftColor: '#C9D6E5',
    paddingLeft: 8,
  },
});
