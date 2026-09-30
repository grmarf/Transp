import assert from 'node:assert/strict';
import { createCity, mulberry32 } from '../src/city.js';
import { createNetwork, routeLine } from '../src/network.js';
import { createState } from '../src/state.js';
import { createLine, finishLine, generateDemand } from '../src/engine.js';
import { updateVehicles } from '../src/vehicles.js';

// Demand integration: one 100-minute step must match ten 10-minute slices
// when starting from the same state and RNG sequence.
const make = () => {
  const city = createCity('V10-TIME');
  const state = createState(city);
  state.network = createNetwork(city);
  return state;
};
const a = make();
const b = make();
a.speed = 10;
const rngA = mulberry32(12345);
generateDemand(a, rngA);
const rngB = mulberry32(12345);
for (let i = 0; i < 10; i++) {
  generateDemand(b, rngB);
  b.time = (b.time + 10) % 1440;
}
assert.ok(Math.abs(a.totalGenerated - b.totalGenerated) < 1e-9, 'la demande doit intégrer le même temps simulé');

// Breakdown duration: a 2h+ breakdown must not survive a 1000x tick.
const state = make();
const [x, y] = state.city.stops.slice(0, 2).map(s => s.id);
createLine(state);
state.pendingStops = [x, y];
assert.equal(finishLine(state, () => {}, routeLine), true);
const vehicle = state.vehicles[0];
state.speed = 1000;
updateVehicles(state, () => 0, () => {});
assert.equal(vehicle.brokenMinutesLeft, 0, 'une panne de 2–5h doit être écoulée dans un tick de 1000x');
assert.equal(vehicle.brokenTicksLeft, 0);

console.log(JSON.stringify({ ok: true, integratedDemand: a.totalGenerated, breakdownRemainingMinutes: vehicle.brokenMinutesLeft }));
