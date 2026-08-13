const CACHE = "detailing-v3.4-beta.3";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./assets/chem-alkaline.webp",
  "./assets/chem-neutral.webp",
  "./assets/chem-polish.webp",
  "./assets/chem-iron.webp",
  "./assets/chem-acid.webp",
  "./assets/chem-glass.webp",
  "./assets/chem-prep.webp",
  "./assets/chem-coating.webp",
  "./assets/chem-qd.webp",
  "./assets/guide-road-film.webp",
  "./assets/guide-water-spots.webp",
  "./assets/guide-iron.webp",
  "./assets/guide-bugs.webp",
  "./assets/guide-wheel.webp",
  "./assets/guide-glass.webp",
  "./assets/guide-trim.webp",
  "./assets/guide-tar.webp",
  "./assets/guide-bird.webp",
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
