import assert from 'node:assert/strict';
import { createCity, mulberry32 } from '../src/city.js';
import { createNetwork, routeLine } from '../src/network.js';
import { createState } from '../src/state.js';
import { createLine, finishLine, step } from '../src/engine.js';
import { updateVehicles } from '../src/vehicles.js';

const city = createCity('V9.1-FASTFORWARD');
const state = createState(city);
state.network = createNetwork(city);
const log = () => {};
const [a, b, c] = city.stops.slice(0, 3).map(s => s.id);

createLine(state);
state.pendingStops = [a, b, c];
assert.equal(finishLine(state, log, routeLine), true);
const vehicle = state.vehicles[0];

// --- Vitesse normale : comportement strictement inchangé -------------------
// Même position de départ, même unique appel : le nouveau code par étapes
// doit reproduire exactement l'ancien calcul à un seul saut.
vehicle.routeIndex = 0; vehicle.progress = 0;
state.speed = 1;
updateVehicles(state, () => 1, log);
const progressNormalSpeed = vehicle.progress;
assert.ok(progressNormalSpeed > 0 && progressNormalSpeed < 0.01, 'à vitesse normale, un seul tick avance très peu (comportement V3.0-V9.0 inchangé)');

// --- Vitesse x1000 : plusieurs arrêts franchis en un seul tick -------------
vehicle.routeIndex = 0; vehicle.progress = 0;
state.speed = 1000;
const routeIndexBefore = vehicle.routeIndex;
updateVehicles(state, () => 1, log);
assert.notEqual(vehicle.routeIndex, routeIndexBefore, "à vitesse x1000, le véhicule doit franchir au moins un arrêt en un tick");

// --- step() : plusieurs jours franchis en un seul tick à vitesse x1000 -----
const state2 = createState(createCity('V9.1-DAYS'));
state2.network = createNetwork(state2.city);
state2.speed = 1000; // 10 000 min/tick ≈ 6,9 jours
const rng2 = mulberry32(state2.city.numericSeed ^ 0x91);
const daysBefore = state2.elapsedDays;
step(state2, rng2, log);
assert.ok(state2.elapsedDays - daysBefore >= 5, `plusieurs jours doivent être comptabilisés en un seul tick (obtenu: ${state2.elapsedDays - daysBefore})`);

// --- Non-régression : vitesse normale, un seul jour au maximum par tick ---
const state3 = createState(createCity('V9.1-DAYS-NORMAL'));
state3.network = createNetwork(state3.city);
state3.speed = 1;
state3.time = 1430;
const rng3 = mulberry32(state3.city.numericSeed ^ 0x91);
step(state3, rng3, log);
assert.equal(state3.elapsedDays, 1, 'à vitesse normale, au plus un jour par tick (inchangé)');

console.log(JSON.stringify({
  ok: true,
  progressNormalSpeed: Number(progressNormalSpeed.toFixed(5)),
  routeIndexAfterFastForward: vehicle.routeIndex,
  daysCrossedAt1000x: state2.elapsedDays - daysBefore
}));
