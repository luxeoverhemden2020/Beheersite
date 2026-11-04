// Sitehulpje-app: pagina's eerst online (altijd de nieuwste versie), opmaak en plaatjes uit de cache
const CACHE = "sitehulpje-v29";
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["verzoeken", "inloggen", "assets/stijl.css", "assets/basis.js", "assets/icoon-192.png"]).catch(() => {}))); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return; // API en opslag nooit via de cache
  if (r.mode === "navigate") {
    e.respondWith(fetch(r).then((res) => { const k = res.clone(); caches.open(CACHE).then((c) => c.put(r, k)); return res; })
      .catch(() => caches.match(r).then((x) => x || caches.match("verzoeken"))));
    return;
  }
  if (u.pathname.includes("/assets/")) {
    e.respondWith(caches.match(r).then((x) => { const net = fetch(r).then((res) => { const k = res.clone(); caches.open(CACHE).then((c) => c.put(r, k)); return res; }); return x || net; }));
  }
});
