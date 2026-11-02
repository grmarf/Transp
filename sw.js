// sw.js — Vie t'Lignes, service worker « 100 % local » (V40).
// Stratégie : cache-first pour tous les fichiers du jeu (même origine).
// La première visite en ligne remplit le cache au fur et à mesure des
// chargements (tous les modules sont importés au démarrage) ; ensuite le
// jeu démarre intégralement hors ligne — Android (PWA installée) comme
// Windows (fenêtre autonome installée via Edge/Chrome).
const CACHE = "vtl-cache-v46";
const PRECACHE = ["./", "./index.html", "./favicon.png", "./manifest.webmanifest"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          if (key !== CACHE) return caches.delete(key);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation : en ligne on met à jour le cache, hors ligne on sert le
  // index.html mis en cache (ignoreSearch : l'URL peut porter ?seed=…).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(function (response) {
        const copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put("./index.html", copy); });
        return response;
      }).catch(function () {
        return caches.match("./index.html", { ignoreSearch: true });
      })
    );
    return;
  }

  // Ressources (modules, CSS, icônes) : cache d'abord, réseau ensuite.
  // ignoreSearch : index.html référence main.js/style.css avec ?v=46 mais
  // les imports internes sont sans paramètre — même fichier, même cache.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (response) {
        if (response && response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      });
    }).catch(function () {
      return caches.match("./index.html");
    })
  );
});
