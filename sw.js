/* Service Worker — 离线秒开（ADR-0009）。
   策略：同源 GET 一律 stale-while-revalidate（先出缓存、后台更新、下次生效）；
   跨域（地图瓦片/天气/OSRM/Google 字体等）完全不接管，由页面各自超时降级。
   改本文件必须升 CACHE_VERSION，否则老缓存不清、新预缓存不装。 */
const CACHE_VERSION = 'trip-v5';
const PRECACHE = [
  './',
  'index.html',
  'leaflet.min.js',
  'leaflet.min.css',
  'parks.html',
  'app-parks.js?v=29',
  'ledger.js?v=3',
  'scratchable.js?v=1',
  'park-bounds.js',
  'd3.min.js',
  'topojson.min.js',
  'states-10m.json'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(PRECACHE)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE_VERSION);
    const cached = await c.match(req);
    const revalidate = fetch(req)
      .then(r => { if (r && r.ok) c.put(req, r.clone()); return r; })
      .catch(() => null);
    if (cached) { e.waitUntil(revalidate); return cached; }
    const fresh = await revalidate;
    if (fresh) return fresh;
    if (req.mode === 'navigate') {
      const idx = await c.match('index.html');
      if (idx) return idx;
    }
    return new Response('offline', { status: 503, statusText: 'offline' });
  })());
});
