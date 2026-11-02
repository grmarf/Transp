// V48 — carte allégée : les voiries d'arrêt à arrêt GÉNÉRÉES restent droites
// (fin des « arêtes de poisson » du V28 qui pliaient chaque croisement à 90°,
// zigzags illisibles au zoom maximal), les sauvegardes héritées sont
// automatiquement redressées au chargement (straightenGeneratedRoads), et la
// mini-carte devient flottante au-dessus du menu du bas en vue mobile.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCity, mulberry32 } from "../src/city.js";
import { createState } from "../src/state.js";
import { createNetwork, validateNetwork } from "../src/network.js";
import { developCityCarrefours } from "../src/carrefours.js";
import { straightenGeneratedRoads, pruneOrphanCarrefourStops } from "../src/pruning.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const log = () => {};

// --- 1. Ville neuve : voiries générées droites, réseau sain ---------------
{
  const city = createCity("V48-CLUTTER");
  const report = developCityCarrefours(city, mulberry32(city.numericSeed ^ 0xCA2E),
    { skipGeneratedBends: true }, null, () => {});
  assert.equal(report.bends, 0, "aucune voirie générée n'est pliée (skipGeneratedBends)");
  const stopsById = new Map(city.stops.map(s => [s.id, s]));
  const bent = city.roads.filter(r =>
    Array.isArray(r.points) && r.points.length >= 2 &&
    r.a && r.b && stopsById.has(r.a) && stopsById.has(r.b) &&
    r.built !== true && !r.corridorId && r.startStopId === undefined);
  assert.equal(bent.length, 0, "aucune voirie d'arrêt à arrêt générée ne porte de polyline");
  // Le réseau fusionne par position : tout est raccord même sans pli préalable.
  const state = createState(city);
  state.network = createNetwork(city);
  assert.deepEqual(validateNetwork(state.network, city), [],
    "réseau intégré : aucun arrêt hors graphe, aucune arête cassée");
}
// Croisement en X simple : l'arrêt de carrefour est toujours posé, la
// jonction fusionne dans le nœud de l'arrêt (pas besoin de pli à 90°).
{
  const cityX = {
    stops: [
      { id: "s1", x: 100, y: 300 }, { id: "s2", x: 500, y: 300 },
      { id: "s3", x: 300, y: 100 }, { id: "s4", x: 300, y: 500 }
    ],
    roads: [
      { id: "r1", a: "s1", b: "s2", type: "street", built: false },
      { id: "r2", a: "s3", b: "s4", type: "street", built: false }
    ]
  };
  const rep = developCityCarrefours(cityX, mulberry32(1), { skipGeneratedBends: true }, null, () => {});
  assert.equal(rep.bends, 0, "le croisement reste un X : aucune voirie pliée");
  assert.equal(rep.stops, 1, "un arrêt de carrefour est toujours posé sur le croisement");
  assert.ok(!cityX.roads.some(r => Array.isArray(r.points)), "les deux voiries restent droites");
  const network = createNetwork(cityX);
  assert.deepEqual(validateNetwork(network, cityX), [], "le X simple produit un réseau sain");
  const cs = cityX.stops.find(s => /^carrefour-\d+$/.test(s.id || ""));
  assert.ok(cs && Math.hypot(cs.x - 300, cs.y - 300) < 1, "l'arrêt est posé sur le croisement");
  assert.ok(network.nodes.has(cs.id), "l'arrêt de carrefour est un nœud du réseau");
  assert.ok((network.adjacency.get(cs.id) || []).length >= 3,
    "la jonction fusionne dans le nœud de l'arrêt (au moins 3 bras raccordés)");
}

// --- 2. Sauvegarde héritée : straightenGeneratedRoads ---------------------
{
  const city = {
    stops: [
      { id: "stop-a", x: 100, y: 300 },
      { id: "stop-b", x: 500, y: 300 },
      { id: "carrefour-1", x: 300, y: 300 }
    ],
    roads: [
      // Voirie générée pliée (héritée V28) : candidate au redressement.
      { id: "road-gen", a: "stop-a", b: "stop-b", type: "street",
        points: [{ x: 100, y: 300 }, { x: 278, y: 300 }, { x: 300, y: 278 },
                 { x: 322, y: 300 }, { x: 500, y: 300 }] },
      // Voirie joueur construite : JAMAIS retouchée.
      { id: "road-built", a: "stop-a", b: "stop-b", type: "boulevard", built: true,
        points: [{ x: 100, y: 320 }, { x: 300, y: 320 }, { x: 500, y: 320 }] },
      // Corridor (résilience travaux) : JAMAIS retouché.
      { id: "road-cor", a: "stop-a", b: "stop-b", type: "street", corridorId: "cor-1",
        points: [{ x: 100, y: 340 }, { x: 500, y: 340 }] },
      // Tracé libre du joueur (pas d'arrêts aux extrémités) : intact.
      { id: "road-free", type: "street",
        points: [{ x: 0, y: 400 }, { x: 200, y: 420 }, { x: 400, y: 400 }] }
    ]
  };
  assert.equal(straightenGeneratedRoads(city), 1, "seule la voirie générée pliée est redressée");
  assert.ok(!Array.isArray(city.roads[0].points),
    "la voirie générée retrouve sa géométrie directe (arrêt → arrêt)");
  assert.ok(Array.isArray(city.roads[1].points), "la voirie construite (built) garde sa polyline");
  assert.ok(Array.isArray(city.roads[2].points), "le corridor garde sa polyline");
  assert.ok(Array.isArray(city.roads[3].points), "le tracé libre du joueur garde sa polyline");
  assert.equal(straightenGeneratedRoads(city), 0, "le redressement est idempotent");
  // L'arrêt de carrefour reste desservi : il repose sur la voirie redressée.
  assert.equal(pruneOrphanCarrefourStops(city, new Set()).length, 0,
    "un arrêt de carrefour posé sur la voirie redressée n'est pas orphelin");
  // Cas limite : ville sans voirie pliée → 0, pas de crash.
  assert.equal(straightenGeneratedRoads({ stops: [], roads: [] }), 0,
    "straightenGeneratedRoads supporte une ville vide");
}

// --- 3. Câblage : le boot et le déssaimage appellent les nouveautés -------
{
  const mainjs = read("src/main.js");
  const carrefoursjs = read("src/carrefours.js");
  assert.ok(mainjs.includes("{ skipGeneratedBends: true }"),
    "le boot génère la ville sans plier les voiries d'arrêt à arrêt");
  assert.ok(mainjs.includes("straightenGeneratedRoads(state.city)"),
    "rationaliseCityRoads redresse les zigzags hérités au chargement");
  assert.ok(mainjs.includes("rebuildNetwork();"),
    "le réseau est reconstruit après redressement");
  assert.ok(carrefoursjs.includes("opts.skipGeneratedBends"),
    "developCityCarrefours sait neutraliser le pliage des voiries générées");
  // Les tracés du joueur gardent leur redressement (opts.road).
  assert.ok(mainjs.includes("developCityCarrefours(state.city, rng, { road }"),
    "le tracé joueur continue d'aménager ses carrefours à 90°");
}

// --- 4. Mini-carte flottante (mobile ≤959px) -----------------------------
{
  const css = read("src/style.css");
  assert.ok(/\.mini-map\s*\{[^}]*position:\s*fixed/s.test(css),
    "la mini-carte devient position: fixed en vue mobile");
  assert.ok(/body\.toolbar-busy\s+\.mini-map\s*\{[^}]*bottom:\s*calc\(158px/s.test(css),
    "la mini-carte remonte quand la barre flottante est visible");
  assert.ok(/body\.sheet-open\s+\.mini-map\s*\{[^}]*display:\s*none/s.test(css),
    "la mini-carte s'escamote quand la feuille du bas est ouverte");
  assert.ok(css.includes("calc(80px + env(safe-area-inset-bottom")
    && css.includes("calc(138px + env(safe-area-inset-bottom"),
    "la mini-carte est ancrée au-dessus du menu du bas (959px et 700px)");
  assert.ok(/@media\s*\(max-width:\s*959px\)\s*\{[^}]*\.mini-map\s*\{[^}]*width:\s*120px[^}]*height:\s*80px/s.test(css),
    "la mini-carte flottante est réduite (120×80) pour ne pas manger la carte");
  assert.ok(/@media\s*\(min-width:\s*960px\)[\s\S]*?\.mini-map\s*\{[^}]*width:\s*180px/s.test(css),
    "le desktop garde sa mini-carte intacte");
}

// --- 5. Anti-cache v48 uniforme, cache SW aligné --------------------------
{
  const index = read("index.html");
  assert.ok(!index.includes("?v=47"), "plus de ?v=47 résiduel dans index.html");
  assert.ok((index.match(/\?v=48/g) || []).length >= 3, "anti-cache v48 bumpé (style + module liste + script)");
  const versions = [...index.matchAll(/\?v=(\d+)/g)].map(m => m[1]);
  assert.equal(new Set(versions).size, 1, "anti-cache uniforme");
  const sw = read("sw.js");
  assert.ok(sw.includes("vtl-cache-v48"), "version de cache du service worker alignée (v48)");
}

console.log(JSON.stringify({ ok: true, suite: "v48-map-clutter" }));
