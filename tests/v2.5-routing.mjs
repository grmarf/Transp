import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createNetwork } from '../src/network.js';
import { createState } from '../src/state.js';
import { findPassengerRoute } from '../src/routing.js';
import { createLine, finishLine } from '../src/engine.js';

const city = createCity('V25-ROUTING');
const state = createState(city);
state.network = createNetwork(city);
const log = () => {};
const routeLine = (network, ids) => import('../src/network.js').then(m => m.routeLine(network, ids));

// Build two lines with a common transfer stop.
createLine(state); state.pendingStops = [city.stops[0].id, city.stops[1].id, city.stops[2].id];
finishLine(state, log, (n, ids) => { if (!ids.length) return null; return requireRoute(n, ids); });
function requireRoute(n, ids) { return null; }

// Avoid async/dynamic setup: construct line records using the real network router.
state.lines = [];
state.vehicles = [];
state.nextLineId = 1;
const { routeLine: rl } = await import('../src/network.js');
const add = ids => {
  const route = rl(state.network, ids);
  assert(route);
  const line = { id: state.nextLineId++, name:`L${state.nextLineId-1}`, color:'#fff', stopIds:ids, route, vehicles:[], income:0, riders:0 };
  state.lines.push(line);
};
add([city.stops[0].id, city.stops[1].id]);
add([city.stops[1].id, city.stops[2].id]);
const itinerary = findPassengerRoute(state, city.stops[0].id, city.stops[2].id);
assert(itinerary);
assert.equal(itinerary.length, 2);
assert.equal(itinerary[0].from, city.stops[0].id);
assert.equal(itinerary[0].to, city.stops[1].id);
assert.equal(itinerary[1].from, city.stops[1].id);
assert.equal(itinerary[1].to, city.stops[2].id);
console.log(JSON.stringify({ok:true, legs:itinerary.length}));
