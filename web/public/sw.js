// @ts-nocheck
const CACHE = "nesti-shell-v10";
const SHELL = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/models/FloatingIsland.glb"];

async function precache() {
  const cache = await caches.open(CACHE);
  const page = await fetch("/");
  const source = await page.clone().text();
  await cache.put("/", page);
  const assets = [...source.matchAll(/(?:src|href)="(\/[^"#]+)"/g)].map((match) => match[1]);
  await Promise.allSettled([...new Set([...SHELL, ...assets])].map((url) => cache.add(url)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && new URL(event.request.url).origin === self.location.origin) {
          caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/")))
  );
});
