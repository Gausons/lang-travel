const $ = (id) => document.getElementById(id);

function getCtx() {
  return {
    lat: Number($('ctx-lat').value),
    lon: Number($('ctx-lon').value),
    city: $('ctx-city').value.trim(),
  };
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

async function refreshPlaces() {
  const { city } = getCtx();
  const qs = city ? `?city=${encodeURIComponent(city)}` : '';
  const { places } = await api(`/api/places${qs}`);
  const body = $('place-body');
  body.innerHTML = '';
  for (const p of places) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.id}</td>
      <td>${p.name}</td>
      <td>${p.category}</td>
      <td>${p.city}</td>
      <td>${p.lat}, ${p.lon}</td>
      <td>${p.score}</td>
    `;
    body.appendChild(tr);
  }
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
  $('add-msg').textContent = `已录入 ${place.name} (${place.id})`;
  await refreshPlaces();
}

async function queryParks() {
  const { lat, lon, city } = getCtx();
  const radiusKm = Number($('park-radius').value || 5);
  const { parks } = await api(
    `/api/parks?lat=${lat}&lon=${lon}&city=${encodeURIComponent(
      city,
    )}&radiusKm=${radiusKm}`,
  );
  const ul = $('parks-result');
  ul.innerHTML = '';
  for (const item of parks) {
    const li = document.createElement('li');
    li.textContent = `${item.place.name} - ${item.distanceKm.toFixed(2)}km - 评分${item.place.score}`;
    ul.appendChild(li);
  }
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
  const lines = [result.summary];
  result.stops.forEach((s, i) => {
    lines.push(
      `${i + 1}. ${s.name} | ${s.category} | ${s.distance_km}km | ${s.travel_mode} ${s.travel_min}分钟 + 游玩${s.visit_min}分钟`,
    );
  });
  lines.push(`总时长约 ${result.total_minutes} 分钟。`);
  $('route-result').textContent = lines.join('\n');
}

async function chat() {
  const { lat, lon, city } = getCtx();
  const message = $('chat-message').value.trim();
  const text = await api('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      message,
      lat,
      lon,
      city,
      hours: Number($('route-hours').value || 4),
      radiusKm: Number($('park-radius').value || 5),
      prefer: $('route-prefer').value,
    }),
  });
  $('chat-result').textContent = text.text;
}

function bind() {
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
  $('btn-chat').addEventListener('click', () =>
    chat().catch((e) => alert(e.message)),
  );
}

bind();
refreshPlaces().catch((e) => alert(e.message));
