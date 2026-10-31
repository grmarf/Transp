// V29 — invariants structurels du graphe de voirie (« identité = géométrie »).
//
// Régression du sac de nœuds V28.4 : les voiries sans id produisaient des
// waypoints « waypoint-undefined-N » qui fusionnaient entre voiries (le test
// d'id court-circuitait le test de position) et cousaient des arêtes
// parasites à travers la carte. Le registre V29 fusionne par POSITION,
// jamais par chaîne ; validateNetwork() verrouille la porte en CI.
import assert from 'node:assert/strict';
import { createCity, mulberry32 } from '../src/city.js';
import { developCityCarrefours } from '../src/carrefours.js';
import { createNetwork, validateNetwork, shortestPath, routeLine } from '../src/network.js';

const MAP = { width: 1000, height: 650 };
const DIAG = Math.hypot(MAP.width, MAP.height);

function assertHealthy(label, network, city, options) {
  const settings = Object.assign({ maxEdgeLength: DIAG, checkNearDuplicates: true }, options || {});
  const violations = validateNetwork(network, city, settings);
  assert.deepStrictEqual(violations, [], label + ' : invariants violés : ' + JSON.stringify(violations));
}

// --- 1. Régression : deux voiries SANS id, waypoints d'indices identiques -----
// mais positions éloignées. Avec le bug : fusion des « waypoint-undefined-N »
// entre voiries, arêtes de ~400 px cousues à travers la carte.
{
  const city = {
    width: MAP.width, height: MAP.height,
    id: 'v29-regression', name: 'Régression', seed: 'v29', districts: [],
    stops: [
      { id: 'stop-a', name: 'A', x: 100, y: 100 },
      { id: 'stop-b', name: 'B', x: 400, y: 100 },
      { id: 'stop-c', name: 'C', x: 400, y: 500 }
    ],
    roads: [
      { type: 'street', points: [{ x: 100, y: 100 }, { x: 250, y: 100 }, { x: 400, y: 100 }] },
      { type: 'street', points: [{ x: 100, y: 500 }, { x: 250, y: 500 }, { x: 400, y: 500 }] }
    ]
  };
  const network = createNetwork(city);
  assertHealthy('voiries sans id', network, city, { maxEdgeLength: 200 });
  for (const id of network.nodes.keys()) {
    assert.match(id, /^[A-Za-z0-9_-]+$/, 'id de nœud invalide : ' + id);
  }
  // Les deux voiries restent DISJOINTES : 3 arrêts + 3 waypoints = 6 nœuds.
  assert.equal(network.nodes.size, 6, '6 nœuds attendus, ' + network.nodes.size + ' trouvés');
  assert.equal(shortestPath(network, 'stop-a', 'stop-c'), null,
    'les voiries disjointes ne doivent pas se rejoindre');
  const route = routeLine(network, ['stop-a', 'stop-b']);
  assert.ok(route, 'itinéraire A→B indisponible');
  assert.ok(Math.abs(route.totalLength - 300) < 0.01,
    'longueur A→B inattendue : ' + route.totalLength);
}

// --- 2. Carrefour plié à 90° : le croisement fusionne dans l'arrêt ------------
{
  const city = {
    width: MAP.width, height: MAP.height,
    id: 'v29-carrefour', name: 'Carrefour', seed: 'v29c', districts: [],
    stops: [
      { id: 'stop-a', name: 'A', x: 100, y: 300 },
      { id: 'stop-b', name: 'B', x: 500, y: 300 },
      { id: 'carrefour-1', name: 'Carrefour du marché', x: 300, y: 300 }
    ],
    roads: [
      { type: 'avenue', points: [{ x: 100, y: 300 }, { x: 500, y: 300 }] },
      { type: 'street', points: [{ x: 300, y: 100 }, { x: 300, y: 500 }] }
    ]
  };
  const network = createNetwork(city);
  assertHealthy('carrefour plié', network, city, { maxEdgeLength: 250 });
  assert.equal((network.adjacency.get('carrefour-1') || []).length, 4,
    "l'arrêt de carrefour porte les 4 demi-arêtes du croisement");
  assert.equal(network.nodes.size, 5, '5 nœuds attendus (3 arrêts + 2 extrémités libres)');
  assert.deepEqual(shortestPath(network, 'stop-a', 'stop-b'),
    ['stop-a', 'carrefour-1', 'stop-b'], 'A→B passe par le carrefour');
}

// --- 3. Voiries confondues : fusion par position, aucun doublon ----------------
{
  const city = {
    width: MAP.width, height: MAP.height,
    id: 'v29-confondues', name: 'Confondues', seed: 'v29d', districts: [],
    stops: [
      { id: 'stop-a', name: 'A', x: 100, y: 100 },
      { id: 'stop-b', name: 'B', x: 400, y: 100 }
    ],
    roads: [
      { id: 'road-1', type: 'street', points: [{ x: 100, y: 100 }, { x: 250, y: 100 }, { x: 400, y: 100 }] },
      { id: 'road-2', type: 'street', points: [{ x: 100, y: 100 }, { x: 250, y: 100 }, { x: 400, y: 100 }] }
    ]
  };
  const network = createNetwork(city);
  assertHealthy('voiries confondues', network, city, { maxEdgeLength: 200 });
  assert.equal(network.nodes.size, 3, 'les voiries confondues partagent leurs nœuds');
  assert.equal([...network.nodes.values()].filter((node) => node.kind === 'waypoint').length, 1,
    'un seul waypoint à (250, 100)');
  for (const edge of network.edges) {
    assert.ok(edge.length > 0.001, 'aucune arête de longueur nulle');
  }
}

// --- 4. Ids de voirie dupliqués (import de sauvegarde) : jamais de fusion ------
// Le correctif V28.4 donnait un uid par voirie, mais un id DUPLIQUÉ reste
// possible dans une sauvegarde importée : l'uid est alors partagé et le bug
// réapparaît. V29 : l'étiquette ne fusionne plus rien, seule la position compte.
{
  const city = {
    width: MAP.width, height: MAP.height,
    id: 'v29-dup', name: 'Dupliqués', seed: 'v29e', districts: [],
    stops: [
      { id: 'stop-a', name: 'A', x: 100, y: 100 },
      { id: 'stop-b', name: 'B', x: 400, y: 100 }
    ],
    roads: [
      { id: 'road-x', type: 'street', points: [{ x: 100, y: 100 }, { x: 250, y: 100 }, { x: 400, y: 100 }] },
      { id: 'road-x', type: 'street', points: [{ x: 100, y: 500 }, { x: 250, y: 500 }, { x: 400, y: 500 }] }
    ]
  };
  const network = createNetwork(city);
  assertHealthy('ids dupliqués', network, city, { maxEdgeLength: 200 });
  assert.equal(network.nodes.size, 6, 'aucun waypoint ne fusionne malgré l\'id partagé');
  for (const edge of network.edges) {
    assert.ok(edge.length <= 150.01, 'arête parasite de ' + edge.length + ' px malgré l\'id dupliqué');
  }
}

// --- 5. Le garde-fou détecte chaque catégorie d'anomalie ----------------------
{
  const fake = {
    nodes: new Map([
      ['stop-a', { id: 'stop-a', x: 0, y: 0 }],
      ['waypoint-undefined-1', { id: 'waypoint-undefined-1', x: 100, y: 100 }],
      ['wp-dup', { id: 'wp-dup', x: 50, y: 50 }],
      ['wp-dup-2', { id: 'wp-dup-2', x: 50.2, y: 50 }]
    ]),
    edges: [
      { id: 'edge-1', a: 'stop-a', b: 'waypoint-undefined-1', length: 141 },
      { id: 'edge-2', a: 'stop-a', b: 'ghost', length: 100 },
      { id: 'edge-3', a: 'stop-a', b: 'waypoint-undefined-1', length: 5000 }
    ],
    adjacency: new Map([
      ['stop-a', [{ to: 'waypoint-undefined-1' }, { to: 'ghost' }]],
      ['wp-dup', [{ to: 'wp-dup-2' }]]
    ])
  };
  const violations = validateNetwork(fake, { stops: [{ id: 'stop-b', name: 'B', x: 200, y: 200 }] },
    { maxEdgeLength: 1000, checkNearDuplicates: true });
  assert.ok(violations.length >= 5, 'le garde-fou doit signaler plusieurs anomalies (' + violations.length + ')');
  const text = violations.join(' | ');
  assert.ok(text.includes('« ghost » inexistant'), 'référence pendante détectée');
  assert.ok(text.includes('identité corrompue'), 'identité « undefined » détectée');
  assert.ok(text.includes('5000 px'), 'arête trop longue détectée');
  assert.ok(text.includes('arrêt « stop-b » absent'), 'arrêt absent détecté');
  assert.ok(text.includes('quasi confondus'), 'quasi-doublon détecté');
  assert.ok(text.includes('cible inexistante'), 'adjacency pendante détectée');
}

// --- 6. Ville générée + carrefours : le graphe reste sain de bout en bout ------
{
  const city = createCity('V29-INVARIANTS');
  developCityCarrefours(city, mulberry32(city.numericSeed ^ 0xCA2E), {}, null, () => {});
  const network = createNetwork(city);
  assertHealthy('ville générée', network, city, {
    maxEdgeLength: Math.hypot(city.width || MAP.width, city.height || MAP.height)
  });
  for (const stop of city.stops) {
    assert.ok(network.nodes.has(stop.id), 'l\'arrêt ' + stop.id + ' doit être un nœud du graphe');
  }
}

console.log(JSON.stringify({ ok: true, invariant: 'identité géométrique', registry: 'position' }));
