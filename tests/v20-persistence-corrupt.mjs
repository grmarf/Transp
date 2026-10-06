import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createState } from '../src/state.js';
import { createNetwork, createUndergroundNetwork } from '../src/network.js';
import { finishLine } from '../src/engine.js';
import { serializeState, validateSavePayload } from '../src/persistence.js';

function basePayload() {
  const state = createState(createCity('V20-CORRUPT'));
  state.network = createNetwork(state.city);
  state.undergroundNetwork = createUndergroundNetwork(state.city);
  return serializeState(state, 123);
}

function corrupted(mutator) {
  const payload = structuredClone(basePayload());
  mutator(payload);
  return payload;
}

const valid = basePayload();
assert.equal(validateSavePayload(valid), valid, 'une sauvegarde complète doit rester valide');

const invalidCases = [
  ['ligne null', payload => { payload.state.lines = [null]; }],
  ['véhicule null', payload => { payload.state.vehicles = [null]; }],
  ['passager null', payload => { payload.state.passengers = [null]; }],
  ['arrêt incomplet', payload => { payload.state.city.stops[0] = {}; }],
  ['route vers arrêt inconnu', payload => { payload.state.city.roads[0].b = 'stop-unknown'; }],
  ['RNG négatif', payload => { payload.rngState = -1; }],
  ['RNG hors uint32', payload => { payload.rngState = 0x100000000; }],
  // La dette est desormais legale (voir engine.js) ; on verifie a la place
  // qu'un argent non numerique reste refuse.
  ['argent non numérique', payload => { payload.state.money = NaN; }],
  ['heure hors journée', payload => { payload.state.time = 1440; }],
  ['réseau mal sérialisé', payload => { payload.state.network.closedEdgeIds = ['road-1', 42]; }],
];

for (const [label, mutator] of invalidCases) {
  assert.throws(
    () => validateSavePayload(corrupted(mutator)),
    /Sauvegarde V20 invalide/,
    `${label} doit être refusé`
  );
}

// Vérifie aussi les références croisées sur une sauvegarde qui contient une ligne.
const withLine = basePayload();
const state = structuredClone(withLine.state);
const first = state.city.stops.slice(0, 2).map(stop => stop.id);
state.network = createNetwork(state.city);
state.undergroundNetwork = createUndergroundNetwork(state.city);
state.money = 50000;
state.lineMode = true;
state.pendingStops = first;
assert.equal(finishLine(state, () => {}, (network, ids) => {
  // Importer routeLine ici rend le test lisible sans dépendre du DOM.
  return routeLine(network, ids);
}), true);
const linePayload = serializeState(state, 456);
assert.equal(validateSavePayload(linePayload), linePayload);
assert.throws(() => validateSavePayload(corrupted(payload => {
  payload.state = structuredClone(linePayload.state);
  payload.state.lines[0].vehicles = [99999];
})), /Sauvegarde V20 invalide/);
assert.throws(() => validateSavePayload(corrupted(payload => {
  payload.state = structuredClone(linePayload.state);
  payload.state.vehicles[0].lineId = 99999;
})), /Sauvegarde V20 invalide/);

console.log(JSON.stringify({ ok: true, rejected: invalidCases.length + 2 }));

// Kept at the bottom to make the route callback above explicit in the test.
import { routeLine } from '../src/network.js';
