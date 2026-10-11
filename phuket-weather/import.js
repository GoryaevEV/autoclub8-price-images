'use strict';

// Импорт маршрута: ссылка Google Карт или файл GPX/KML → список точек [{lat, lon, name?}].
// Точную линию Google в ссылке не передаёт, поэтому берём старт, остановки и финиш,
// а дорогу между ними строит OSRM.

const MAX_VIA = 23; // OSRM и читаемость: не больше 25 точек вместе со стартом и финишем

const COORD_RE = /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/;

async function geocode(name) {
  const params = new URLSearchParams({ q: name, format: 'json', limit: '1', 'accept-language': 'ru,en' });
  const res = await fetch('https://nominatim.openstreetmap.org/search?' + params);
  if (!res.ok) throw new Error('поиск места ответил ' + res.status);
  const [hit] = await res.json();
  if (!hit) throw new Error(`не нашёл место «${name}»`);
  return { lat: +hit.lat, lon: +hit.lon, name: name.split(',')[0] };
}

async function resolveShortLink(url) {
  if (!SHORTLINK_RESOLVER) {
    throw new Error('Это короткая ссылка (maps.app.goo.gl) — браузер не может её раскрыть. ' +
      'Откройте её в браузере на компьютере и скопируйте полный адрес из адресной строки ' +
      '(начинается с google.com/maps/dir/…). Скоро это будет работать и с короткими ссылками.');
  }
  const res = await fetch(SHORTLINK_RESOLVER + '?url=' + encodeURIComponent(url));
  if (!res.ok) throw new Error('не удалось раскрыть короткую ссылку');
  return (await res.text()).trim();
}

async function parseGoogleMapsLink(text, me) {
  const m = String(text).match(/https?:\/\/\S+/);
  if (!m) throw new Error('Не вижу ссылки. Вставьте адрес маршрута из Google Карт.');
  let url = m[0];
  if (/maps\.app\.goo\.gl|goo\.gl\/maps/.test(url)) url = await resolveShortLink(url);
  const u = new URL(url);

  // Формат API: ?api=1&origin=…&destination=…&waypoints=a|b
  if (u.searchParams.get('destination')) {
    const names = [u.searchParams.get('origin') || '',
      ...(u.searchParams.get('waypoints') || '').split('|').filter(Boolean),
      u.searchParams.get('destination')];
    return resolveSegments(names, [], me);
  }

  // Обычный формат: /maps/dir/Старт/Остановка/Финиш/@lat,lon,zoom/data=!…
  const parts = u.pathname.split('/');
  const i = parts.indexOf('dir');
  if (i < 0) throw new Error('Это ссылка на место, а не на маршрут. Постройте маршрут («Как добраться») и скопируйте ссылку.');
  const segs = [];
  for (const p of parts.slice(i + 1)) {
    if (p.startsWith('@') || p.startsWith('data=') || p.startsWith('am=')) break;
    segs.push(decodeURIComponent(p.replace(/\+/g, ' ')));
  }
  while (segs.length && segs[segs.length - 1] === '') segs.pop();
  // координаты точек, заданных местами (!1d — долгота, !2d — широта)
  const dataPart = parts.find((p) => p.startsWith('data=')) || u.searchParams.get('data') || '';
  const coords = [...dataPart.matchAll(/!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/g)].map((x) => ({ lon: +x[1], lat: +x[2] }));
  return resolveSegments(segs, coords, me);
}

async function resolveSegments(segs, dataCoords, me) {
  if (segs.length < 2) throw new Error('В ссылке меньше двух точек маршрута.');
  const named = segs.filter((s) => s && !COORD_RE.test(s)).length;
  const useData = dataCoords.length === named;
  let j = 0;
  const out = [];
  for (const s of segs) {
    if (s === '' || /моё местоположение|my location/i.test(s)) {
      if (!me) throw new Error('Маршрут начинается с «Моё местоположение» — нажмите «📍 Где я» и загрузите ссылку ещё раз.');
      out.push({ ...me });
    } else if (COORD_RE.test(s)) {
      const [, lat, lon] = s.match(COORD_RE);
      out.push({ lat: +lat, lon: +lon });
    } else if (useData) {
      out.push({ ...dataCoords[j++], name: s.split(',')[0] });
    } else {
      out.push(await geocode(s));
      await new Promise((r) => setTimeout(r, 1100)); // правила Nominatim: не чаще 1 запроса в секунду
    }
  }
  return out;
}

// GPX (трек/маршрут/точки) или KML (линия) → точки, прореженные до MAX_VIA промежуточных.
function parseTrackFile(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('файл повреждён или это не GPX/KML');
  let pts = [];
  for (const tag of ['trkpt', 'rtept', 'wpt']) {
    pts = [...doc.getElementsByTagName(tag)].map((el) => ({
      lat: +el.getAttribute('lat'), lon: +el.getAttribute('lon'),
    }));
    if (pts.length >= 2) break;
  }
  if (pts.length < 2) {
    const coordsEls = [...doc.getElementsByTagName('coordinates')];
    // берём самую длинную линию
    const best = coordsEls.map((el) => el.textContent.trim().split(/\s+/)).sort((a, b) => b.length - a.length)[0] || [];
    pts = best.map((t) => t.split(',')).filter((c) => c.length >= 2).map(([lon, lat]) => ({ lat: +lat, lon: +lon }));
  }
  pts = pts.filter((p) => isFinite(p.lat) && isFinite(p.lon));
  if (pts.length < 2) throw new Error('в файле не найден маршрут');
  return thinTrack(pts, MAX_VIA);
}

// Равномерно по расстоянию оставляем maxVia промежуточных точек.
function thinTrack(pts, maxVia) {
  const d = [0];
  for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + haversineKm(pts[i - 1], pts[i]));
  const total = d[d.length - 1];
  const out = [pts[0]];
  let k = 1;
  for (let n = 1; n <= maxVia; n++) {
    const target = (total * n) / (maxVia + 1);
    while (k < pts.length - 1 && d[k] < target) k++;
    if (k < pts.length - 1 && pts[k] !== out[out.length - 1]) out.push(pts[k]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
