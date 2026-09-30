import assert from 'node:assert/strict';
import { createCity, mulberry32 } from '../src/city.js';
import { createNetwork, routeLine } from '../src/network.js';
import { createState } from '../src/state.js';
import { createLine, finishLine } from '../src/engine.js';
import { buyVehicleForLine, updateVehicles, computeEdgeLoad, VEHICLE_MODES, vehicleMode } from '../src/vehicles.js';

const city = createCity('V7-MODES');
const state = createState(city);
state.network = createNetwork(city);
const log = () => {};
const [a, b, c] = city.stops.slice(0, 3).map(s => s.id);

// --- Rétrocompatibilité : pas de mode précisé -> bus, comportement V9.1 ----
createLine(state);
state.pendingStops = [a, b, c];
const moneyBefore = state.money;
assert.equal(finishLine(state, log, routeLine), true);
const busLine = state.lines[0];
assert.equal(busLine.mode, 'bus');
assert.equal(state.vehicles[0].mode, 'bus');
assert.equal(state.vehicles[0].capacity, VEHICLE_MODES.bus.capacity);
assert.equal(state.vehicles[0].congestionResistance, 0);
const busLineCost = moneyBefore - state.money;

// --- Un métro coûte plus cher à la création (infrastructure) --------------
createLine(state);
state.pendingStops = [a, b, c];
const moneyBeforeMetro = state.money;
assert.equal(finishLine(state, log, routeLine, 'metro'), true);
const metroLine = state.lines[1];
assert.equal(metroLine.mode, 'metro');
const metroLineCost = moneyBeforeMetro - state.money;
assert.ok(metroLineCost > busLineCost, "une ligne de métro doit coûter plus cher qu'une ligne de bus (infrastructure)");

const metroVehicle = state.vehicles.find(v => v.lineId === metroLine.id);
assert.equal(metroVehicle.capacity, VEHICLE_MODES.metro.capacity);
assert.ok(metroVehicle.capacity > state.vehicles[0].capacity, 'le métro doit avoir une capacité bien supérieure au bus');
assert.equal(metroVehicle.congestionResistance, 1);

// --- Achat d'un véhicule : coût dépendant du mode de la ligne --------------
const moneyBeforeBuy = state.money;
assert.equal(buyVehicleForLine(state, busLine.id, log), true);
assert.equal(moneyBeforeBuy - state.money, VEHICLE_MODES.bus.purchaseCost);

const moneyBeforeBuyMetro = state.money;
assert.equal(buyVehicleForLine(state, metroLine.id, log), true);
assert.equal(moneyBeforeBuyMetro - state.money, VEHICLE_MODES.metro.purchaseCost);
assert.ok(VEHICLE_MODES.metro.purchaseCost > VEHICLE_MODES.bus.purchaseCost);

// --- Résistance à la congestion : le métro l'ignore, le bus la subit ------
// Force les deux véhicules d'origine (bus + métro) sur le même tronçon partagé.
const busVehicle = state.vehicles[0];
busVehicle.routeIndex = 0; busVehicle.progress = 0.1;
metroVehicle.routeIndex = 0; metroVehicle.progress = 0.5;
const load = computeEdgeLoad(state);
assert.ok([...load.values()].some(n => n >= 2), 'au moins un tronçon doit être partagé par 2 véhicules');

updateVehicles(state, () => 1, log);
assert.ok(busVehicle.congestion < 1, 'le bus doit être ralenti par la congestion partagée');
assert.equal(metroVehicle.congestion, 1, "le métro, grade-séparé, doit rester à l'abri de la congestion");

console.log(JSON.stringify({
  ok: true,
  busLineCost,
  metroLineCost,
  busCongestion: Number(busVehicle.congestion.toFixed(3)),
  metroCongestion: metroVehicle.congestion
}));
