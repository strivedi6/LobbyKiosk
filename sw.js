/* Lobby screen service worker: keeps the kiosk running when the network drops.
   - App files (html/js/css/json): network first, cached copy if offline.
   - Fonts, icons and photos (incl. Google Drive images): cache first.
   - Google Sheet data and videos: always straight from the network
     (the app keeps its own copy of the data). */
const VERSION = "kiosk-v2";
const SHELL = ["./", "index.html", "app.css", "app.js", "icons.js", "config.js", "content.json", "manifest.webmanifest"];
const MAX_MEDIA = 400;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== "media").map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim() {
  const c = await caches.open("media");
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_MEDIA; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("script.google.com") || url.hostname.endsWith("script.googleusercontent.com")) return;
  if (url.hostname === "drive.google.com" || /\.(mp4|webm|mov)$/i.test(url.pathname) || req.destination === "video") return;
  if (url.pathname.endsWith("admin.html") || url.pathname.endsWith("admin.js")) return;

  const isMedia = req.destination === "image" || req.destination === "font" ||
    url.hostname.endsWith("googleusercontent.com") || /\/assets\//.test(url.pathname);

  if (isMedia) {
    e.respondWith(caches.open("media").then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") { c.put(req, res.clone()); trim(); }
      return res;
    }));
    return;
  }
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("index.html"))));
  }
});
