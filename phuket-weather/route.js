'use strict';

// Дождь по маршруту: маршрут OSRM + ансамблевый прогноз Open-Meteo + радар.
// Использует map, state, PLACES, radarSampler и утилиты из app.js (загружается раньше него,
// но вызывается только после загрузки app.js).

const ROUTE_STORE = 'phuket-weather:route';
const WET_MM = 0.3;                 // мм за час: от этого считаем, что «попал под дождь»
const SAMPLE_KM = 2.5;              // шаг точек вдоль маршрута
const MAX_SAMPLES = 40;
const DEPARTURES = [0, 30, 60, 90, 120, 180, 240]; // минуты от «сейчас»
const ENSEMBLE_MODELS = 'icon_seamless,gfs_seamless,ecmwf_ifs025';

function haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function probColor(p) {
  if (p >= 0.6) return '#dc2626';
  if (p >= 0.3) return '#f59e0b';
  return '#16a34a';
}

const route = {
  me: null,
  from: null,
  to: null,
  picking: null,
  layer: null,
  result: null,
  depIdx: 0,

  init() {
    const saved = storeGet(ROUTE_STORE) || {};
    this.from = saved.from || { ...PLACES[6] };
    this.to = saved.to || { ...PLACES[2] };
    this.layer = L.layerGroup().addTo(map);

    document.querySelectorAll('.tab').forEach((t) => {
      t.onclick = () => this.setMode(t.dataset.mode);
    });
    document.querySelectorAll('.pick').forEach((b) => {
      b.onclick = () => this.startPick(b.dataset.pick);
    });
    $('fromSel').onchange = () => this.onSelect('from');
    $('toSel').onchange = () => this.onSelect('to');
    $('depSel').onchange = () => {
      this.depIdx = +$('depSel').value;
      if (this.result) this.render();
    };
    $('routeBtn').onclick = () => this.calculate();
    this.fillSelects();
    this.fillDepartures();
  },

  setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
    document.querySelectorAll('.mode-here').forEach((el) => { el.hidden = mode !== 'here'; });
    document.querySelectorAll('.mode-route').forEach((el) => { el.hidden = mode !== 'route'; });
    meMarker.setOpacity(mode === 'here' ? 1 : 0);
    if (mode === 'here') {
      map.removeLayer(radiusCircle); radiusCircle.addTo(map);
      this.layer.clearLayers();
    } else {
      map.removeLayer(radiusCircle);
      if (this.result) this.render(); else this.drawEnds();
    }
    this.stopPick();
  },

  setMe(p) {
    this.me = p;
    this.fillSelects();
  },

  choices() {
    const list = [];
    if (this.me) list.push(this.me);
    for (const p of PLACES) list.push(p);
    for (const p of [this.from, this.to]) {
      if (p && !list.some((q) => q.lat === p.lat && q.lon === p.lon)) list.push(p);
    }
    return list;
  },

  fillSelects() {
    const list = this.choices();
    for (const [key, id] of [['from', 'fromSel'], ['to', 'toSel']]) {
      const sel = $(id);
      sel.innerHTML = '';
      list.forEach((p, i) => {
        const o = document.createElement('option');
        o.value = i;
        o.textContent = p.name === 'Точка на карте' ? `Точка ${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}` : p.name;
        if (this[key] && p.lat === this[key].lat && p.lon === this[key].lon) o.selected = true;
        sel.appendChild(o);
      });
    }
  },

  fillDepartures() {
    const sel = $('depSel');
    sel.innerHTML = '';
    const now = Date.now() / 1000;
    DEPARTURES.forEach((m, i) => {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = m === 0 ? 'сейчас' : `в ${fmtTime(now + m * 60)} (+${m < 60 ? m + ' мин' : m / 60 + ' ч'})`;
      if (i === this.depIdx) o.selected = true;
      sel.appendChild(o);
    });
  },

  onSelect(key) {
    const list = this.choices();
    this.setEnd(key, list[+$(key === 'from' ? 'fromSel' : 'toSel').value]);
  },

  setEnd(key, p) {
    this[key] = { ...p };
    storeSet(ROUTE_STORE, { from: this.from, to: this.to });
    this.result = null;
    $('routeResult').hidden = true;
    this.fillSelects();
    this.drawEnds();
  },

  startPick(key) {
    if (this.picking === key) return this.stopPick();
    this.picking = key;
    document.querySelectorAll('.pick').forEach((b) => b.classList.toggle('active', b.dataset.pick === key));
    $('pickHint').hidden = false;
    $('pickHint').textContent = `Нажмите на карту, чтобы выбрать «${key === 'from' ? 'Откуда' : 'Куда'}»`;
    map.getContainer().scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  stopPick() {
    this.picking = null;
    document.querySelectorAll('.pick').forEach((b) => b.classList.remove('active'));
    $('pickHint').hidden = true;
  },

  onMapClick(p) {
    const key = this.picking || (this.from ? 'to' : 'from');
    this.setEnd(key, p);
    this.stopPick();
  },

  drawEnds() {
    this.layer.clearLayers();
    for (const [p, color] of [[this.from, '#2563eb'], [this.to, '#0f172a']]) {
      if (!p) continue;
      L.circleMarker([p.lat, p.lon], { radius: 8, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 })
        .bindTooltip(p === this.from ? 'Старт' : 'Финиш')
        .addTo(this.layer);
    }
  },

  // ---------- Расчёт ----------
  async calculate() {
    if (!this.from || !this.to) return;
    if (haversineKm(this.from, this.to) < 0.3) return alert('Старт и финиш совпадают');
    this.fillDepartures();
    const box = $('routeResult');
    box.hidden = false;
    box.innerHTML = '<div class="trip-meta">Строю маршрут и считаю прогноз…</div>';
    $('routeBtn').disabled = true;
    try {
      const r = await this.fetchRoute();
      const samples = this.sample(r);
      const [ens, radar] = await Promise.allSettled([
        this.fetchEnsemble(samples),
        this.radarAlong(samples),
      ]);
      if (radar.status === 'rejected') console.warn('Радар по маршруту:', radar.reason);
      let probs;
      if (ens.status === 'fulfilled') {
        probs = this.tripProbabilities(samples, ens.value);
      } else {
        console.warn('Ансамбль недоступен, считаю по обычному прогнозу:', ens.reason);
        probs = await this.fallbackProbabilities(samples);
      }
      this.result = { r, samples, probs, radar: radar.status === 'fulfilled' ? radar.value : null };
      this.render();
    } catch (e) {
      console.error(e);
      box.innerHTML = `<div class="trip-meta">Не удалось рассчитать: ${e.message}</div>`;
    } finally {
      $('routeBtn').disabled = false;
    }
  },

  async fetchRoute() {
    const { from, to } = this;
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}` +
      '?overview=full&geometries=geojson&annotations=duration';
    const res = await fetch(url);
    if (!res.ok) throw new Error('сервис маршрутов ответил ' + res.status);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes.length) throw new Error('маршрут не найден');
    const rt = data.routes[0];
    const coords = rt.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
    const segDur = rt.legs.flatMap((l) => (l.annotation && l.annotation.duration) || []);
    // накопленные время (с) и расстояние (км) до каждой вершины
    const t = [0], d = [0];
    for (let i = 1; i < coords.length; i++) {
      const km = haversineKm(coords[i - 1], coords[i]);
      d.push(d[i - 1] + km);
      t.push(t[i - 1] + (segDur.length === coords.length - 1 ? segDur[i - 1] : 0));
    }
    // если аннотаций нет — распределяем общее время пропорционально расстоянию
    if (t[t.length - 1] === 0) for (let i = 0; i < t.length; i++) t[i] = rt.duration * d[i] / d[d.length - 1];
    return { coords, t, d, duration: rt.duration, distanceKm: rt.distance / 1000 };
  },

  sample(r) {
    const step = Math.max(SAMPLE_KM, r.distanceKm / MAX_SAMPLES);
    const out = [];
    let next = 0;
    for (let i = 0; i < r.coords.length; i++) {
      if (r.d[i] >= next || i === r.coords.length - 1) {
        out.push({ ...r.coords[i], idx: i, sec: r.t[i], km: r.d[i] });
        next = r.d[i] + step;
      }
    }
    return out;
  },

  async fetchEnsemble(samples) {
    const params = new URLSearchParams({
      latitude: samples.map((s) => s.lat.toFixed(4)).join(','),
      longitude: samples.map((s) => s.lon.toFixed(4)).join(','),
      hourly: 'precipitation',
      models: ENSEMBLE_MODELS,
      forecast_days: '2',
      timezone: 'auto',
      timeformat: 'unixtime',
    });
    const res = await fetch('https://ensemble-api.open-meteo.com/v1/ensemble?' + params);
    if (!res.ok) throw new Error('Open-Meteo Ensemble ' + res.status);
    const data = await res.json();
    const locs = Array.isArray(data) ? data : [data];
    const time = locs[0].hourly.time;
    const keys = Object.keys(locs[0].hourly).filter((k) => k.startsWith('precipitation'));
    if (!keys.length) throw new Error('в ответе нет участников ансамбля');
    // series[member][point][hour]
    const series = keys.map((k) => locs.map((l) => l.hourly[k] || []));
    return { time, series };
  },

  // Вероятность = доля участников ансамбля, в которых хоть в одной точке маршрута
  // в момент проезда выпадает ≥ WET_MM мм/ч.
  tripProbabilities(samples, ens) {
    const { time, series } = ens;
    const now = Date.now() / 1000;
    const hourIdx = (ts) => {
      // осадки за час, предшествующий time[k]
      for (let k = 0; k < time.length; k++) if (time[k] >= ts) return k;
      return -1;
    };
    return DEPARTURES.map((m) => {
      const dep = now + m * 60;
      const ks = samples.map((s) => hourIdx(dep + s.sec));
      let wet = 0, used = 0;
      const pointWet = new Array(samples.length).fill(0);
      for (const member of series) {
        let ok = true, any = false;
        const wets = ks.map((k, i) => {
          const v = k >= 0 ? member[i][k] : null;
          if (v == null) { ok = false; return false; }
          return v >= WET_MM;
        });
        if (!ok) continue; // у части моделей бывают пропуски (шаг 3 ч) — такого участника пропускаем
        used++;
        wets.forEach((w, i) => { if (w) { pointWet[i]++; any = true; } });
        if (any) wet++;
      }
      return {
        dep, minutes: m,
        p: used ? wet / used : null,
        members: used,
        points: pointWet.map((x) => (used ? x / used : 0)),
      };
    });
  },

  // Запасной вариант: обычный прогноз с вероятностью по часам (без ансамбля).
  async fallbackProbabilities(samples) {
    const params = new URLSearchParams({
      latitude: samples.map((s) => s.lat.toFixed(4)).join(','),
      longitude: samples.map((s) => s.lon.toFixed(4)).join(','),
      hourly: 'precipitation_probability',
      forecast_days: '2',
      timezone: 'auto',
      timeformat: 'unixtime',
    });
    const res = await fetch('https://api.open-meteo.com/v1/forecast?' + params);
    if (!res.ok) throw new Error('Open-Meteo ' + res.status);
    const data = await res.json();
    const locs = Array.isArray(data) ? data : [data];
    const time = locs[0].hourly.time;
    const now = Date.now() / 1000;
    return DEPARTURES.map((m) => {
      const dep = now + m * 60;
      const points = samples.map((s, i) => {
        const k = time.findIndex((t) => t >= dep + s.sec);
        return k >= 0 ? (locs[i].hourly.precipitation_probability[k] ?? 0) / 100 : 0;
      });
      return { dep, minutes: m, p: Math.max(0, ...points), members: 0, points, approx: true };
    });
  },

  async radarAlong(samples) {
    if (!state.radar) return null;
    const frame = state.radar.frames[state.radar.lastPast];
    const measure = await radarSampler(frame, samples, 20);
    return { time: frame.time, points: samples.map((s) => measure(s.lat, s.lon, 20)) };
  },

  // ---------- Отрисовка ----------
  render() {
    const { r, samples, probs, radar } = this.result;
    const cur = probs[this.depIdx];
    const valid = probs.filter((x) => x.p != null);
    const best = valid.reduce((a, b) => (b.p < a.p - 0.04 ? b : a), valid[0]);

    // линия маршрута, раскрашенная по вероятности в каждой точке
    this.drawEnds();
    for (let i = 0; i < samples.length - 1; i++) {
      const seg = r.coords.slice(samples[i].idx, samples[i + 1].idx + 1).map((c) => [c.lat, c.lon]);
      const p = Math.max(cur.points[i], cur.points[i + 1]);
      L.polyline(seg, { color: probColor(p), weight: 6, opacity: 0.9 }).addTo(this.layer);
    }
    this.layer.eachLayer((l) => { if (l instanceof L.CircleMarker) l.bringToFront(); });
    const bounds = L.latLngBounds(r.coords.map((c) => [c.lat, c.lon]));
    if (!map.getBounds().contains(bounds)) map.fitBounds(bounds, { padding: [30, 30] });

    // самый «мокрый» участок
    let wi = 0;
    cur.points.forEach((p, i) => { if (p > cur.points[wi]) wi = i; });

    // радар: дождь прямо на маршруте сейчас
    let radarLine = '';
    if (radar) {
      const hit = radar.points.map((m, i) => ({ ...m, km: m.km, at: samples[i].km })).filter((m) => m.km < 2);
      const nearest = Math.min(...radar.points.map((m) => m.km));
      if (hit.length) {
        const a = Math.round(hit[0].at), b = Math.round(hit[hit.length - 1].at);
        radarLine = `⚠️ Сейчас на радаре идёт дождь на участке ${a === b ? '~' + a : a + '–' + b} км от старта.`;
      } else if (isFinite(nearest)) {
        radarLine = `Радар: сейчас дождя на маршруте нет, ближайший в ${Math.round(nearest)} км.`;
      } else {
        radarLine = 'Радар: сейчас дождя в 20 км от маршрута нет.';
      }
    }

    const pct = (p) => (p == null ? '—' : Math.round(p * 100) + '%');
    const durMin = Math.round(r.duration / 60);
    const rows = probs.map((x, i) => `
      <div class="dep${x === best ? ' best' : ''}${i === this.depIdx ? ' sel' : ''}" data-i="${i}">
        <span>${x.minutes === 0 ? 'сейчас' : 'в ' + fmtTime(x.dep)}</span>
        <span class="track"><i style="width:${Math.round((x.p || 0) * 100)}%;background:${probColor(x.p || 0)}"></i></span>
        <span class="pct">${pct(x.p)}</span>
      </div>`).join('');

    $('routeResult').innerHTML = `
      <h2>${this.from.name} → ${this.to.name}</h2>
      <div class="trip-big"><b style="color:${probColor(cur.p || 0)}">${pct(cur.p)}</b>
        <span>вероятность попасть под дождь при выезде ${cur.minutes === 0 ? 'сейчас' : 'в ' + fmtTime(cur.dep)}</span></div>
      <div class="trip-meta">${r.distanceKm.toFixed(1)} км · ~${durMin} мин в пути` +
      (cur.points[wi] > 0.05 ? ` · самый рискованный участок ~${Math.round(samples[wi].km)} км от старта (${pct(cur.points[wi])})` : '') +
      `</div>
      ${radarLine ? `<div class="trip-meta">${radarLine}</div>` : ''}
      <h2 style="margin-top:12px">Когда лучше выехать</h2>
      <div class="deps">${rows}</div>
      <div class="legend">Цвет линии — риск на каждом участке; итоговая цифра — риск попасть под дождь хотя бы где-то за поездку.</div>
      <div class="legend"><span><i style="background:#16a34a"></i>&lt;30%</span><span><i style="background:#f59e0b"></i>30–60%</span><span><i style="background:#dc2626"></i>&gt;60%</span></div>
      <p class="hint">${cur.approx
        ? 'Ансамблевый прогноз недоступен — показана максимальная почасовая вероятность по точкам маршрута (приблизительно).'
        : `Считается по ${cur.members} вариантам прогноза (ансамбли ICON, GFS, ECMWF): доля вариантов, где на маршруте в момент проезда выпадает от ${WET_MM} мм/ч.`}
        На ближайший час смотрите радар — модели не видят отдельные ливневые облака.</p>`;

    $('routeResult').querySelectorAll('.dep').forEach((el) => {
      el.onclick = () => {
        this.depIdx = +el.dataset.i;
        $('depSel').value = this.depIdx;
        this.render();
      };
    });
  },
};
