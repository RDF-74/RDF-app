const CACHE = "detailing-v3.7-beta.5-inspection-documents-ocr-r3-nav";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./photo-store.js",
  "./push-config.js",
  "./nav-behavior.js",
  "./notifications.js",
  "./line-notifications.js",
  "./line-official-link.js",
  "./inspection-photo-keep.js",
  "./vehicle-inspection.js",
  "./inspection-history.js",
  "./inspection-documents.js",
  "./home-dashboard.js",
  "./release-update.js",
  "./icon-192.png",
  "./icon-512.png",
];
self.addEventListener("install", (e) =>
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request, { cache: "no-store" })
        .then((r) => {
          const x = r.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", x));
          return r;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(
      (r) =>
        r ||
        fetch(e.request).then((n) => {
          const x = n.clone();
          caches.open(CACHE).then((c) => c.put(e.request, x));
          return n;
        }),
    ),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() || "メンテ時期を確認してください。" };
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || "Detailing Manager", {
        body: data.body || "メンテ時期を確認してください。",
        icon: data.icon || "./icon-192.png",
        badge: data.badge || "./icon-192.png",
        tag: data.tag || "dm-maintenance",
        renotify: false,
        data: data.data || { url: "./#home" },
      }),
      self.navigator?.setAppBadge
        ? self.navigator.setAppBadge(1).catch(() => {})
        : Promise.resolve(),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    event.notification.data?.url || "./#home",
    self.registration.scope,
  ).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        const existing = clients.find((client) =>
          client.url.startsWith(self.registration.scope),
        );
        if (existing) {
          if ("navigate" in existing) await existing.navigate(target).catch(() => {});
          return existing.focus();
        }
        return self.clients.openWindow(target);
      }),
  );
});
