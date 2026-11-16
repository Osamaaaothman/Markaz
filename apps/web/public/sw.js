// Markaz service worker. Deliberately conservative — this is a financial system of record:
//  - /api/ is NEVER cached or intercepted: every figure on screen comes from the live server.
//  - Navigations go to the network; only if that fails is the offline page shown.
//  - Hashed build assets (/assets/*) are immutable, so they are cached on first use for speed.
// The push / notificationclick handlers are the hook for server notifications later; nothing
// subscribes to push yet, so they stay idle until that feature lands.
const VERSION = "v1";
const SHELL_CACHE = `markaz-shell-${VERSION}`;
const ASSET_CACHE = `markaz-assets-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const SHELL_FILES = [OFFLINE_URL, "/offline.js", "/favicon.svg?v=2", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  // Safe to activate immediately: this worker only serves the offline page and immutable assets.
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      for (const key of await caches.keys()) {
        if (key.startsWith("markaz-") && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      })(),
    );
  }
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Markaz", body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "Markaz", {
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      data: { url: typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
