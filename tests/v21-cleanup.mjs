// V20.1 — régression : passagers fantômes et cooldown des événements.
import assert from 'node:assert/strict';
import { createCity, mulberry32 } from '../src/city.js';
import { createState } from '../src/state.js';
import { createNetwork, createUndergroundNetwork } from '../src/network.js';
import { PASSENGER_STATES } from '../src/passengers.js';
import { step, cleanupPassengers } from '../src/engine.js';
import { EVENT_TYPES, triggerEvent } from '../src/events.js';

const city = createCity('v21-cleanup-seed');
const state = createState(city, null);
state.network = createNetwork(city);
state.undergroundNetwork = createUndergroundNetwork(city);
const rng = mulberry32((city.numericSeed ?? 1) ^ 0xA57E2);
const log = () => {};
let guard = 0;
while ((state.elapsedDays || 0) < 20 && guard++ < 300000) step(state, rng, log);
cleanupPassengers(state);

assert.ok(typeof state.totalAbandoned === 'number' && state.totalAbandoned > 0,
  'state.totalAbandoned doit être un compteur positif');
for (const passenger of state.passengers) {
  if (passenger.state === PASSENGER_STATES.ABANDONED) {
    assert.ok(Number.isFinite(passenger.completedAt),
      'tout passager abandonné doit avoir un completedAt');
  }
}

const state2 = createState(city, null);
state2.elapsedDays = 10;
const event = triggerEvent(state2, EVENT_TYPES.STRIKE.id);
assert.ok(event, 'triggerEvent doit renvoyer un événement');
assert.equal(event.endsDay, 12, 'endsDay attendu : jour 12');
assert.equal(state2.eventCooldownUntil, 14,
  'le cooldown doit rouvrir à endsDay + 2');

console.log(JSON.stringify({ ok: true, days: state.elapsedDays,
  totalAbandoned: state.totalAbandoned,
  passengersInMemory: state.passengers.length,
  cooldownUntil: state2.eventCooldownUntil }));
