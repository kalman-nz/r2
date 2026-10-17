// R2's service worker. It makes the app installable on phones and lets it
// open on patchy warehouse Wi-Fi by keeping the app shell (the page and its
// scripts) in a cache. It never touches /api/: stock, availability and
// scans have to be live, so those always go to the server, and the page
// says so when it can't reach it. Queuing scans offline is planned for v2.
//
// Registered from main.tsx in production builds only.

const CACHE = "r2-shell-v1";
const MAX_ASSETS = 40;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/icon-512.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Hashed build files pile up across deploys; keep the newest MAX_ASSETS.
async function trimAssets(cache) {
  const keys = (await cache.keys()).filter((req) => new URL(req.url).pathname.startsWith("/assets/"));
  for (const req of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(req);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Live data, file downloads and PocketBase's own dashboard: never cached.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/_/")) return;

  if (request.mode === "navigate") {
    // Network first so a new deploy shows up straight away; the cached
    // shell only when the network's gone. Every route is the same SPA page.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    // Content-hashed file names never change, so the cache is always right.
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy).then(() => trimAssets(cache)));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Icons, manifest: cached copy if there is one, otherwise the network.
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
