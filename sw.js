/* Unser Ideenglas: lässt die App auch bei schlechtem Netz starten.
   Eigene Dateien kommen immer frisch aus dem Netz und nur im Notfall aus dem Speicher.
   Kartenausschnitte, die ihr schon angesehen habt, bleiben eine Weile gespeichert, damit die Karte auch im Funkloch etwas zeigt. */
const CACHE = 'ideenglas-v2';
const TILES = 'ideenglas-karte-2';
const MAX_TILES = 1500;
const SHELL = ['./', './index.html', './config.js', './manifest.webmanifest', './icon-192.png', './apple-touch-icon.png'];
const CDN = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const isTile = host => /(^|\.)basemaps\.cartocdn\.com$/.test(host) || host === 'tile.openstreetmap.org';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req.url, {cache: 'no-cache', credentials: 'same-origin'})
        .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })
        .catch(() => caches.match(req, {ignoreSearch: true}).then(r => r || caches.match('./')))
    );
  } else if (isTile(url.hostname)) {
    e.respondWith(tile(req));
  } else if (CDN.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }))
    );
  }
});

/* map tiles: from the store if we have them, otherwise from the net, kept up to MAX_TILES */
async function tile(req){
  const c = await caches.open(TILES);
  const hit = await c.match(req.url);
  if (hit) return hit;
  try {
    const res = await fetch(req.url, {mode: 'cors', credentials: 'omit'});
    if (res.ok) { c.put(req.url, res.clone()).then(trim).catch(() => {}); }
    return res;
  } catch (e) {
    return fetch(req);
  }
}
let trimming = false;
async function trim(){
  if (trimming) return;
  trimming = true;
  try {
    const c = await caches.open(TILES), keys = await c.keys();
    if (keys.length > MAX_TILES) for (const k of keys.slice(0, keys.length - Math.round(MAX_TILES * 0.8))) await c.delete(k);
  } catch (e) {} finally { trimming = false; }
}

/* notifications from the server function "push" */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {body: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.title || 'Unser Ideenglas', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag,
    icon: 'icon-192.png', badge: 'icon-192.png', data: {url: d.url || './'}
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    const c = list.find(x => x.url.startsWith(self.registration.scope)) || list[0];
    if (c) { c.postMessage({type: 'open', url}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
