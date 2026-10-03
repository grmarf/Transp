import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createState } from '../src/state.js';
import { createNetwork, routeLine } from '../src/network.js';
import { createLine, finishLine } from '../src/engine.js';
import { COVERAGE_RADIUS_PX, coverageByDistrict, coverageRatio, servedStopIds } from '../src/coverage.js';

const city = createCity('V22-COVERAGE');
const state = createState(city);
state.network = createNetwork(city);

assert.equal(coverageRatio(state), 0, 'aucune ligne → couverture nulle');
assert.equal(servedStopIds(state).size, 0);

const [a, b] = city.stops.slice(0, 2).map(s => s.id);
createLine(state);
state.pendingStops = [a, b];
assert.equal(finishLine(state, () => {}, routeLine, 'bus'), true);

assert.equal(servedStopIds(state).size, 2, 'les deux arrêts de la ligne sont desservis');
const ratio = coverageRatio(state);
assert.ok(ratio > 0, 'une ligne active couvre une part de population');
assert.ok(ratio <= 1, 'la couverture est un ratio');
if (city.stops.length > 2) {
  assert.ok(ratio < 1, 'une ligne sur deux arrêts ne couvre pas toute la ville');
}

// Chaque district de la ville est rapporté avec un ratio valide.
const districts = coverageByDistrict(state);
for (const stop of city.stops) {
  const entry = districts[stop.districtId];
  assert.ok(entry !== undefined, `district ${stop.districtId} rapporté`);
  assert.ok(entry.ratio >= 0 && entry.ratio <= 1, 'ratio de district valide');
}
assert.ok(COVERAGE_RADIUS_PX > 0);

console.log(JSON.stringify({ ok: true, stops: city.stops.length, ratio: Number(ratio.toFixed(3)) }));
