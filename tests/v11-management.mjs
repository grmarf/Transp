import assert from 'node:assert/strict';
import { createCity, mulberry32 } from '../src/city.js';
import { createState } from '../src/state.js';
import { createNetwork, routeLine } from '../src/network.js';
import { createLine, finishLine, deleteLine, sellVehicleFromLine, lineOccupancyRate, step } from '../src/engine.js';
import { buyVehicleForLine } from '../src/vehicles.js';

const city = createCity('V11-MGMT');
const state = createState(city);
state.network = createNetwork(city);
const rng = mulberry32(city.numericSeed ^ 0xA57E2);
const logs = [];
const log = m => logs.push(m);

// --- Créer une ligne à 2 véhicules --------------------------------------
createLine(state);
state.pendingStops = [city.stops[0].id, city.stops[1].id, city.stops[2].id];
assert.equal(finishLine(state, log, routeLine, 'bus'), true);
const line = state.lines[0];
const moneyAfterCreation = state.money;
buyVehicleForLine(state, line.id, log);
assert.equal(line.vehicles.length, 2, 'la ligne doit avoir 2 véhicules après achat');

// --- Occupation : 0% tant qu'aucun passager --------------------------------
assert.equal(lineOccupancyRate(state, line), 0);

// --- Vente d'un véhicule : refus si un seul restant ------------------------
const secondVehicleId = line.vehicles[1];
sellVehicleFromLine(state, line.id, secondVehicleId, log);
assert.equal(line.vehicles.length, 1, 'un véhicule vendu -> il en reste 1');
assert.ok(state.money > moneyAfterCreation - 3000, 'le remboursement (50%) doit augmenter la trésorerie');

const lastVehicleId = line.vehicles[0];
const moneyBeforeRefusedSale = state.money;
sellVehicleFromLine(state, line.id, lastVehicleId, log);
assert.equal(line.vehicles.length, 1, 'impossible de vendre le dernier véhicule de la ligne');
assert.equal(state.money, moneyBeforeRefusedSale, "l'argent ne doit pas bouger sur un refus");

// --- Suppression de ligne : véhicules revendus, ligne retirée --------------
for (let i = 0; i < 50; i++) step(state, rng, log);
const passengersOnLine = state.passengers.filter(p => p.vehicleId === lastVehicleId);
const moneyBeforeDelete = state.money;
assert.equal(deleteLine(state, line.id, log), true);
assert.equal(state.lines.length, 0, 'la ligne doit avoir disparu');
assert.equal(state.vehicles.length, 0, 'ses véhicules doivent avoir disparu');
assert.ok(state.money > moneyBeforeDelete, 'la suppression doit rembourser le dernier véhicule');
for (const p of passengersOnLine) {
  assert.equal(p.vehicleId, null, 'un passager embarqué doit être remis en attente, pas perdu');
  assert.equal(p.state, 'WAITING');
}

// --- Suppression d'une ligne inconnue : sans effet -------------------------
assert.equal(deleteLine(state, 9999, log), false);

// --- Suivi journalier (dailyStats) -----------------------------------------
const cityDaily = createCity('V11-DAILY');
const stateDaily = createState(cityDaily);
stateDaily.network = createNetwork(cityDaily);
const rngDaily = mulberry32(cityDaily.numericSeed ^ 0xA57E2);
stateDaily.speed = 1000; // force at least one day boundary quickly
step(stateDaily, rngDaily, () => {});
assert.ok(stateDaily.dailyStats.length >= 1, 'un jour franchi doit produire une entrée dailyStats');
assert.ok('net' in stateDaily.dailyStats[0], 'chaque entrée doit exposer un net journalier');
assert.ok(stateDaily.dailyStats.length <= 14, "l'historique doit rester borné à 14 jours");

console.log(JSON.stringify({
  ok: true,
  lineDeleted: state.lines.length === 0,
  moneyAfterDelete: Math.round(state.money),
  dailyStatsSample: stateDaily.dailyStats[0]
}));
