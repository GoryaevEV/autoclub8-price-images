'use strict';

// Волны и приливы по пляжам: Open-Meteo Marine + поправка на то, куда смотрит пляж.
// face — азимут «от пляжа в море» (270 = смотрит на запад), shelter — насколько бухта закрыта (1 = открыт).

const BEACHES = [
  { region: 'Пхукет', name: 'Май Кхао', lat: 8.1700, lon: 98.2900, face: 270, shelter: 1 },
  { region: 'Пхукет', name: 'Най Янг', lat: 8.0880, lon: 98.2950, face: 280, shelter: 0.7 },
  { region: 'Пхукет', name: 'Най Тон', lat: 8.0480, lon: 98.2740, face: 270, shelter: 1 },
  { region: 'Пхукет', name: 'Банг Тао', lat: 7.9930, lon: 98.2870, face: 270, shelter: 1 },
  { region: 'Пхукет', name: 'Сурин', lat: 7.9760, lon: 98.2780, face: 270, shelter: 1 },
  { region: 'Пхукет', name: 'Камала', lat: 7.9500, lon: 98.2810, face: 260, shelter: 0.85 },
  { region: 'Пхукет', name: 'Патонг', lat: 7.8960, lon: 98.2950, face: 270, shelter: 0.8 },
  { region: 'Пхукет', name: 'Карон', lat: 7.8450, lon: 98.2930, face: 270, shelter: 1 },
  { region: 'Пхукет', name: 'Ката', lat: 7.8200, lon: 98.2960, face: 260, shelter: 0.9 },
  { region: 'Пхукет', name: 'Ката Ной', lat: 7.8070, lon: 98.2970, face: 260, shelter: 0.85 },
  { region: 'Пхукет', name: 'Най Харн', lat: 7.7770, lon: 98.3040, face: 250, shelter: 0.85 },
  { region: 'Пхукет', name: 'Раваи', lat: 7.7720, lon: 98.3260, face: 160, shelter: 0.4 },
  { region: 'Пхукет', name: 'Ао Йон', lat: 7.8030, lon: 98.3990, face: 135, shelter: 0.4 },
  { region: 'Пханг Нга', name: 'Натай', lat: 8.2600, lon: 98.2800, face: 270, shelter: 1 },
  { region: 'Пханг Нга', name: 'Кхао Лак', lat: 8.6400, lon: 98.2450, face: 270, shelter: 1 },
  { region: 'Пханг Нга', name: 'Бан Нам Кхем', lat: 8.8550, lon: 98.2650, face: 270, shelter: 0.9 },
  { region: 'Краби', name: 'Ао Нанг', lat: 8.0300, lon: 98.8200, face: 200, shelter: 0.7 },
  { region: 'Краби', name: 'Рейлей Вест', lat: 8.0110, lon: 98.8370, face: 260, shelter: 0.7 },
  { region: 'Краби', name: 'Клонг Муанг', lat: 8.0560, lon: 98.7520, face: 230, shelter: 0.8 },
  { region: 'На север до Хуахина', name: 'Чумпхон, Тхунг Ву Лаен', lat: 10.5880, lon: 99.2950, face: 90, shelter: 1 },
  { region: 'На север до Хуахина', name: 'Банг Сапхан', lat: 11.1950, lon: 99.5250, face: 100, shelter: 1 },
  { region: 'На север до Хуахина', name: 'Прачуап, Ао Манао', lat: 11.7850, lon: 99.8100, face: 100, shelter: 0.8 },
  { region: 'На север до Хуахина', name: 'Хуахин', lat: 12.5700, lon: 99.9600, face: 100, shelter: 1 },
];

const MARINE_TTL = 30 * 60 * 1000;

function seaPoint(b, km) {
  // точка в море в km от пляжа — чтобы модель взяла морскую ячейку, а не сушу
  const a = b.face * Math.PI / 180;
  return {
    lat: b.lat + km * Math.cos(a) / 111,
    lon: b.lon + km * Math.sin(a) / (111 * Math.cos(b.lat * Math.PI / 180)),
  };
}

function waveClass(h) {
  if (h < 0.4) return ['calm', 'спокойно — можно купаться'];
  if (h < 0.9) return ['small', 'небольшие волны'];
  if (h < 1.5) return ['mid', 'волны — осторожно, течения'];
  return ['big', 'большие волны — купаться опасно'];
}
const WAVE_COLORS = { calm: '#16a34a', small: '#84cc16', mid: '#f59e0b', big: '#dc2626' };

function compass(deg) {
  const names = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  return names[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

// Экстремумы прилива по почасовому ряду с уточнением параболой.
function tideExtrema(time, v) {
  const out = [];
  for (let i = 1; i < v.length - 1; i++) {
    const a = v[i - 1], b = v[i], c = v[i + 1];
    if (a == null || b == null || c == null) continue;
    const high = b > a && b >= c, low = b < a && b <= c;
    if (!high && !low) continue;
    const den = a - 2 * b + c;
    const off = den ? (a - c) / (2 * den) : 0;
    out.push({ high, time: time[i] + off * 3600, h: b - (a - c) * off / 4 });
  }
  return out;
}

const beaches = {
  layer: null,
  cache: {},          // region -> { at, data }
  region: null,
  timeIdx: 0,

  init() {
    this.layer = L.layerGroup();
    const reg = $('beachRegion');
    for (const r of REGIONS) {
      if (!BEACHES.some((b) => b.region === r)) continue;
      const o = document.createElement('option');
      o.textContent = r;
      reg.appendChild(o);
    }
    reg.onchange = () => { this.region = reg.value; this.load(true); };
    $('beachTime').onchange = () => { this.timeIdx = +$('beachTime').value; this.render(); };
  },

  times() {
    const now = new Date();
    const at = (dayOff, h) => {
      const d = new Date(now);
      d.setDate(d.getDate() + dayOff);
      d.setHours(h, 0, 0, 0);
      return d.getTime() / 1000;
    };
    const t = Date.now() / 1000;
    return [
      { label: 'сейчас', ts: t },
      { label: 'через 3 часа', ts: t + 3 * 3600 },
      { label: 'через 6 часов', ts: t + 6 * 3600 },
      { label: 'завтра 8:00', ts: at(1, 8) },
      { label: 'завтра 12:00', ts: at(1, 12) },
      { label: 'завтра 16:00', ts: at(1, 16) },
      { label: 'послезавтра 10:00', ts: at(2, 10) },
    ];
  },

  show() {
    if (!this.region) {
      this.region = BEACHES.some((b) => b.region === state.region) ? state.region : 'Пхукет';
      $('beachRegion').value = this.region;
    }
    const sel = $('beachTime');
    sel.innerHTML = '';
    this.times().forEach((x, i) => {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = x.label;
      o.selected = i === this.timeIdx;
      sel.appendChild(o);
    });
    this.layer.addTo(map);
    this.load(true);
  },

  hide() {
    if (this.layer) map.removeLayer(this.layer);
  },

  async load(fit) {
    const region = this.region;
    const list = BEACHES.filter((b) => b.region === region);
    const box = $('beachList');
    if (fit) map.fitBounds(L.latLngBounds(list.map((b) => [b.lat, b.lon])), { padding: [30, 30], maxZoom: 11 });
    const c = this.cache[region];
    if (c && Date.now() - c.at < MARINE_TTL) return this.render();

    box.innerHTML = '<div class="card trip-meta">Загружаю волны и приливы…</div>';
    try {
      const pts = list.map((b) => seaPoint(b, 2));
      const params = new URLSearchParams({
        latitude: pts.map((p) => p.lat.toFixed(4)).join(','),
        longitude: pts.map((p) => p.lon.toFixed(4)).join(','),
        hourly: 'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_level_height_msl',
        cell_selection: 'sea',
        forecast_days: '4',
        timezone: 'auto',
        timeformat: 'unixtime',
      });
      const res = await fetch('https://marine-api.open-meteo.com/v1/marine?' + params);
      if (!res.ok) throw new Error('Open-Meteo Marine ' + res.status);
      const data = await res.json();
      this.cache[region] = { at: Date.now(), data: Array.isArray(data) ? data : [data] };
      if (this.region === region) this.render();
    } catch (e) {
      console.error(e);
      box.innerHTML = `<div class="card trip-meta">Не удалось загрузить данные о море: ${e.message}</div>`;
    }
  },

  render() {
    if (state.mode !== 'beach') return;
    const c = this.cache[this.region];
    if (!c) return;
    const list = BEACHES.filter((b) => b.region === this.region);
    const target = this.times()[this.timeIdx].ts;

    const rows = list.map((b, i) => {
      const h = c.data[i].hourly;
      let k = h.time.findIndex((t) => t >= target - 1800);
      if (k < 0) k = h.time.length - 1;
      const H = h.wave_height[k];
      const dir = h.wave_direction[k];
      // поправка на ориентацию пляжа: волна «в лоб» доходит целиком, сбоку — частично
      const diff = ((dir - b.face) * Math.PI) / 180;
      const exposure = 0.25 + 0.75 * Math.max(0, Math.cos(diff));
      const est = H == null ? null : H * exposure * b.shelter;
      return { b, h, k, H, est, dir };
    });
    rows.sort((x, y) => (x.est ?? 99) - (y.est ?? 99));

    this.layer.clearLayers();
    $('beachList').innerHTML = '';
    for (const r of rows) {
      const [cls, text] = r.est == null ? ['', 'нет данных'] : waveClass(r.est);
      const el = document.createElement('div');
      el.className = 'beach ' + cls;
      const sw = r.h.swell_wave_height[r.k];
      const per = r.h.swell_wave_period[r.k] ?? r.h.wave_period[r.k];
      const surf = r.est != null && r.est >= 0.8 && per >= 8 ? ' · 🏄 есть волна для сёрфа' : '';
      el.innerHTML = `
        <div class="beach-head"><b>${r.b.name}</b>
          <span class="beach-wave">${r.est == null ? '—' : '~' + r.est.toFixed(1) + ' м'}</span></div>
        <div class="beach-sub">${text}${surf}</div>
        <div class="beach-sub">В море ${r.H == null ? '—' : r.H.toFixed(1) + ' м'}` +
          (r.dir != null ? ` с ${compass(r.dir)} <span class="arrow" style="transform:rotate(${Math.round(r.dir)}deg)">↓</span>` : '') +
          (sw != null ? ` · свелл ${sw.toFixed(1)} м` : '') + (per != null ? `, период ${Math.round(per)} с` : '') + `</div>
        ${this.tideBlock(r.h, target)}`;
      el.onclick = () => map.setView([r.b.lat, r.b.lon], 12);
      $('beachList').appendChild(el);

      L.circleMarker([r.b.lat, r.b.lon], {
        radius: 9, color: '#fff', weight: 2, fillColor: WAVE_COLORS[cls] || '#64748b', fillOpacity: 1,
      }).bindTooltip(`${r.b.name}: ${r.est == null ? '—' : '~' + r.est.toFixed(1) + ' м'}`).addTo(this.layer);
    }
    $('beachList').insertAdjacentHTML('beforeend',
      '<p class="hint card">Высота у берега — оценка: волна в море из модели (сетка ~5–25 км) с поправкой на то, куда смотрит пляж и насколько закрыта бухта. ' +
      'Уровень моря — модельный, без учёта местных особенностей; не для навигации. Вокруг Пхукета прилив и отлив почти одновременны на всех пляжах.</p>');
  },

  tideBlock(h, target) {
    const lv = h.sea_level_height_msl;
    if (!lv || lv.every((x) => x == null)) return '';
    const ext = tideExtrema(h.time, lv);
    const next = ext.filter((e) => e.time >= target).slice(0, 2);
    const fmtE = (e) => `${e.high ? '▲ прилив' : '▼ отлив'} ${fmtTime(e.time)} (${e.h >= 0 ? '+' : ''}${e.h.toFixed(1)} м)`;

    // график уровня моря: от выбранного времени −3 ч до +24 ч
    const t0 = target - 3 * 3600, t1 = target + 24 * 3600;
    const pts = h.time.map((t, i) => [t, lv[i]]).filter(([t, v]) => t >= t0 && t <= t1 && v != null);
    if (pts.length < 3) return next.length ? `<div class="beach-tide">${next.map(fmtE).join(' · ')}</div>` : '';
    const vs = pts.map((p) => p[1]);
    const lo = Math.min(...vs), hi = Math.max(...vs), W = 300, H = 54, pad = 12;
    const x = (t) => ((t - t0) / (t1 - t0)) * W;
    const y = (v) => pad + (1 - (v - lo) / (hi - lo || 1)) * (H - 2 * pad);
    const line = pts.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const area = `${line}L${x(pts[pts.length - 1][0]).toFixed(1)},${H}L${x(pts[0][0]).toFixed(1)},${H}Z`;
    const labels = ext.filter((e) => e.time > t0 && e.time < t1).map((e) => {
      const ex = Math.min(W - 16, Math.max(16, x(e.time)));
      return `<text x="${ex}" y="${e.high ? 9 : H - 1}" text-anchor="middle">${fmtTime(e.time)}</text>`;
    }).join('');
    return `<div class="beach-tide">${next.map(fmtE).join(' · ')}</div>
      <svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
        <path class="area" d="${area}"/><path class="tide" d="${line}"/>
        <line class="nowline" x1="${x(target)}" x2="${x(target)}" y1="0" y2="${H}"/>${labels}
      </svg>`;
  },
};
