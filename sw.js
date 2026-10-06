const C = "ride-along-v27";
const A = [
  "./",
  "./index.html",
  "./styles.css?v=27",
  "./core.js?v=27",
  "./app.js?v=27",
  "./route-efficiency.js?v=27",
  "./planner.js?v=27",
  "./places.js?v=27",
  "./manifest.json",
];
self.addEventListener("install", (e) =>
  e.waitUntil(
    caches
      .open(C)
      .then((c) => c.addAll(A.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((ks) =>
        Promise.all(
          ks
            .filter((k) => k.startsWith("ride-along-") && k !== C)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(
    (async () => {
      const c = await caches.open(C);
      // Only HTML navigations may fall back to the app shell. Never serve HTML as JSON or JS.
      if (e.request.mode === "navigate") {
        try {
          const r = await fetch(e.request);
          if (r.ok) {
            await c.put(e.request, r.clone());
            return r;
          }
          const saved = await c.match(e.request);
          return saved || r;
        } catch {
          const saved =
            (await c.match(e.request)) || (await c.match("./index.html"));
          return saved || Response.error();
        }
      }
      const saved = await c.match(e.request);
      if (saved) return saved;
      try {
        const r = await fetch(e.request);
        if (r.ok) await c.put(e.request, r.clone());
        return r;
      } catch {
        return Response.error();
      }
    })(),
  );
});
