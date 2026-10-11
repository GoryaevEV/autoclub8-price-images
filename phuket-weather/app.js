'use strict';

// ---------- Настройки ----------
const REGIONS = ['Пхукет', 'Пханг Нга', 'Краби', 'На север до Хуахина'];
const PLACES = [
  { region: 'Пхукет', name: 'Мост Сарасин', lat: 8.2003, lon: 98.2985 },
  { region: 'Пхукет', name: 'Аэропорт', lat: 8.1132, lon: 98.3169 },
  { region: 'Пхукет', name: 'Патонг', lat: 7.8961, lon: 98.2964 },
  { region: 'Пхукет', name: 'Пхукет‑таун', lat: 7.8804, lon: 98.3923 },
  { region: 'Пхукет', name: 'Чалонг', lat: 7.8467, lon: 98.3376 },
  { region: 'Пхукет', name: 'Ката', lat: 7.8203, lon: 98.2977 },
  { region: 'Пхукет', name: 'Раваи', lat: 7.7796, lon: 98.3253 },
  { region: 'Пханг Нга', name: 'Кхао Лак', lat: 8.6367, lon: 98.2487 },
  { region: 'Пханг Нга', name: 'Пханг Нга (город)', lat: 8.4509, lon: 98.5256 },
  { region: 'Пханг Нга', name: 'Самет Нангше', lat: 8.2510, lon: 98.4495 },
  { region: 'Пханг Нга', name: 'Такуа Па', lat: 8.8656, lon: 98.3459 },
  { region: 'Пханг Нга', name: 'Кхао Сок', lat: 8.9126, lon: 98.5286 },
  { region: 'Краби', name: 'Ао Нанг', lat: 8.0322, lon: 98.8226 },
  { region: 'Краби', name: 'Краби (город)', lat: 8.0863, lon: 98.9063 },
  { region: 'Краби', name: 'Клонг Муанг', lat: 8.0590, lon: 98.7400 },
  { region: 'На север до Хуахина', name: 'Ранонг', lat: 9.9658, lon: 98.6348 },
  { region: 'На север до Хуахина', name: 'Сураттани', lat: 9.1382, lon: 99.3215 },
  { region: 'На север до Хуахина', name: 'Чумпхон', lat: 10.4930, lon: 99.1800 },
  { region: 'На север до Хуахина', name: 'Банг Сапхан', lat: 11.2125, lon: 99.5106 },
  { region: 'На север до Хуахина', name: 'Прачуап Кхири Кхан', lat: 11.8124, lon: 99.7973 },
  { region: 'На север до Хуахина', name: 'Хуахин', lat: 12.5684, lon: 99.9577 },
];
const placeByName = (name) => PLACES.find((p) => p.name === name);
const DEFAULT_CENTER = [7.95, 98.34];
const RADAR_ZOOM = 7;          // бесплатный RainViewer отдаёт тайлы до 7 зума
const RADAR_COLOR = 2;         // Universal Blue
const RADAR_OPTS = '1_1';      // сглаживание, снег
const RADAR_RADIUS_KM = 60;    // в каком радиусе ищем дождь на радаре
const RAIN_MMH = 0.5;          // от этой интенсивности считаем «дождь»
const STORE_KEY = 'phuket-weather:point';

// ---------- Утилиты ----------
const $ = (id) => document.getElementById(id);

function storeGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function storeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* приватный режим */ }
}

function fmtTime(unixSec, tz) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit', minute: '2-digit', timeZone: tz || undefined,
  }).format(new Date(unixSec * 1000));
}
function fmtHour(unixSec, tz) {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', timeZone: tz || undefined })
    .format(new Date(unixSec * 1000));
}

// Время с днём недели, если это не сегодня: «пт 12.10, 10:00».
function fmtWhen(unixSec) {
  const d = new Date(unixSec * 1000);
  const time = fmtTime(unixSec);
  if (d.toDateString() === new Date().toDateString()) return time;
  const day = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'numeric' }).format(d);
  return `${day}, ${time}`;
}

function toLocalInput(unixSec) {
  const d = new Date(unixSec * 1000);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}

// Выбор времени: «Сейчас» или любое время на 7 дней вперёд.
function whenPicker(inputId, nowBtnId, onChange) {
  const input = $(inputId), btn = $(nowBtnId);
  let isNow = true;
  const sync = () => {
    const now = Date.now() / 1000;
    input.min = toLocalInput(now - 3600);
    input.max = toLocalInput(now + 7 * 86400);
    if (isNow) input.value = toLocalInput(now);
    btn.classList.toggle('active', isNow);
  };
  btn.onclick = () => { isNow = true; sync(); onChange(); };
  input.onchange = () => {
    if (!input.value) { isNow = true; sync(); } else isNow = false;
    btn.classList.toggle('active', isNow);
    onChange();
  };
  sync();
  return {
    get() {
      if (isNow || !input.value) return Date.now() / 1000;
      return new Date(input.value).getTime() / 1000;
    },
    isNow: () => isNow,
    sync,
  };
}

function intensityLabel(mmh) {
  if (mmh < 0.1) return 'без осадков';
  if (mmh < 2.5) return 'слабый дождь';
  if (mmh < 7.6) return 'умеренный дождь';
  if (mmh < 20) return 'сильный дождь';
  return 'ливень';
}

const WMO = {
  0: 'ясно', 1: 'преимущественно ясно', 2: 'переменная облачность', 3: 'пасмурно',
  45: 'туман', 48: 'туман', 51: 'морось', 53: 'морось', 55: 'сильная морось',
  61: 'слабый дождь', 63: 'дождь', 65: 'сильный дождь', 80: 'ливень', 81: 'ливень',
  82: 'сильный ливень', 95: 'гроза', 96: 'гроза с градом', 99: 'гроза с градом',
};

function lonLatToPixel(lat, lon, z) {
  const size = 256 * 2 ** z;
  const latR = lat * Math.PI / 180;
  return {
    x: (lon + 180) / 360 * size,
    y: (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * size,
  };
}
function kmPerPixel(lat, z) {
  return 40075.016 * Math.cos(lat * Math.PI / 180) / (256 * 2 ** z);
}

// ---------- Состояние ----------
const state = {
  point: storeGet(STORE_KEY) || { ...PLACES[0] },
  radar: null,          // { host, frames: [{time, path, nowcast}] }
  layers: [],
  frame: 0,
  playing: null,
  forecast: null,
  radarNear: null,
  mode: 'here',
  region: (storeGet(STORE_KEY) || {}).region || 'Пхукет',
};

// ---------- Карта ----------
const map = L.map('map', { zoomControl: true, attributionControl: true })
  .setView(DEFAULT_CENTER, 10);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '© OpenStreetMap',
}).addTo(map);
map.attributionControl.addAttribution('Радар © RainViewer');

const meMarker = L.marker([state.point.lat, state.point.lon], {
  icon: L.divIcon({ className: '', html: '<div class="me-marker"></div>', iconSize: [16, 16] }),
}).addTo(map);
const radiusCircle = L.circle([state.point.lat, state.point.lon], {
  radius: 10000, color: '#2563eb', weight: 1, fill: false, dashArray: '4 4',
}).addTo(map);

map.on('click', (e) => {
  const p = { name: 'Точка на карте', lat: +e.latlng.lat.toFixed(4), lon: +e.latlng.lng.toFixed(4) };
  if (state.mode === 'route') route.onMapClick(p);
  else setPoint(p);
});

// ---------- Места ----------
function renderPlaces() {
  const box = $('places');
  box.innerHTML = '';
  const regionSel = document.createElement('select');
  regionSel.className = 'region-sel';
  regionSel.setAttribute('aria-label', 'Регион');
  for (const r of REGIONS) {
    const o = document.createElement('option');
    o.textContent = r;
    o.selected = r === state.region;
    regionSel.appendChild(o);
  }
  regionSel.onchange = () => {
    state.region = regionSel.value;
    setPoint({ ...PLACES.find((p) => p.region === state.region) }, true);
  };
  box.appendChild(regionSel);
  for (const p of PLACES.filter((q) => q.region === state.region)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.name;
    if (p.name === state.point.name) b.className = 'active';
    b.onclick = () => setPoint({ ...p }, true);
    box.appendChild(b);
  }
}

function setPoint(p, pan) {
  state.point = p;
  if (p.region) state.region = p.region;
  storeSet(STORE_KEY, p);
  meMarker.setLatLng([p.lat, p.lon]);
  radiusCircle.setLatLng([p.lat, p.lon]);
  if (pan) map.setView([p.lat, p.lon], Math.max(map.getZoom(), 10));
  renderPlaces();
  refreshPointData();
}

$('locateBtn').onclick = () => {
  if (!navigator.geolocation) return alert('Геолокация недоступна в этом браузере');
  $('locateBtn').disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $('locateBtn').disabled = false;
      const me = { name: 'Я здесь', lat: +pos.coords.latitude.toFixed(4), lon: +pos.coords.longitude.toFixed(4) };
      route.setMe(me);
      if (state.mode === 'route') route.setEnd('from', me);
      else setPoint(me, true);
    },
    (err) => {
      $('locateBtn').disabled = false;
      alert('Не удалось определить местоположение: ' + err.message);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
};

// ---------- Радар (RainViewer) ----------
function tileUrl(frame, z, x, y) {
  return `${state.radar.host}${frame.path}/256/${z}/${x}/${y}/${RADAR_COLOR}/${RADAR_OPTS}.png`;
}

async function loadRadar() {
  const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('RainViewer ' + res.status);
  const data = await res.json();
  const past = (data.radar && data.radar.past) || [];
  const nowcast = (data.radar && data.radar.nowcast) || [];
  const frames = [
    ...past.map((f) => ({ ...f, nowcast: false })),
    ...nowcast.map((f) => ({ ...f, nowcast: true })),
  ];
  if (!frames.length) throw new Error('нет кадров радара');

  for (const l of state.layers) if (l) map.removeLayer(l);
  state.radar = { host: data.host, frames, lastPast: past.length - 1 };
  state.layers = new Array(frames.length).fill(null);

  const slider = $('frameSlider');
  slider.max = frames.length - 1;
  showFrame(Math.max(0, past.length - 1));
  $('radarNote').textContent = nowcast.length
    ? 'Радар: последние 2 часа и прогноз движения на 30 минут. Нажмите на карту, чтобы выбрать точку.'
    : 'Радар: последние 2 часа, обновление каждые 10 минут. Нажмите на карту, чтобы выбрать точку.';
}

function layerFor(i) {
  if (!state.layers[i]) {
    const f = state.radar.frames[i];
    state.layers[i] = L.tileLayer(`${state.radar.host}${f.path}/256/{z}/{x}/{y}/${RADAR_COLOR}/${RADAR_OPTS}.png`, {
      opacity: 0, maxNativeZoom: RADAR_ZOOM, maxZoom: 18, zIndex: 10,
    }).addTo(map);
  }
  return state.layers[i];
}

function showFrame(i) {
  if (!state.radar) return;
  const frames = state.radar.frames;
  state.frame = i;
  layerFor(i).setOpacity(0.75);
  state.layers.forEach((l, j) => { if (l && j !== i) l.setOpacity(0); });
  if (i + 1 < frames.length) layerFor(i + 1); // подгружаем следующий кадр заранее

  const f = frames[i];
  const diffMin = Math.round((f.time - frames[state.radar.lastPast].time) / 60);
  const rel = diffMin === 0 ? 'сейчас' : (diffMin > 0 ? `+${diffMin} мин` : `${diffMin} мин`);
  $('frameLabel').textContent = `${fmtTime(f.time)} · ${rel}`;
  $('frameSlider').value = i;
}

$('frameSlider').oninput = (e) => { stopPlay(); showFrame(+e.target.value); };
$('playBtn').onclick = () => (state.playing ? stopPlay() : startPlay());

function startPlay() {
  if (!state.radar) return;
  $('playBtn').textContent = '❚❚';
  state.playing = setInterval(() => {
    const n = state.radar.frames.length;
    showFrame((state.frame + 1) % n);
  }, 600);
}
function stopPlay() {
  clearInterval(state.playing);
  state.playing = null;
  $('playBtn').textContent = '▶';
}

// Анализ пикселей радара вокруг точки: расстояние до ближайшего дождя по кадрам.
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('tile ' + url));
    img.src = url;
  });
}

// Загружает кусок кадра радара, покрывающий точки (+ запас), и умеет мерить расстояние до дождя.
async function radarSampler(frame, pts, marginKm) {
  const z = RADAR_ZOOM;
  const kpp = kmPerPixel(pts[0].lat, z);
  const m = Math.ceil(marginKm / kpp);
  const pp = pts.map((p) => lonLatToPixel(p.lat, p.lon, z));
  const x0 = Math.floor(Math.min(...pp.map((p) => p.x)) - m);
  const y0 = Math.floor(Math.min(...pp.map((p) => p.y)) - m);
  const w = Math.ceil(Math.max(...pp.map((p) => p.x)) + m) - x0 + 1;
  const h = Math.ceil(Math.max(...pp.map((p) => p.y)) + m) - y0 + 1;

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tiles = [];
  for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + w) / 256); tx++) {
    for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + h) / 256); ty++) {
      tiles.push(loadImage(tileUrl(frame, z, tx, ty)).then((img) => {
        ctx.drawImage(img, tx * 256 - x0, ty * 256 - y0);
      }));
    }
  }
  await Promise.all(tiles);
  const px = ctx.getImageData(0, 0, w, h).data; // бросит ошибку при отсутствии CORS

  // расстояние (км) от точки до ближайшего дождя в радиусе maxKm и доля круга 5 км под дождём
  return function measure(lat, lon, maxKm) {
    const c = lonLatToPixel(lat, lon, z);
    const cx = c.x - x0, cy = c.y - y0;
    const r = Math.ceil(maxKm / kpp);
    let best = Infinity, near5 = 0, total5 = 0;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
        const d = Math.hypot(x - cx, y - cy) * kpp;
        if (d > maxKm) continue;
        const rain = px[(y * w + x) * 4 + 3] > 40;
        if (d <= 5) { total5++; if (rain) near5++; }
        if (rain && d < best) best = d;
      }
    }
    return { km: best, cover5: total5 ? near5 / total5 : 0 };
  };
}

async function nearestRainKm(frame, lat, lon) {
  const measure = await radarSampler(frame, [{ lat, lon }], RADAR_RADIUS_KM);
  return { time: frame.time, ...measure(lat, lon, RADAR_RADIUS_KM) };
}

async function analyzeRadarNear() {
  if (!state.radar) return null;
  const { frames, lastPast } = state.radar;
  const { lat, lon } = state.point;
  // текущий кадр и кадр ~30 минут назад
  const idx = [lastPast, Math.max(0, lastPast - 3)];
  const [now, before] = await Promise.all(idx.map((i) => nearestRainKm(frames[i], lat, lon)));

  const res = { now, before, approaching: false, etaMin: null };
  const minutes = (now.time - before.time) / 60;
  if (isFinite(now.km) && minutes > 0) {
    const closing = (isFinite(before.km) ? before.km : RADAR_RADIUS_KM) - now.km;
    if (closing > 2 && now.km > 1.5) {
      res.approaching = true;
      res.etaMin = Math.round(now.km / (closing / minutes));
    }
  }
  return res;
}

// ---------- Прогноз (Open-Meteo) ----------
async function loadForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat, longitude: lon,
    current: 'temperature_2m,precipitation,weather_code,cloud_cover',
    minutely_15: 'precipitation',
    forecast_minutely_15: '17',
    hourly: 'precipitation_probability,precipitation,weather_code',
    forecast_hours: '24',
    timezone: 'auto',
    timeformat: 'unixtime',
  });
  const res = await fetch('https://api.open-meteo.com/v1/forecast?' + params);
  if (!res.ok) throw new Error('Open-Meteo ' + res.status);
  return res.json();
}

function renderNow(fc) {
  const c = fc.current;
  $('placeName').textContent = '· ' + state.point.name;
  $('now').innerHTML =
    `<b>${Math.round(c.temperature_2m)}°</b> ${WMO[c.weather_code] || ''}` +
    ` · облачность ${c.cloud_cover}% · осадки ${c.precipitation} мм`;
}

function renderMinutely(fc) {
  const box = $('minutely');
  box.innerHTML = '';
  const t = fc.minutely_15.time, p = fc.minutely_15.precipitation;
  const nowSec = Date.now() / 1000;
  const items = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] < nowSec - 15 * 60) continue;
    items.push({ time: t[i], mmh: (p[i] || 0) * 4 });
  }
  const max = Math.max(4, ...items.map((x) => x.mmh));
  items.slice(0, 16).forEach((it, i) => {
    const el = document.createElement('div');
    el.className = 'bar';
    const h = Math.round(it.mmh / max * 80);
    el.innerHTML =
      `<div class="val">${it.mmh >= 0.1 ? it.mmh.toFixed(1) : ''}</div>` +
      `<div class="fill${it.mmh < 0.1 ? ' zero' : ''}" style="height:${Math.max(2, h)}px"></div>` +
      `<div class="lbl">${i % 4 === 0 ? fmtTime(it.time, fc.timezone) : ''}</div>`;
    el.title = `${fmtTime(it.time, fc.timezone)}: ${it.mmh.toFixed(1)} мм/ч — ${intensityLabel(it.mmh)}`;
    box.appendChild(el);
  });
  return items;
}

function renderHourly(fc) {
  const box = $('hourly');
  box.innerHTML = '';
  const h = fc.hourly;
  for (let i = 0; i < h.time.length; i++) {
    const prob = h.precipitation_probability[i] ?? 0;
    const mm = h.precipitation[i] ?? 0;
    const el = document.createElement('div');
    el.className = 'hour' + (prob >= 70 ? ' p3' : prob >= 40 ? ' p2' : prob >= 20 ? ' p1' : '');
    el.innerHTML =
      `<div class="t">${fmtHour(h.time[i], fc.timezone)}:00</div>` +
      `<div class="p">${prob}%</div>` +
      `<div class="mm">${mm >= 0.1 ? mm.toFixed(1) : '–'}</div>`;
    el.title = WMO[h.weather_code[i]] || '';
    box.appendChild(el);
  }
}

function renderRadarNear(r) {
  const el = $('radarNear');
  if (!r) { el.textContent = 'Анализ радара недоступен — смотрите карту.'; return; }
  if (!isFinite(r.now.km)) {
    el.textContent = `Радар: дождя нет в радиусе ${RADAR_RADIUS_KM} км.`;
  } else if (r.now.km < 1.5 || r.now.cover5 > 0.15) {
    el.textContent = `Радар: дождь над точкой (покрыто ${Math.round(r.now.cover5 * 100)}% круга 5 км).`;
  } else {
    el.textContent = `Радар: ближайший дождь в ${Math.round(r.now.km)} км` +
      (r.approaching ? `, приближается — примерно через ${r.etaMin} мин.` : ', не приближается.');
  }
}

// ---------- Итоговый вывод ----------
function renderVerdict(minutely, fc, radar) {
  const next2h = minutely.filter((m) => m.time < Date.now() / 1000 + 2 * 3600);
  const maxMmh = Math.max(0, ...next2h.map((m) => m.mmh));
  const prob2h = Math.max(0, ...fc.hourly.precipitation_probability.slice(0, 3).map((x) => x ?? 0));
  const firstRain = minutely.find((m) => m.mmh >= RAIN_MMH);

  let cls, icon, title, sub;
  if (radar && isFinite(radar.now.km) && (radar.now.km < 1.5 || radar.now.cover5 > 0.15)) {
    [cls, icon, title] = ['bad', '🌧️', 'Сейчас идёт дождь'];
    sub = 'По данным радара дождь прямо над точкой.';
  } else if (radar && radar.approaching && radar.etaMin <= 60) {
    [cls, icon, title] = ['bad', '⚠️', `Дождь приближается: ~${radar.etaMin} мин`];
    sub = `Ближайшая зона дождя в ${Math.round(radar.now.km)} км (оценка по движению на радаре).`;
  } else if (maxMmh >= RAIN_MMH || prob2h >= 60) {
    [cls, icon, title] = ['warn', '🌦️', 'Высокий риск дождя в ближайшие 2 часа'];
    sub = (firstRain ? `Модель ждёт ${intensityLabel(firstRain.mmh)} около ${fmtTime(firstRain.time, fc.timezone)}. ` : '') +
      `Вероятность до ${prob2h}%.`;
  } else if (prob2h >= 30) {
    [cls, icon, title] = ['warn', '⛅', 'Возможен дождь'];
    sub = `Вероятность в ближайшие 2 часа до ${prob2h}%. Перед выездом проверьте радар.`;
  } else {
    [cls, icon, title] = ['ok', '🏍️', 'Сухо — можно ехать'];
    sub = `Вероятность дождя в ближайшие 2 часа ${prob2h}%.` +
      (radar && isFinite(radar.now.km) ? ` Ближайший дождь на радаре в ${Math.round(radar.now.km)} км.` : '');
  }
  $('verdict').className = 'verdict mode-here ' + cls;
  $('verdictIcon').textContent = icon;
  $('verdictTitle').textContent = title;
  $('verdictSub').textContent = sub;
}

// ---------- Загрузка ----------
let refreshSeq = 0;
async function refreshPointData() {
  const seq = ++refreshSeq;
  const { lat, lon } = state.point;
  $('verdictTitle').textContent = 'Загружаю данные…';
  $('verdictSub').textContent = '';

  const [fc, radar] = await Promise.allSettled([
    loadForecast(lat, lon),
    analyzeRadarNear(),
  ]);
  if (seq !== refreshSeq) return; // пользователь уже выбрал другую точку

  const radarRes = radar.status === 'fulfilled' ? radar.value : null;
  if (radar.status === 'rejected') console.warn('Анализ радара:', radar.reason);
  renderRadarNear(radarRes);
  if (radarRes && radarRes.approaching) radiusCircle.setRadius(Math.max(2000, radarRes.now.km * 1000));
  else radiusCircle.setRadius(10000);

  if (fc.status === 'fulfilled') {
    state.forecast = fc.value;
    renderNow(fc.value);
    const minutely = renderMinutely(fc.value);
    renderHourly(fc.value);
    renderVerdict(minutely, fc.value, radarRes);
  } else {
    console.error(fc.reason);
    $('verdict').className = 'verdict mode-here';
    $('verdictIcon').textContent = '⚠️';
    $('verdictTitle').textContent = 'Не удалось загрузить прогноз';
    $('verdictSub').textContent = 'Проверьте интернет и обновите страницу.';
  }
  $('updated').textContent = ' Обновлено в ' + fmtTime(Date.now() / 1000) + '.';
}

async function refreshAll() {
  try {
    await loadRadar();
  } catch (e) {
    console.error(e);
    $('radarNote').textContent = 'Радар временно недоступен: ' + e.message;
  }
  await refreshPointData();
}

// Ошибка в одной вкладке не должна ломать радар и прогноз — показываем её баннером и едем дальше.
for (const [name, fn] of [['места', renderPlaces], ['маршрут', () => route.init()], ['пляжи', () => beaches.init()]]) {
  try { fn(); } catch (e) {
    console.error(e);
    window.dispatchEvent(new ErrorEvent('error', { message: `вкладка «${name}»: ${e.message}` }));
  }
}

// Ссылка, присланная через «Поделиться» (Google Карты → Дождь на Пхукете)
(() => {
  const q = new URLSearchParams(location.search);
  const shared = [q.get('url'), q.get('text'), q.get('title')].filter(Boolean).join(' ');
  if (!/https?:\/\//.test(shared)) return;
  history.replaceState(null, '', location.pathname);
  route.setMode('route');
  $('importBox').hidden = false;
  $('importText').value = shared;
  route.importText(shared);
})();
map.setView([state.point.lat, state.point.lon], 10);
refreshAll();
setInterval(refreshAll, 10 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshAll();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Официальный радар TMD: у него нет открытого API, поэтому показываем их страницу во фрейме.
$('tmdShow').onclick = () => {
  const box = $('tmdFrame');
  if (!box.hidden) { box.hidden = true; box.innerHTML = ''; $('tmdShow').textContent = 'Показать здесь'; return; }
  box.hidden = false;
  box.innerHTML = '<iframe src="https://weather.tmd.go.th/pkt240_HQ_edit2.php" title="Радар TMD Пхукет" loading="lazy" referrerpolicy="no-referrer"></iframe>' +
    '<p class="hint">Если окно пустое — сайт TMD запрещает встраивание, откройте «Снимок ↗».</p>';
  $('tmdShow').textContent = 'Скрыть';
};
