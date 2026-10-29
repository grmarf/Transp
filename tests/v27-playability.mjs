// V27.1 — jouabilité au démarrage : une partie fraîche (buildingsEnabled,
// aucune zone, aucun bâtiment) doit quand même générer des passagers via la
// génération historique (repli), puis les zones d'amorçage doivent lancer
// l'urbanisme et faire basculer la demande vers l'OD des bâtiments.
import assert from 'node:assert/strict';
import { createCity, mulberry32 } from '../src/city.js';
import { createState } from '../src/state.js';
import { createNetwork, routeLine } from '../src/network.js';
import { generateDemand, finishLine } from '../src/engine.js';
import { odHasOrigins } from '../src/od.js';
import {
  ensureBuildingsState, seedInitialZones, updateBuildings,
  ZONE_ROAD_ADJACENCY_PX, zoneToRoadDistance
} from '../src/buildings.js';

const log = () => {};
const city = createCity('V27-PLAYABILITY');
const state = createState(city, null);
state.network = createNetwork(city);
state.buildingsEnabled = true;
ensureBuildingsState(state);

// --- 1. Partie fraîche : le repli historique alimente la demande ------------
assert.equal(odHasOrigins(state), false, 'aucune origine OD au démarrage');
let rng = mulberry32(42);
// Une ligne de bus sur les deux premiers arrêts pour un réseau actif.
state.pendingStops = city.stops.slice(0, 2).map(s => s.id);
assert.equal(finishLine(state, log, routeLine, 'bus'), true, 'création de ligne');
// Des ticks en heure de pointe : la demande historique doit s'accumuler
// (pools fractionnaires aux arrêts) et finir par créer des passagers.
state.time = 7 * 60;
let generated = 0;
for (let tick = 0; tick < 300 && generated === 0; tick++) {
  generateDemand(state, rng);
  state.time = (state.time + 10) % 1440;
  generated = state.passengers.length;
}
assert.ok(generated > 0, `une partie fraîche doit générer des passagers (repli historique), ${generated} trouvés`);
assert.ok(state.totalDemand > 0, 'la demande cumulée doit être positive');

// --- 2. Amorçage : zones collées à la voirie, idempotent --------------------
const seeded = seedInitialZones(state, mulberry32(7));
assert.ok(seeded >= 4, `des zones d'amorçage doivent être peintes (${seeded})`);
assert.equal(seedInitialZones(state, mulberry32(7)), 0, 'l’amorçage est idempotent');
for (const zone of state.city.zones) {
  assert.ok(zoneToRoadDistance(state, zone) <= ZONE_ROAD_ADJACENCY_PX,
    'chaque zone d’amorçage longe une route');
}

// --- 3. Croissance puis bascule OD -------------------------------------------
for (let h = 1; h <= 24 && !odHasOrigins(state); h++) {
  updateBuildings(state, mulberry32(100 + h), h, log);
}
assert.ok(state.city.buildings.length > 0, 'des bâtiments émergent en 24 h simulées');
assert.equal(odHasOrigins(state), true, 'les bâtiments peuplés deviennent des origines OD');

// --- 4. Avec des origines, l'OD prend le relais (créneau matinal) ------------
state.time = 7 * 60;
const passengersBefore = state.passengers.length;
const suppressedBefore = state.odSuppressed || 0;
rng = mulberry32(123);
for (let tick = 0; tick < 30; tick++) generateDemand(state, rng);
assert.ok(state.passengers.length > passengersBefore || (state.odSuppressed || 0) > suppressedBefore,
  'l’OD matinale alimente le réseau ou compte la demande non couverte');

console.log(JSON.stringify({
  ok: true,
  generated,
  seeded,
  buildings: state.city.buildings.length,
  odSuppressed: state.odSuppressed || 0
}));
