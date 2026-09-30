import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createState } from '../src/state.js';
import { findPassengerRoute, routingCacheStats } from '../src/routing.js';
import { cleanupPassengers } from '../src/engine.js';
import { createPassenger, PASSENGER_STATES } from '../src/passengers.js';

const city = createCity('V14.1-PERFORMANCE');
const state = createState(city);
const [a, b, c] = city.stops;
state.lines = [
  { id: 1, mode: 'bus', stopIds: [a.id, b.id, c.id] }
];

const first = findPassengerRoute(state, a.id, c.id);
assert.ok(first);
let stats = routingCacheStats(state);
assert.equal(stats.misses, 1);
assert.equal(stats.hits, 0);

const second = findPassengerRoute(state, a.id, c.id);
assert.equal(second, first);
stats = routingCacheStats(state);
assert.equal(stats.hits, 1);

// A line mutation changes the signature and automatically invalidates cache.
state.lines[0].stopIds = [a.id, c.id];
const afterMutation = findPassengerRoute(state, a.id, c.id);
assert.ok(afterMutation);
stats = routingCacheStats(state);
assert.equal(stats.misses, 1);
assert.equal(stats.hits, 0);

const oldArrived = createPassenger({ originId: a.id, destinationId: c.id });
oldArrived.state = PASSENGER_STATES.ARRIVED;
oldArrived.completedAt = 0;
const recentAbandoned = createPassenger({ originId: a.id, destinationId: c.id });
recentAbandoned.state = PASSENGER_STATES.ABANDONED;
recentAbandoned.completedAt = 4 * 1440;
const onboardArrived = createPassenger({ originId: a.id, destinationId: c.id });
onboardArrived.state = PASSENGER_STATES.ARRIVED;
onboardArrived.completedAt = 0;
state.passengers = [oldArrived, recentAbandoned, onboardArrived];
state.elapsedDays = 5;
state.time = 0;
state.vehicles = [{ id: 1, onboard: [onboardArrived.id] }];

const removed = cleanupPassengers(state, 2);
assert.equal(removed, 1);
assert.equal(state.passengers.length, 2);
assert.ok(state.passengers.includes(recentAbandoned));
assert.ok(state.passengers.includes(onboardArrived));

console.log(JSON.stringify({ ok: true, cache: routingCacheStats(state), removed }));
