// Кэшируем только оболочку приложения; погодные данные всегда берём из сети.
const CACHE = 'phuket-weather-v6';
const V = '?v=6';
const SHELL = ['./', 'index.html', 'style.css' + V, 'app.js' + V, 'route.js' + V, 'beaches.js' + V, 'import.js' + V,
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // сеть в приоритете, кэш — если нет интернета
  e.respondWith(
    // no-cache: всегда сверяемся с сервером, чтобы страница и скрипты были одной версии
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
