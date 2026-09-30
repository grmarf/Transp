import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createNetwork, routeLine } from '../src/network.js';
import { createState } from '../src/state.js';
import { createLine, finishLine, step, vehiclePosition } from '../src/engine.js';
import { updateVehicles } from '../src/vehicles.js';
import { createVehicle, DEFAULT_VEHICLE_CAPACITY } from '../src/vehicles.js';

const city = createCity('V27-VEHICLES');
const state = createState(city);
state.network = createNetwork(city);
const log = () => {};
const [a,b,c] = city.stops.slice(0,3).map(s => s.id);

createLine(state);
state.pendingStops = [a,b,c];
assert.equal(finishLine(state, log, routeLine), true);
assert.equal(state.vehicles.length, 1);

const vehicle = state.vehicles[0];
assert.equal(vehicle.capacity, DEFAULT_VEHICLE_CAPACITY);
assert.equal(vehicle.onboard.length, 0);
assert.equal(vehicle.direction, 1);
assert.ok(vehiclePosition(state, vehicle));

const line = state.lines[0];
const testPassenger = {
  id: 999,
  originId: a,
  destinationId: b,
  currentStopId: a,
  state: 'WAITING',
  itinerary: [{ lineId: line.id, from: a, to: b }],
  legIndex: 0,
  vehicleId: null,
  createdAt: state.time,
  waitedMinutes: 0,
  arrivedAt: null
};
state.passengers.push(testPassenger);

// Bring the vehicle to the node immediately before origin `a`, then verify boarding.
const routeIds = line.route.nodeIds;
const beforeOrigin = routeIds.findIndex((id, i) => routeIds[(i + 1) % routeIds.length] === a);
assert.ok(beforeOrigin >= 0);
vehicle.routeIndex = beforeOrigin;
vehicle.progress = 0.99;
vehicle.speed = 1;
updateVehicles(state);
assert.equal(vehicle.onboard.length, 1);
assert.equal(testPassenger.vehicleId, vehicle.id);
assert.equal(testPassenger.state, 'ON_VEHICLE');
assert.ok(vehiclePosition(state, vehicle));

// Capacity must remain a hard upper bound even with more waiting passengers.
for (let i = 0; i < vehicle.capacity + 10; i++) {
  state.passengers.push({
    id: 1000 + i,
    originId: a,
    destinationId: b,
    currentStopId: a,
    state: 'WAITING',
    itinerary: [{ lineId: line.id, from: a, to: b }],
    legIndex: 0,
    vehicleId: null,
    createdAt: state.time,
    waitedMinutes: 0,
    arrivedAt: null
  });
}
vehicle.routeIndex = beforeOrigin;
vehicle.progress = 0.99;
vehicle.speed = 1;
updateVehicles(state);
assert.equal(vehicle.onboard.length, vehicle.capacity);
assert.ok(vehicle.onboard.length <= vehicle.capacity);

console.log(JSON.stringify({
  ok: true,
  vehicleId: vehicle.id,
  capacity: vehicle.capacity,
  onboard: vehicle.onboard.length,
  routeIndex: vehicle.routeIndex,
  progress: vehicle.progress
}));
