const $ = (id) => document.getElementById(id);

const state = {
  map: null,
  amapReady: false,
  placeMarkers: [],
  parkMarkers: [],
  routeMarkers: [],
  routeLines: [],
  myMarker: null,
  source: 'local',
};

function getCtx() {
  return {
    lat: Number($('ctx-lat').value),
    lon: Number($('ctx-lon').value),
    city: $('ctx-city').value.trim(),
  };
}

function setCtx(lat, lon, city) {
  $('ctx-lat').value = String(lat);
  $('ctx-lon').value = String(lon);
  if (city) {
    $('ctx-city').value = city;
  }
}

function setChip(id, text) {
  $(id).textContent = text;
}

async function api(url, options) {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || '请求失败');
  }
  return data;
}

function loadAmapSdk(key, securityJsCode) {
  return new Promise((resolve, reject) => {
    if (!key) {
      reject(new Error('未配置 AMAP_JS_KEY 或 AMAP_KEY'));
      return;
    }
    if (window.AMap) {
      resolve(window.AMap);
      return;
    }

    if (securityJsCode) {
      window._AMapSecurityConfig = { securityJsCode };
    }
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(
      key,
    )}&plugin=AMap.Scale,AMap.ToolBar`;
    script.async = true;
    script.onload = () => resolve(window.AMap);
    script.onerror = () => reject(new Error('高德 JS SDK 加载失败'));
    document.head.appendChild(script);
  });
}

function clearOverlays(listName) {
  const list = state[listName];
  list.forEach((ov) => state.map && state.map.remove(ov));
  state[listName] = [];
}

function ensureMyMarker(lat, lon) {
  if (!state.map || !window.AMap) {
    return;
  }
  if (state.myMarker) {
    state.myMarker.setPosition([lon, lat]);
    return;
  }
  state.myMarker = new window.AMap.Marker({
    position: [lon, lat],
    title: '当前位置',
    zIndex: 200,
    icon: 'https://a.amap.com/jsapi_demos/static/demo-center/icons/poi-marker-red.png',
  });
  state.map.add(state.myMarker);
}

function centerMap(lat, lon, zoom = 14) {
  if (!state.map) {
    return;
  }
  state.map.setZoomAndCenter(zoom, [lon, lat]);
}

async function initMap() {
  const cfg = await api('/api/client-config');
  try {
    await loadAmapSdk(cfg.amapJsKey, cfg.amapSecurityJsCode);
    state.amapReady = true;
    setChip('chip-map', '地图: 高德 JS');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setChip('chip-map', `地图: 未启用 (${msg})`);
    throw e;
  }

  const { lat, lon } = getCtx();
  state.map = new window.AMap.Map('map', {
    zoom: 13,
    center: [lon, lat],
    viewMode: '2D',
    mapStyle: 'amap://styles/normal',
  });
  state.map.addControl(new window.AMap.Scale());
  state.map.addControl(new window.AMap.ToolBar());
  ensureMyMarker(lat, lon);
}

async function locateCurrent() {
  const explainGeoError = (err) => {
    if (!err) {
      return '未知定位错误';
    }
    if (typeof err.code === 'number') {
      if (err.code === 1) {
        return '定位权限被拒绝，请在浏览器地址栏中允许定位权限';
      }
      if (err.code === 2) {
        return '当前设备无法获取位置更新（Position update is unavailable）';
      }
      if (err.code === 3) {
        return '定位超时，请检查网络或稍后重试';
      }
    }
    const msg = String(err.message || err);
    if (/Position update is unavailable/i.test(msg)) {
      return '当前设备无法获取位置更新（Position update is unavailable）';
    }
    return msg;
  };

  const applyLocation = (lat, lon) => {
    setCtx(lat, lon);
    ensureMyMarker(lat, lon);
    centerMap(lat, lon, 15);
  };

  const locateByWatch = async () =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('浏览器不支持定位'));
        return;
      }
      let done = false;
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          if (done) {
            return;
          }
          done = true;
          navigator.geolocation.clearWatch(watchId);
          resolve(position);
        },
        (err) => {
          if (done) {
            return;
          }
          done = true;
          navigator.geolocation.clearWatch(watchId);
          reject(err);
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        },
      );
      setTimeout(() => {
        if (!done) {
          done = true;
          navigator.geolocation.clearWatch(watchId);
          reject(new Error('watchPosition timeout'));
        }
      }, 17000);
    });

  const fallbackByAmap = async () => {
    if (!state.map || !window.AMap) {
      throw new Error('浏览器定位失败，且高德地图未初始化。');
    }
    const result = await new Promise((resolve, reject) => {
      window.AMap.plugin('AMap.Geolocation', () => {
        const geolocation = new window.AMap.Geolocation({
          enableHighAccuracy: true,
          timeout: 10000,
          zoomToAccuracy: false,
        });
        geolocation.getCurrentPosition((status, res) => {
          if (status === 'complete' && res?.position) {
            resolve(res.position);
          } else {
            reject(
              new Error(
                `高德定位失败: ${res?.message || '请检查浏览器定位权限或系统定位服务'}`,
              ),
            );
          }
        });
      });
    });
    const lat = Number(result.lat.toFixed(6));
    const lon = Number(result.lng.toFixed(6));
    applyLocation(lat, lon);
  };

  const fallbackByCitySearch = async () => {
    if (!state.map || !window.AMap) {
      throw new Error('地图未初始化');
    }
    const localCity = await new Promise((resolve, reject) => {
      window.AMap.plugin('AMap.CitySearch', () => {
        const citySearch = new window.AMap.CitySearch();
        citySearch.getLocalCity((status, result) => {
          if (status === 'complete' && result?.city && result?.bounds) {
            resolve(result);
          } else {
            reject(new Error(result?.info || '无法获取本地城市'));
          }
        });
      });
    });

    const center = localCity.bounds.getCenter();
    const lat = Number(center.lat.toFixed(6));
    const lon = Number(center.lng.toFixed(6));
    setCtx(lat, lon, localCity.city);
    ensureMyMarker(lat, lon);
    centerMap(lat, lon, 12);
    setChip('chip-locate', `定位: 城市级(${localCity.city})`);
  };

  try {
    // 先尝试持续监听，通常比 getCurrentPosition 更容易拿到首个有效结果
    const watchPos = await locateByWatch();
    const lat = Number(watchPos.coords.latitude.toFixed(6));
    const lon = Number(watchPos.coords.longitude.toFixed(6));
    applyLocation(lat, lon);
    setChip('chip-locate', '定位: 浏览器GPS');
    return;
  } catch (err) {
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        });
      });
      const lat = Number(position.coords.latitude.toFixed(6));
      const lon = Number(position.coords.longitude.toFixed(6));
      applyLocation(lat, lon);
      setChip('chip-locate', '定位: 浏览器GPS');
      return;
    } catch {
      // ignore
    }

    try {
      await fallbackByAmap();
      setChip('chip-locate', '定位: 高德精准');
    } catch (amapErr) {
      try {
        await fallbackByCitySearch();
      } catch {
        const browserMsg = explainGeoError(err);
        const amapMsg = amapErr?.message ? String(amapErr.message) : '高德精准定位不可用';
        setChip('chip-locate', '定位: 失败');
        throw new Error(
          `定位失败: ${browserMsg}；${amapMsg}。请开启系统定位服务，或手动输入坐标。`,
        );
      }
    }
  }
}

async function refreshPlaces() {
  const { city } = getCtx();
  const qs = city ? `?city=${encodeURIComponent(city)}` : '';
  const { places } = await api(`/api/places${qs}`);

  const body = $('place-body');
  body.innerHTML = '';
  for (const p of places) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.name}</td>
      <td>${p.category}</td>
      <td>${p.city}</td>
      <td>${p.lat}, ${p.lon}</td>
    `;
    body.appendChild(tr);
  }

  if (!state.map || !window.AMap) {
    return;
  }
  clearOverlays('placeMarkers');
  state.placeMarkers = places.map(
    (p) =>
      new window.AMap.Marker({
        position: [p.lon, p.lat],
        title: p.name,
        label: { content: p.name, direction: 'top' },
      }),
  );
  state.map.add(state.placeMarkers);
}

async function addPlace() {
  const payload = {
    name: $('add-name').value.trim(),
    category: $('add-category').value,
    lat: Number($('add-lat').value),
    lon: Number($('add-lon').value),
    city: $('add-city').value.trim() || getCtx().city,
    tags: $('add-tags')
      .value.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    avgVisitMin: Number($('add-visit').value || 60),
    score: Number($('add-score').value || 4.5),
  };
  const { place } = await api('/api/places', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  $('add-msg').textContent = `已录入 ${place.name}`;
  await refreshPlaces();
}

async function queryParks() {
  const { lat, lon, city } = getCtx();
  const radiusKm = Number($('park-radius').value || 5);
  const res = await api(
    `/api/parks?lat=${lat}&lon=${lon}&city=${encodeURIComponent(
      city,
    )}&radiusKm=${radiusKm}`,
  );
  state.source = res.source || 'local';
  setChip('chip-source', `数据源: ${state.source}`);

  const ul = $('parks-result');
  ul.innerHTML = '';
  for (const item of res.parks) {
    const li = document.createElement('li');
    li.textContent = `${item.place.name} - ${item.distanceKm.toFixed(2)}km`;
    ul.appendChild(li);
  }

  if (!state.map || !window.AMap) {
    return;
  }
  clearOverlays('parkMarkers');
  state.parkMarkers = res.parks.map(
    (item) =>
      new window.AMap.Marker({
        position: [item.place.lon, item.place.lat],
        title: item.place.name,
        icon: 'https://a.amap.com/jsapi_demos/static/demo-center/icons/poi-marker-default.png',
      }),
  );
  state.map.add(state.parkMarkers);
}

function drawRoutePolyline(points) {
  if (!state.map || !window.AMap || points.length < 2) {
    return;
  }
  const line = new window.AMap.Polyline({
    path: points,
    strokeColor: '#1975ff',
    strokeWeight: 6,
    strokeOpacity: 0.85,
    lineCap: 'round',
    lineJoin: 'round',
  });
  state.map.add(line);
  state.routeLines.push(line);
}

async function planRoute() {
  const { lat, lon, city } = getCtx();
  const hours = Number($('route-hours').value || 4);
  const prefer = $('route-prefer').value;
  const result = await api(
    `/api/route?lat=${lat}&lon=${lon}&city=${encodeURIComponent(
      city,
    )}&hours=${hours}&prefer=${prefer}`,
  );
  state.source = result.source || 'local';
  setChip('chip-source', `数据源: ${state.source}`);

  const lines = [result.summary];
  result.stops.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.name} ${s.distance_km}km ${s.travel_min}分钟`);
  });
  lines.push(`总时长约 ${result.total_minutes} 分钟。`);
  if (result.warning) {
    lines.push(`提示: ${result.warning}`);
  }
  $('route-result').textContent = lines.join('\n');

  if (!state.map || !window.AMap) {
    return;
  }
  clearOverlays('routeMarkers');
  clearOverlays('routeLines');
  const routePoints = [[lon, lat]];
  result.stops.forEach((s, idx) => {
    routePoints.push([s.lon, s.lat]);
    const marker = new window.AMap.Marker({
      position: [s.lon, s.lat],
      title: `${idx + 1}. ${s.name}`,
      label: { content: `${idx + 1}`, direction: 'top' },
      icon: 'https://a.amap.com/jsapi_demos/static/demo-center/icons/poi-marker-blue.png',
    });
    state.routeMarkers.push(marker);
  });
  state.map.add(state.routeMarkers);
  drawRoutePolyline(routePoints);
  state.map.setFitView([state.myMarker, ...state.routeMarkers, ...state.routeLines], false, [
    80, 60, 260, 60,
  ]);
}

function bind() {
  $('btn-locate').addEventListener('click', () =>
    locateCurrent().catch((e) => alert(e.message)),
  );
  $('btn-refresh').addEventListener('click', () =>
    refreshPlaces().catch((e) => alert(e.message)),
  );
  $('btn-add').addEventListener('click', () =>
    addPlace().catch((e) => alert(e.message)),
  );
  $('btn-parks').addEventListener('click', () =>
    queryParks().catch((e) => alert(e.message)),
  );
  $('btn-route').addEventListener('click', () =>
    planRoute().catch((e) => alert(e.message)),
  );
}

async function boot() {
  bind();
  try {
    await initMap();
  } catch {
    // 地图加载失败时，仍然允许侧边栏功能可用
  }
  await refreshPlaces();
}

boot().catch((e) => alert(e.message));
