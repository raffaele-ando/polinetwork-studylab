"use strict";

const CACHE_NAME = "polinetwork-studio-v4.7.3";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./favicon.ico",
  "./data/corpus.json",
  "./data/study_pack.json",
  "./data/glossary.json",
  "./assets/logo.svg",
  "./assets/favicon-16x16.png",
  "./assets/favicon-32x32.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-192.png",
  "./assets/icon-maskable-512.png",
  "./assets/apple-touch-icon.png",
  "./assets/pages/elettorale_p21.png",
  "./assets/pages/elettorale_p22.png",
  "./assets/pages/elettorale_p23.png",
  "./assets/pages/elettorale_p24.png",
  "./assets/pages/elettorale_p25.png",
  "./assets/pages/elettorale_p26.png",
  "./assets/pages/elettorale_p27.png",
  "./assets/pages/elettorale_p28.png",
  "./assets/pages/elettorale_p29.png",
  "./assets/pages/elettorale_p32.png",
  "./assets/pages/elettorale_p33.png",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await Promise.allSettled(
        PRECACHE_URLS.map(url =>
          fetch(url, { cache: "no-cache" }).then(res => {
            if (res && res.ok) return cache.put(url, res);
          })
        )
      );
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(async keys => {
      await Promise.all(
        keys
          .filter(k => k.startsWith("polinetwork-studio-") && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      );
      await self.clients.claim();
    })
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never intercept cross-origin requests (Firebase Auth, Firestore, Analytics, Cloudflare)
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;
  const isAppCodeOrData =
    req.mode === "navigate" ||
    path.endsWith("/") ||
    path.endsWith(".html") ||
    path.endsWith(".js") ||
    path.endsWith(".css") ||
    path.endsWith(".json");

  const canonicalUrl = new URL(url.pathname, self.location.origin).href;

  if (isAppCodeOrData) {
    // Network-First with Offline Cache Fallback (never serves stale code when online)
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(canonicalUrl, copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const hit =
            (await cache.match(canonicalUrl)) ||
            (await cache.match(req, { ignoreSearch: true }));
          if (hit) return hit;
          if (req.mode === "navigate") {
            return (await cache.match("./index.html", { ignoreSearch: true })) || Response.error();
          }
          return Response.error();
        })
    );
  } else {
    // Stale-While-Revalidate for images, SVGs, and favicons
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached =
          (await cache.match(canonicalUrl)) ||
          (await cache.match(req, { ignoreSearch: true }));
        const netPromise = fetch(req)
          .then(res => {
            if (res && res.ok) cache.put(canonicalUrl, res.clone()).catch(() => {});
            return res;
          })
          .catch(() => null);
        return cached || (await netPromise) || Response.error();
      })
    );
  }
});
