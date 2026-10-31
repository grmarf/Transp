// V29.2 — déssaimage automatique de la voirie.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCity, mulberry32 } from '../src/city.js';
import { developCityCarrefours } from '../src/carrefours.js';
import { createNetwork, validateNetwork, shortestPath } from '../src/network.js';
import { pruneRedundantRoads, pruneOrphanCarrefourStops } from '../src/pruning.js';

function makeStop(id, x, y, waiting = 0) {
  return { id, name: id, x, y, waiting, waitingByDestination: {} };
}

// --- 1. Corde redondante retirée, connectivité préservée --------------------
{
  const city = {
    stops: [makeStop('a', 100, 100), makeStop('b', 400, 100), makeStop('c', 100, 400), makeStop('d', 400, 400)],
    roads: [
      { a: 'a', b: 'b', type: 'street' }, { a: 'b', b: 'd', type: 'street' },
      { a: 'd', b: 'c', type: 'street' }, { a: 'c', b: 'a', type: 'street' },
      { a: 'a', b: 'd', type: 'street' } // diagonale redondante
    ]
  };
  const report = pruneRedundantRoads(city);
  assert.equal(report.removed.length, 1, 'la diagonale redondante doit être retirée (' + report.removed.length + ')');
  assert.ok(report.removed[0].a === 'a' && report.removed[0].b === 'd', 'c\'est la diagonale qui part');
  assert.equal(city.roads.length, 4, 'le carré reste entier');
}

// --- 2. Pont jamais retiré (arbre : tout est un pont) ------------------------
{
  const city = {
    stops: [makeStop('a', 100, 100), makeStop('b', 300, 100), makeStop('c', 500, 100)],
    roads: [{ a: 'a', b: 'b' }, { a: 'b', b: 'c' }]
  };
  const report = pruneRedundantRoads(city);
  assert.equal(report.removed.length, 0, 'aucun pont ne doit être retiré');
  assert.equal(city.roads.length, 2);
}

// --- 3. Voiries du joueur jamais candidates ---------------------------------
{
  const city = {
    stops: [makeStop('a', 100, 100), makeStop('b', 400, 100)],
    roads: [
      { a: 'a', b: 'b', type: 'street' },                                  // générée : candidate
      { a: 'a', b: 'b', type: 'avenue', built: true },                     // construite : jamais
      { a: 'a', b: 'b', type: 'boulevard', corridorId: 'north-south' },    // corridor : jamais
      { points: [{ x: 100, y: 100 }, { x: 400, y: 100 }], type: 'street' } // tracé libre : jamais
    ]
  };
  const report = pruneRedundantRoads(city);
  assert.equal(report.removed.length, 1, 'seule la voirie générée non construite peut partir');
  const remaining = city.roads.map(r => r.type).sort();
  assert.deepEqual(remaining, ['avenue', 'boulevard', 'street']);
}

// --- 4. Arrêts de carrefour orphelins ---------------------------------------
{
  const mkCity = () => ({
    stops: [
      makeStop('a', 100, 300), makeStop('b', 500, 300),
      makeStop('carrefour-1', 300, 300), makeStop('carrefour-2', 800, 800)
    ],
    roads: [{ points: [{ x: 100, y: 300 }, { x: 500, y: 300 }], type: 'avenue' }]
  });
  // carrefour-1 est SUR la voirie (gardé), carrefour-2 est orphelin (retiré).
  const cityA = mkCity();
  const removedA = pruneOrphanCarrefourStops(cityA, new Set());
  assert.equal(removedA.length, 1);
  assert.equal(removedA[0].id, 'carrefour-2');
  assert.ok(cityA.stops.some(s => s.id === 'carrefour-1'), 'l\'arrêt desservi reste');
  // Protégé par une ligne : jamais retiré.
  const cityB = mkCity();
  assert.equal(pruneOrphanCarrefourStops(cityB, new Set(['carrefour-2'])).length, 0);
  // Chargé de passagers : jamais retiré.
  const cityC = mkCity();
  cityC.stops.find(s => s.id === 'carrefour-2').waiting = 5;
  assert.equal(pruneOrphanCarrefourStops(cityC, new Set()).length, 0);
}

// --- 5. Ville générée : idempotence + graphe sain après déssaimage -----------
{
  const city = createCity('V29.2-PRUNING');
  developCityCarrefours(city, mulberry32(city.numericSeed ^ 0xCA2E), {}, null, () => {});
  const roadsBefore = city.roads.length;
  const report = pruneRedundantRoads(city);
  const orphans = pruneOrphanCarrefourStops(city, new Set());
  const againRoads = pruneRedundantRoads(city);
  const againStops = pruneOrphanCarrefourStops(city, new Set());
  assert.equal(againRoads.removed.length + againStops.length, 0, 'le déssaimage doit être idempotent');
  assert.ok(city.roads.length <= roadsBefore, 'jamais plus de voiries après déssaimage');
  const network = createNetwork(city);
  const violations = validateNetwork(network, city, {
    maxEdgeLength: Math.hypot(city.width || 1000, city.height || 650)
  });
  assert.deepStrictEqual(violations, [], 'graphe sain après déssaimage : ' + JSON.stringify(violations));
  for (const stop of city.stops) {
    assert.ok(network.nodes.has(stop.id), 'arrêt absent du graphe : ' + stop.id);
  }
  const road = city.roads.find(r => r.a && r.b);
  assert.ok(road, 'au moins une voirie d\'arrêt à arrêt');
  assert.ok(shortestPath(network, road.a, road.b), 'itinéraire indisponible après déssaimage');
  console.log(JSON.stringify({
    ok: true, suite: 'v29.2-road-pruning',
    roads: roadsBefore + '→' + city.roads.length,
    removed: report.removed.length, orphanStops: orphans.length
  }));
}

// --- 6. Statique : branchement main + ceinture du menu + anti-cache ---------
{
  const mainjs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(mainjs.includes('rationaliseCityRoads'), 'main doit brancher le déssaimage');
  assert.ok(mainjs.includes('Voirie rationalisée'), 'le déssaimage doit être journalisé');
  assert.ok(mainjs.includes('mapMenuCheck'), 'ceinture du menu présente');
  assert.ok(mainjs.includes('pruneRedundantRoads(state.city)'), 'appel effectif au boot');
  const versions = [...html.matchAll(/\?v=(\d+)/g)].map((m) => m[1]);
  assert.equal(new Set(versions).size, 1, 'assets versionnés à l\'identique');
  assert.ok(Number(versions[0]) >= 31, 'anti-cache bumpé (v31)');
}

console.log('v29.2-road-pruning : 6 blocs vérifiés');
