// sw.js — Vie t'Lignes, service worker « 100 % local » (V40).
// Stratégie : cache-first pour tous les fichiers du jeu (même origine).
// La première visite en ligne remplit le cache au fur et à mesure des
// chargements (tous les modules sont importés au démarrage) ; ensuite le
// jeu démarre intégralement hors ligne — Android (PWA installée) comme
// Windows (fenêtre autonome installée via Edge/Chrome).
const CACHE = "vtl-cache-v47";
// Précache intégral : TOUS les modules sont mis en cache à l'installation —
// le jeu doit être jouable hors ligne dès la fin de la première visite,
// sans attendre un second passage qui remplirait le cache au fil de l'eau.
const SRC_MODULES = [
  "advertising.js", "buildings.js", "carrefours.js", "city.js",
  "constants.js", "contracts.js", "coverage.js", "demographics.js",
  "disruptions.js", "engine-worker.js", "engine.js", "events.js",
  "growth.js", "html.js", "main.js", "network.js", "od.js",
  "passengers.js", "persistence.js", "planning.js", "progression.js",
  "pruning.js", "renderer.js", "reports.js", "routing.js", "scenarios.js",
  "seasons.js", "state.js", "stops.js", "vehicles.js",
  "worker-client.js", "worker-core.js"
];
const PRECACHE = ["./", "./index.html", "./favicon.png", "./manifest.webmanifest", "./src/style.css"]
  .concat(SRC_MODULES.map(function (name) { return "./src/" + name; }));

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
  // ignoreSearch : index.html référence main.js/style.css avec ?v=47 mais
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
