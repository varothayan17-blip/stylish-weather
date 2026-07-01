// Aeruvo service worker — deliberately simple. It only caches the
// app shell (same-origin JS/CSS/fonts/images) so the app opens instantly on
// repeat visits and the UI still loads offline. It NEVER caches weather or
// geocoding API responses — those must always hit the network, otherwise
// you'd risk showing yesterday's temperature.

const CACHE_NAME = "aeruvo-shell-v1";
const STATIC_EXTENSIONS = [
  ".js",
  ".css",
  ".woff2",
  ".woff",
  ".png",
  ".svg",
  ".ico",
  ".webmanifest",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

function isStaticAsset(url) {
  return STATIC_EXTENSIONS.some((ext) => url.pathname.endsWith(ext));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cross-origin (weather/geocoding APIs) — always go straight to network,
  // never intercept or cache.
  if (url.origin !== self.location.origin) return;

  // Same-origin static assets — stale-while-revalidate: serve from cache
  // instantly if we have it, refresh the cache in the background either way.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }

  // Navigation / HTML — network-first, falling back to the last cached
  // shell if the device is offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(request, res.clone()));
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/"))),
    );
  }
});
