import assert from 'node:assert/strict';
import { createCity, mulberry32 } from '../src/city.js';
import { createNetwork, routeLine } from '../src/network.js';
import { createState } from '../src/state.js';
import { createLine, finishLine, step } from '../src/engine.js';
import { buyVehicleForLine } from '../src/vehicles.js';
import { serviceLevel, growCity, SATELLITE_POP_THRESHOLD } from '../src/growth.js';

const city = createCity('V6-GROWTH');
const state = createState(city);
state.network = createNetwork(city);
const log = () => {};
const [a, b, c] = city.stops.slice(0, 3).map(s => s.id);

// --- Desserte : un arrêt sans ligne a un niveau de service nul ------------
const unserved = city.stops.find(s => s.id !== a && s.id !== b);
assert.equal(serviceLevel(state, unserved), 0);

createLine(state);
state.pendingStops = [a, b, c];
assert.equal(finishLine(state, log, routeLine), true);
const line = state.lines[0];
// Renforce la fréquence comme le ferait un joueur (V3.0) pour obtenir une
// desserte correcte : un seul véhicule donne un intervalle de plusieurs
// milliers de minutes (voir tests/v3-realism.mjs), donc un service jugé
// "bon" nécessite déjà plusieurs véhicules avec ce moteur.
for (let i = 0; i < 3; i++) buyVehicleForLine(state, line.id, log);
assert.ok(serviceLevel(state, city.stops.find(s => s.id === a)) > 0, 'un arrêt desservi a un niveau de service > 0');

// --- Croissance : un arrêt bien desservi croît plus vite qu'un arrêt isolé
const served = city.stops.find(s => s.id === a);
const isolated = city.stops.find(s => s.id !== a && s.id !== b && s.id !== c);
const servedPopBefore = served.population;
const isolatedPopBefore = isolated.population;

const rng = mulberry32(city.numericSeed ^ 0x6);
growCity(state, rng, log);

assert.ok(served.population > servedPopBefore, "un arrêt desservi doit croître");
assert.ok(isolated.population > isolatedPopBefore, "même un arrêt isolé croît un peu (croissance de fond)");
const servedGrowth = served.population / servedPopBefore;
const isolatedGrowth = isolated.population / isolatedPopBefore;
assert.ok(servedGrowth > isolatedGrowth, "la desserte doit accélérer la croissance par rapport à un arrêt isolé");

// --- Nouveau quartier : un arrêt desservi et très peuplé finit par en générer un
served.population = SATELLITE_POP_THRESHOLD + 100;
const stopsBefore = city.stops.length;
const nodesBefore = state.network.nodes.size;
growCity(state, rng, log);

assert.equal(city.stops.length, stopsBefore + 1, "un nouveau quartier doit apparaître");
assert.equal(state.network.nodes.size, nodesBefore + 1, "le nouveau quartier doit être raccordé au réseau");
assert.equal(served.hasSpawnedSatellite, true);

const newStop = city.stops[city.stops.length - 1];
assert.ok(state.network.adjacency.get(newStop.id)?.length > 0, "le nouveau nœud doit avoir une connexion réseau");

// L’expansion est désormais continue et ne s’arrête pas après un seul satellite.
const stopsAfterOne = city.stops.length;
growCity(state, rng, log);
assert.equal(city.stops.length, stopsAfterOne + 1, "la ville doit continuer à se développer sans plafond");

// --- Intégration : step() déclenche bien la croissance une fois par jour -
const state2 = createState(createCity('V6-STEP'));
state2.network = createNetwork(state2.city);
const rng2 = mulberry32(state2.city.numericSeed ^ 0x7);
const popBefore = state2.city.stops[0].population;
state2.time = 1430; // à 10 min de la fin de journée
step(state2, rng2, log);
assert.equal(state2.elapsedDays, 1, "un jour doit s'écouler quand on franchit minuit");
assert.notEqual(state2.city.stops[0].population, popBefore, "la croissance doit s'appliquer au franchissement du jour");

console.log(JSON.stringify({
  ok: true,
  servedGrowth: Number(servedGrowth.toFixed(4)),
  isolatedGrowth: Number(isolatedGrowth.toFixed(4)),
  newStopsAfterGrowth: city.stops.length
}));
