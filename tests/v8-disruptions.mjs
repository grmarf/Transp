import assert from 'node:assert/strict';
import { createCity, mulberry32 } from '../src/city.js';
import { createNetwork, routeLine, shortestPath, countComponents } from '../src/network.js';
import { createState } from '../src/state.js';
import { createLine, finishLine } from '../src/engine.js';
import { updateVehicles } from '../src/vehicles.js';
import { maybeStartRoadworks, maybeEndRoadworks, refreshAllLineRoutes } from '../src/disruptions.js';

const city = createCity('V8-DISRUPT');
const state = createState(city);
state.network = createNetwork(city);
const log = () => {};
const [a, b, c] = city.stops.slice(0, 3).map(s => s.id);

createLine(state);
state.pendingStops = [a, b, c];
assert.equal(finishLine(state, log, routeLine), true);
const line = state.lines[0];
const vehicle = state.vehicles[0];

// --- Pannes ----------------------------------------------------------------
// Une rng qui renvoie toujours 0 déclenche systématiquement la panne (0 < seuil).
const routeIndexBefore = vehicle.routeIndex;
updateVehicles(state, () => 0, log);
assert.ok(vehicle.brokenTicksLeft > 0, 'le véhicule doit tomber en panne');
assert.equal(vehicle.congestion, 0);

updateVehicles(state, () => 1, log); // rng=1 ne redéclenche jamais une panne
assert.equal(vehicle.routeIndex, routeIndexBefore, 'un véhicule en panne ne doit pas avancer');
assert.ok(vehicle.brokenTicksLeft > 0, 'toujours en panne juste après (durée > 1 tick)');

// Sans rng (comportement V3.0-V7.0 par défaut), jamais de panne : non-régression.
const state2 = createState(city);
state2.network = state.network;
state2.lines = state.lines;
state2.vehicles = [{ ...vehicle, id: 999, brokenTicksLeft: 0 }];
updateVehicles(state2);
assert.equal(state2.vehicles[0].brokenTicksLeft, 0, 'sans rng fourni, jamais de panne (compat V3-V7)');

// --- Travaux + reroutage -----------------------------------------------
const directPath = shortestPath(state.network, a, c);
assert.ok(directPath.length >= 2);

// Ferme systématiquement une route tant que le réseau reste connexe (rng=0 -> déclenche, prend la 1ère route ouverte).
let closedSomething = false;
for (let i = 0; i < state.network.edges.length && !closedSomething; i++) {
  maybeStartRoadworks(state, () => 0, log);
  closedSomething = state.network.closedEdgeIds?.size > 0;
  if (!closedSomething) break; // countComponents a refusé -> pas la peine d'insister ici
}
assert.ok(closedSomething, 'au moins une route doit pouvoir être fermée sur ce réseau');
assert.equal(countComponents(state.network), 1, 'le réseau doit rester entièrement connexe après fermeture');

const routeAfterClosure = line.route;
assert.ok(routeAfterClosure, 'la ligne doit conserver un itinéraire (direct ou détourné)');

// Fin des travaux : avance le jour au-delà de la réouverture programmée.
const [closedEdgeId] = state.network.closedEdgeIds;
state.elapsedDays = state.network.roadworksReopenDay.get(closedEdgeId) + 1;
maybeEndRoadworks(state, log);
assert.equal(state.network.closedEdgeIds.size, 0, 'la route doit rouvrir après le délai');

console.log(JSON.stringify({
  ok: true,
  brokenTicksAfterFirstTick: vehicle.brokenTicksLeft,
  closedEdgeId,
  componentsAfterClosure: 1
}));
