import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createState } from '../src/state.js';
import { createNetwork, createUndergroundNetwork, routeLine } from '../src/network.js';
import { createLine, finishLine, satisfaction } from '../src/engine.js';
import { findPassengerRoute, routingStats } from '../src/routing.js';
import { createPassenger, intermodalStats, PASSENGER_STATES } from '../src/passengers.js';
import { congestionHeatmap, createVehicle } from '../src/vehicles.js';

const city = createCity('V14-INTERMODAL');
const state = createState(city);
state.network = createNetwork(city);
state.undergroundNetwork = createUndergroundNetwork(city);
const log = () => {};

state.pendingStops = [city.stops[0].id, city.stops[1].id];
assert.equal(finishLine(state, log, routeLine, 'bus'), true);
state.pendingStops = [city.stops[1].id, city.stops[2].id];
assert.equal(finishLine(state, log, routeLine, 'tram'), true);

const origin = city.stops[0].id;
const destination = city.stops[2].id;
const route = findPassengerRoute(state, origin, destination);
assert.ok(route);
assert.ok(Array.isArray(route));
assert.equal(route.legs, route);
assert.equal(route.transfers, 1);
assert.equal(route.length, 2);
assert.ok(route.totalHops >= 2);
assert.ok(routingStats(state).avgTransfers >= 0);

const passenger = createPassenger({ originId: origin, destinationId: destination });
passenger.state = PASSENGER_STATES.ARRIVED;
passenger.transfersDone = 1;
passenger.travelMinutes = 30;
state.passengers.push(passenger);
const stats = intermodalStats(state);
assert.equal(stats.arrivedCount, 1);
assert.equal(stats.avgTransfersPerTrip, 1);
assert.equal(stats.shareWithTransfer, 1);
assert.equal(stats.avgTravelMinutes, 30);
assert.equal(satisfaction(state), 100);

const vehicle = state.vehicles[0];
vehicle.routeIndex = 0;
state.vehicles.push(createVehicle(state, state.lines[0].id));
const heat = congestionHeatmap(state);
assert.ok(Array.isArray(heat));
assert.ok(heat.length >= 1);
assert.ok(heat[0].load >= 1);

console.log(JSON.stringify({ ok: true, legs: route.length, transfers: route.transfers, heatSegments: heat.length }));
