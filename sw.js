const CACHE_NAME = "jt-bingo-offline-v18";
const OFFLINE_FILES = [
  "./",
  "./index.html",
  "./caller.html",
  "./styles.css",
  "./styles.css?v=15",
  "./auth.js?v=16",
  "./script.js",
  "./script.js?v=18",
  "./manifest.webmanifest",
  "./icon.svg",
  "./sets/index.json",
  "./sets/A0001.json",
  "./sets/A0002.json",
  "./sets/A0003.json",
  "./sets/A0004.json",
  "./sets/A0005.json",
  "./sets/A0006.json",
  "./sets/A0007.json",
  "./sets/A0008.json",
  "./sets/A0009.json",
  "./sets/A0010.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(OFFLINE_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    fetch(event.request).then((networkResponse) => {
      if (networkResponse.ok) {
        const copy = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return networkResponse;
    }).catch(() => caches.match(event.request).then((cachedResponse) => cachedResponse || caches.match("./index.html")))
  );
});
