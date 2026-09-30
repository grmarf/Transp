import assert from 'node:assert/strict';
import { createCity, mulberry32 } from '../src/city.js';
import { createNetwork, routeLine } from '../src/network.js';
import { createState } from '../src/state.js';
import { createLine, finishLine, step, satisfaction } from '../src/engine.js';
import {
  buyVehicleForLine,
  lineHeadwayMinutes,
  computeEdgeLoad,
  ADD_VEHICLE_COST,
  updateVehicles
} from '../src/vehicles.js';
import { waitStats } from '../src/passengers.js';

const city = createCity('V3-REALISM');
const state = createState(city);
state.network = createNetwork(city);
const log = () => {};
const [a, b, c] = city.stops.slice(0, 3).map(s => s.id);

createLine(state);
state.pendingStops = [a, b, c];
assert.equal(finishLine(state, log, routeLine), true);
const line = state.lines[0];

// --- Fréquence ---------------------------------------------------------
const headwayBefore = lineHeadwayMinutes(state, line);
assert.ok(headwayBefore > 0, 'une ligne avec 1 véhicule doit avoir un intervalle > 0');

const moneyBefore = state.money;
assert.equal(buyVehicleForLine(state, line.id, log), true);
assert.equal(state.vehicles.length, 2);
assert.equal(state.money, moneyBefore - ADD_VEHICLE_COST);

const headwayAfter = lineHeadwayMinutes(state, line);
assert.ok(headwayAfter < headwayBefore, 'ajouter un véhicule doit réduire l\'intervalle (fréquence accrue)');

// Refuser l'achat si fonds insuffisants.
state.money = 0;
assert.equal(buyVehicleForLine(state, line.id, log), false);
assert.equal(state.vehicles.length, 2);

// --- Congestion ----------------------------------------------------------
// Force les deux véhicules sur le même segment réseau et vérifie le ralentissement.
const ids = line.route.nodeIds;
state.vehicles[0].routeIndex = 0;
state.vehicles[0].progress = 0.1;
state.vehicles[1].routeIndex = 0;
state.vehicles[1].progress = 0.5;

const load = computeEdgeLoad(state);
const sharedKey = [...load.keys()][0];
assert.equal(load.get(sharedKey), 2, 'les deux véhicules doivent partager le même tronçon');

updateVehicles(state);
assert.ok(state.vehicles[0].congestion < 1, 'un véhicule sur un tronçon partagé doit être ralenti');
assert.equal(state.vehicles[0].congestion, state.vehicles[1].congestion);

// Un véhicule seul sur son tronçon n'est pas congestionné.
state.vehicles[1].routeIndex = Math.min(3, ids.length - 1);
state.vehicles[1].progress = 0.1;
updateVehicles(state);
assert.equal(state.vehicles[0].congestion, 1);

// --- Attente réelle --------------------------------------------------------
const rng = mulberry32(city.numericSeed ^ 0xA57E2);
for (let i = 0; i < 60; i++) step(state, rng, log);

assert.ok(state.passengers.length > 0, 'des agents passagers doivent avoir été générés');
const stats = waitStats(state);
assert.ok(stats.waitingCount > 0, 'au moins un passager doit être en attente ou en correspondance');
assert.ok(Number.isFinite(stats.avgWaitMinutes) && stats.avgWaitMinutes >= 0);
const s = satisfaction(state);
assert.ok(s >= 0 && s <= 100, 'satisfaction doit rester dans [0,100]');

console.log(JSON.stringify({
  ok: true,
  headwayBefore: Number(headwayBefore.toFixed(2)),
  headwayAfter: Number(headwayAfter.toFixed(2)),
  congestionShared: state.vehicles[0].congestion,
  waitStats: stats,
  satisfaction: s
}));
