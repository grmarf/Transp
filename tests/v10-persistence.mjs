import assert from 'node:assert/strict';
import { createCity, mulberry32 } from '../src/city.js';
import { createNetwork, routeLine } from '../src/network.js';
import { createState } from '../src/state.js';
import { createLine, finishLine, step } from '../src/engine.js';
import { saveGame, readSavedGame, SAVE_KEY } from '../src/persistence.js';

const storage = new Map();
const fakeStorage = {
  setItem: (k, v) => storage.set(k, v),
  getItem: k => storage.get(k) ?? null,
  removeItem: k => storage.delete(k)
};

const city = createCity('V10-PERSIST');
const state = createState(city);
state.network = createNetwork(city);
const log = () => {};
const [a, b, c] = city.stops.slice(0, 3).map(s => s.id);
createLine(state);
state.pendingStops = [a, b, c];
assert.equal(finishLine(state, log, routeLine), true);
state.network.closedEdgeIds = new Set([state.network.edges[0].id]);
state.network.roadworksReopenDay = new Map([[state.network.edges[0].id, 7]]);
state.time = 731;
state.elapsedDays = 3;
state.money = 41234.5;
state.speed = 4;
const rng = mulberry32(city.numericSeed ^ 0xA57E2);
rng(); rng(); rng();
const expectedRng = rng.getState();

saveGame(state, expectedRng, fakeStorage);
const payload = readSavedGame(fakeStorage);
assert.equal(payload.version, 2);
assert.equal(payload.state.version, '22.0');
assert.equal(payload.state.money, 41234.5);
assert.equal(payload.state.network.closedEdgeIds.length, 1);
assert.deepEqual(payload.state.network.roadworksReopenDay, [[state.network.edges[0].id, 7]]);
assert.equal(payload.rngState, expectedRng);
assert.ok(fakeStorage.getItem(SAVE_KEY));

console.log(JSON.stringify({ ok: true, saveVersion: payload.version, closedEdges: payload.state.network.closedEdgeIds.length, rngState: payload.rngState }));
