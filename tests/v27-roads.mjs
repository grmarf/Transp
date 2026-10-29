// V27 — modèle de routes typées : 4 catégories, polylignes, jonctions
// automatiques et sens unique. Tests Node purs sur src/network.js.
import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createState } from '../src/state.js';
import {
  ROAD_TYPES, roadType, createNetwork, shortestPath, countComponents,
  roadConstructionCost, polylineLength, edgeBetween
} from '../src/network.js';

// --- 1. Catalogue typé -------------------------------------------------------
for (const [id, spec] of Object.entries(ROAD_TYPES)) {
  assert.equal(spec.id, id, 'un type de route porte son propre id');
  assert.ok(spec.costPerPixel > 0 && spec.speedLimit > 0 && spec.capacity > 0,
    `${id} doit définir coût, vitesse et capacité`);
}
assert.ok(ROAD_TYPES.street.costPerPixel < ROAD_TYPES.avenue.costPerPixel);
assert.ok(ROAD_TYPES.avenue.costPerPixel < ROAD_TYPES.boulevard.costPerPixel);
assert.ok(ROAD_TYPES.boulevard.costPerPixel < ROAD_TYPES.highway.costPerPixel);
assert.ok(ROAD_TYPES.avenue.tramPossible && ROAD_TYPES.boulevard.tramPossible);
assert.ok(!ROAD_TYPES.street.tramPossible && !ROAD_TYPES.highway.tramPossible);
assert.ok(ROAD_TYPES.highway.speedLimit > ROAD_TYPES.street.speedLimit);

// Alias historiques : local/secondary/arterial restent lisibles.
assert.equal(roadType('local').id, 'street');
assert.equal(roadType('secondary').id, 'avenue');
assert.equal(roadType('arterial').id, 'boulevard');
assert.equal(roadType('inconnu').id, 'street');

// Coût de construction proportionnel à la longueur, avec plancher.
assert.equal(roadConstructionCost('street', 100), 45);
assert.equal(roadConstructionCost('avenue', 100), 70);
assert.ok(roadConstructionCost('street', 1) >= 25, 'coût plancher de 25 €');
assert.ok(Math.abs(polylineLength([{x:0,y:0},{x:30,y:40}]) - 50) < 1e-9);

// --- 2. Ville initiale : le graphe reste connexe et typé ---------------------
const city = createCity('v27-roads-seed');
const state = createState(city);
state.network = createNetwork(city);
assert.ok(state.network.edges.length > 0);
assert.ok(state.network.edges.every(edge => edge.type in ROAD_TYPES),
  'toutes les arêtes portent un type du catalogue');
assert.ok(state.network.edges.every(edge => Number.isFinite(edge.weight) && edge.weight > 0));
assert.equal(countComponents(state.network), 1, 'la ville initiale est connexe');
// Les arrêts historiques restent des nœuds du graphe.
for (const stop of city.stops) {
  assert.ok(state.network.nodes.has(stop.id), `l'arrêt ${stop.id} doit être un nœud`);
}
// Règle historique : pas plus de 3 routes par arrêt.
for (const stop of city.stops) {
  assert.ok((state.network.adjacency.get(stop.id) || []).length <= 3);
}

// --- 3. Jonction automatique : deux routes qui se croisent se connectent -----
const cross = {
  id: 'cross-city',
  name: 'Croisement',
  seed: 'cross-city',
  width: 1000, height: 650,
  districts: [], tramTracks: [], junctions: [],
  stops: [
    { id: 'stop-a', name: 'A', x: 100, y: 100, demand: 1, waiting: 0, waitingByDestination: {}, districtId: 'd-a', population: 100, jobs: 100, commerce: 100 },
    { id: 'stop-b', name: 'B', x: 900, y: 100, demand: 1, waiting: 0, waitingByDestination: {}, districtId: 'd-b', population: 100, jobs: 100, commerce: 100 },
    { id: 'stop-c', name: 'C', x: 500, y: 80, demand: 1, waiting: 0, waitingByDestination: {}, districtId: 'd-c', population: 100, jobs: 100, commerce: 100 },
    { id: 'stop-d', name: 'D', x: 500, y: 600, demand: 1, waiting: 0, waitingByDestination: {}, districtId: 'd-d', population: 100, jobs: 100, commerce: 100 }
  ],
  roads: [
    // Horizontale stop-a → stop-b, croisée par la verticale stop-c → stop-d.
    { id: 'road-h', a: 'stop-a', b: 'stop-b', type: 'avenue', built: false },
    { id: 'road-v', a: 'stop-c', b: 'stop-d', type: 'street', built: false }
  ],
  corridors: [], generatedAt: 'test'
};
const crossNetwork = createNetwork(cross);
const junctionNodes = [...crossNetwork.nodes.values()].filter(node => node.kind === 'junction');
assert.equal(junctionNodes.length, 1, 'le croisement doit produire exactement une jonction');
const junction = junctionNodes[0];
assert.ok(Math.abs(junction.x - 500) < 1e-6 && Math.abs(junction.y - 100) < 1e-6,
  'la jonction est au point de croisement (500, 100)');
assert.ok((crossNetwork.adjacency.get(junction.id) || []).length >= 4,
  'la jonction relie les deux demi-routes de chaque voirie');
assert.ok(crossNetwork.edges.some(e => e.a === 'stop-a' && e.b === junction.id));
assert.ok(crossNetwork.edges.some(e => e.a === junction.id && e.b === 'stop-b'));
assert.ok(crossNetwork.edges.some(e => e.a === 'stop-c' && e.b === junction.id));
assert.ok(crossNetwork.edges.some(e => e.a === junction.id && e.b === 'stop-d'));
assert.equal(countComponents(crossNetwork), 1, 'le croisement connecte les deux voiries');

// --- 4. Sens unique respecté par le routage ---------------------------------
const oneWayCity = {
  ...cross,
  id: 'oneway-city',
  roads: [
    { id: 'road-h1', a: 'stop-a', b: 'stop-b', type: 'avenue', built: false, oneWay: true }
  ]
};
const oneWayNetwork = createNetwork(oneWayCity);
assert.ok(oneWayNetwork.edges.some(e => e.a === 'stop-a' && e.oneWay === true));
// a → b possible, b → a impossible.
const forward = shortestPath(oneWayNetwork, 'stop-a', 'stop-b');
assert.ok(forward && forward[forward.length - 1] === 'stop-b', 'le sens unique se traverse dans le bon sens');
assert.equal(shortestPath(oneWayNetwork, 'stop-b', 'stop-a'), null,
  'le sens unique interdit le contre-sens');
assert.ok(oneWayNetwork.edges.every(e => !e.oneWay || e.a === 'stop-a'));
assert.equal((oneWayNetwork.adjacency.get('stop-b') || []).length, 0,
  "l'adjacence ne doit pas exposer le contre-sens");
// Une voirie bidirectionnelle reste traversée dans les deux sens.
const twoWayNetwork = createNetwork({ ...oneWayCity, roads: [{ id: 'road-h1', a: 'stop-a', b: 'stop-b', type: 'avenue', built: false }] });
assert.ok(shortestPath(twoWayNetwork, 'stop-a', 'stop-b'));
assert.ok(shortestPath(twoWayNetwork, 'stop-b', 'stop-a'));

// --- 5. Polyline : une route multi-points suit exactement son tracé ----------
const polyCity = {
  ...cross,
  id: 'poly-city',
  roads: [
    {
      id: 'road-z', type: 'boulevard', built: false, a: 'stop-a', b: 'stop-b',
      points: [{ x: 100, y: 100 }, { x: 500, y: 300 }, { x: 900, y: 100 }]
    }
  ]
};
const polyNetwork = createNetwork(polyCity);
const path = shortestPath(polyNetwork, 'stop-a', 'stop-b');
assert.ok(path, 'la polyline doit être routable');
assert.equal(path[0], 'stop-a');
assert.equal(path[path.length - 1], 'stop-b');
assert.ok(path.length >= 3, 'la polyline passe par son point intermédiaire');
const mid = polyNetwork.nodes.get(path[1]);
assert.ok(Math.abs(mid.x - 500) < 1e-6 && Math.abs(mid.y - 300) < 1e-6,
  'le waypoint intermédiaire fait partie du graphe');
assert.ok(edgeBetween(polyNetwork, 'stop-a', path[1]), 'edgeBetween retrouve l’arête directe');

// --- 6. Démolition implicite : reconstruire sans une route supprime ses nœuds
const removedCity = { ...cross, id: 'removed-city', roads: [cross.roads[0]] };
const removedNetwork = createNetwork(removedCity);
assert.ok(![...removedNetwork.nodes.values()].some(node => node.kind === 'junction'),
  'aucune jonction orpheline ne survit à la suppression de la route croisée');
assert.ok(shortestPath(removedNetwork, 'stop-a', 'stop-b'), 'la voirie restante est routable');
assert.equal((removedNetwork.adjacency.get('stop-c') || []).length, 0,
  "les arrêts de la route supprimée n'ont plus d'arêtes");

// --- 7. Version du modèle d'état ---------------------------------------------
assert.equal(state.version, '23.0');

console.log(JSON.stringify({
  ok: true,
  roadTypes: Object.keys(ROAD_TYPES).length,
  initialEdges: state.network.edges.length,
  junctionsOnCross: junctionNodes.length,
  oneWayRespected: true
}));
