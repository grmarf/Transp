import assert from 'node:assert/strict';
import { createCity, mulberry32 } from '../src/city.js';
import { createState } from '../src/state.js';
import { createNetwork, routeLine } from '../src/network.js';
import {
  createLine, finishLine, cancelLineMode, startExtendLine, finishExtendLine,
  networkOpportunities, step
} from '../src/engine.js';
import { buyVehicleForLine } from '../src/vehicles.js';

const city = createCity('V12-EXTEND');
const state = createState(city);
state.network = createNetwork(city);
const logs = [];
const log = m => logs.push(m);

// --- Créer une ligne à 2 arrêts --------------------------------------------
createLine(state);
state.pendingStops = [city.stops[0].id, city.stops[1].id];
assert.equal(finishLine(state, log, routeLine, 'bus'), true);
const line = state.lines[0];
assert.equal(line.stopIds.length, 2);

// --- Extension : refus si aucun arrêt sélectionné ---------------------------
assert.equal(startExtendLine(state, line.id), true);
assert.equal(state.lineMode, true);
assert.equal(state.extendingLineId, line.id);
assert.equal(finishExtendLine(state, log, routeLine), false, "aucun arrêt en attente -> refus");

// --- Extension : ajout d'un 3e arrêt ----------------------------------------
state.pendingStops = [city.stops[2].id];
const moneyBefore = state.money;
assert.equal(finishExtendLine(state, log, routeLine), true);
assert.equal(line.stopIds.length, 3, 'la ligne doit avoir 3 arrêts après extension');
assert.equal(line.stopIds[2], city.stops[2].id);
assert.ok(state.money < moneyBefore, "l'extension doit coûter de l'argent");
assert.equal(state.lineMode, false, 'le mode ligne doit être quitté après extension');
assert.equal(state.extendingLineId, null);

// --- Extension impossible : ligne inconnue ----------------------------------
assert.equal(startExtendLine(state, 9999), false);

// --- cancelLineMode nettoie bien extendingLineId ----------------------------
startExtendLine(state, line.id);
cancelLineMode(state);
assert.equal(state.extendingLineId, null);
assert.equal(state.lineMode, false);

// --- Opportunités : ligne déficitaire ---------------------------------------
line.income = 10;
line.expenses = 500;
const opp1 = networkOpportunities(state);
assert.ok(opp1.unprofitableLine, 'une ligne clairement déficitaire doit être signalée');
assert.equal(opp1.unprofitableLine.line.id, line.id);

// --- Opportunités : ligne saturée -------------------------------------------
buyVehicleForLine(state, line.id, log); // 2e véhicule, pour ne pas bloquer plus tard
const lineVehicles = state.vehicles.filter(veh => veh.lineId === line.id);
for (const v of lineVehicles) {
  v.capacity = 10;
  v.onboard = Array.from({ length: 9 }, (_, i) => 1000 + i); // 90% occupation
}
const opp2 = networkOpportunities(state);
assert.ok(opp2.saturatedLine, 'une ligne à forte occupation doit être signalée');

// --- Opportunités : aucun signal sur un réseau neuf sans lignes -------------
const cityEmpty = createCity('V12-EMPTY');
const stateEmpty = createState(cityEmpty);
stateEmpty.network = createNetwork(cityEmpty);
const oppEmpty = networkOpportunities(stateEmpty);
assert.equal(oppEmpty.unprofitableLine, null);
assert.equal(oppEmpty.saturatedLine, null);

console.log(JSON.stringify({
  ok: true,
  stopsAfterExtension: line.stopIds.length,
  unprofitableDetected: !!opp1.unprofitableLine,
  saturatedDetected: !!opp2.saturatedLine
}));
