// Service worker: cachea SOLO los assets estáticos con hash de Next.
// Nunca cachea /api (descargas, SSE, medios) y, sobre todo, NUNCA el HTML:
// si el HTML queda cacheado, tras actualizar la app el navegador sigue sirviendo
// el bundle viejo y parece que los arreglos «no funcionan».
const CACHE = "linyue-ui-v3";
self.addEventListener("install", (e) => {
  // A propósito NO se precachea "/": el HTML siempre debe venir de la red.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/icon.svg", "/manifest.webmanifest"])));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  // Al cambiar el nombre de la caché se borran las anteriores (incluido el HTML viejo).
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.pathname.startsWith("/api/") || u.origin !== location.origin) return;
  // Navegación (el HTML): siempre a la red y sin caché HTTP intermedia.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request, { cache: "no-store" }).catch(() =>
        caches.match("/").then((r) => r || new Response("Sin conexión", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })),
      ),
    );
    return;
  }
  // Assets: red primero (llevan hash en el nombre, así que nunca hay versión vieja)
  // y se guardan solo para el modo sin conexión.
  e.respondWith(
    fetch(e.request)
      .then((r) => { if (u.pathname.startsWith("/_next/static/")) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); } return r; })
      .catch(() => caches.match(e.request)),
  );
});
