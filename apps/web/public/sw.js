// Markaz service worker. Deliberately conservative: this is a financial system of record.
//  - /api/ is NEVER cached or intercepted: every figure on screen comes from the live server. What the app
//    shows offline is the browser-side query cache (see src/shared/offline), not anything stored here.
//  - This worker only keeps the app itself (index.html, the hashed JS/CSS, icons) so Markaz can OPEN offline.
//  - Navigations go to the network first; only when that fails is the cached app (or the offline page) served.
// The push / notificationclick handlers are the hook for server notifications later; nothing subscribes to
// push yet, so they stay idle until that feature lands.
//
// BUILD_ID is replaced at build time (vite.config.ts) so every deploy ships a changed worker and the browser
// installs it; the list of files to keep comes from /precache-manifest.json, written by the same build step.
const BUILD_ID = "__BUILD_ID__";
const APP_CACHE = `markaz-app-${BUILD_ID}`;
const OFFLINE_URL = "/offline.html";
const INDEX_URL = "/index.html";
const SHELL_FILES = [OFFLINE_URL, "/offline.js", "/favicon.svg?v=2", "/icons/icon-192.png", "/manifest.webmanifest"];

async function precache() {
  const cache = await caches.open(APP_CACHE);
  const wanted = new Set(SHELL_FILES);
  try {
    const indexResponse = await fetch(INDEX_URL, { cache: "no-store" });
    if (indexResponse.ok) {
      const html = await indexResponse.clone().text();
      await cache.put(INDEX_URL, indexResponse);
      // index.html names the entry script, stylesheet and splash script it needs to boot.
      for (const match of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) wanted.add(match[1]);
    }
  } catch {
    /* offline during install: the next install attempt tries again */
  }
  try {
    const manifest = await (await fetch("/precache-manifest.json", { cache: "no-store" })).json();
    for (const file of manifest.files ?? []) wanted.add(file);
  } catch {
    /* no manifest (dev, or an older build): the app itself still caches what it loads */
  }
  // One missing file must not fail the whole install.
  await Promise.allSettled([...wanted].map((url) => cache.add(url)));
}

self.addEventListener("install", (event) => {
  // Safe to activate immediately: this worker only serves the app files of its own build.
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("markaz-") && key !== APP_CACHE) await caches.delete(key);
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
      fetch(request).catch(async () => {
        const cache = await caches.open(APP_CACHE);
        return (await cache.match(INDEX_URL)) ?? (await cache.match(OFFLINE_URL)) ?? Response.error();
      }),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      // Hashed build files never change, so any that were not precached are kept the first time they load.
      if (response.ok && url.pathname.startsWith("/assets/")) await cache.put(request, response.clone());
      return response;
    })(),
  );
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
