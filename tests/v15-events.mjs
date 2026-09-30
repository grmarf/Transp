import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createState } from '../src/state.js';
import { generateDemand, satisfaction } from '../src/engine.js';
import { PASSENGER_STATES, createPassenger } from '../src/passengers.js';
import {
  activeEvents, eventDemandMultiplier, eventEffects, eventFareMultiplier,
  eventJournal, eventSatisfactionDelta, eventSummary, finishExpiredEvents, triggerEvent
} from '../src/events.js';

const city = createCity('V15-EVENTS');
const state = createState(city);
state.eventsEnabled = true;
const festival = triggerEvent(state, 'festival', 2);
assert.ok(festival);
assert.equal(activeEvents(state).length, 1);
assert.equal(eventDemandMultiplier(state), 1.55);
assert.equal(eventFareMultiplier(state), 1.1);
assert.equal(eventSatisfactionDelta(state), 5);
assert.equal(eventSummary(state)[0].label, 'Festival');
assert.equal(eventJournal(state).length, 1);

const baseline = createState(createCity('V15-DEMAND'));
baseline.eventsEnabled = false;
const eventState = createState(createCity('V15-DEMAND'));
eventState.eventsEnabled = true;
triggerEvent(eventState, 'festival', 2);
const random = () => 0.5;
generateDemand(baseline, random);
generateDemand(eventState, random);
assert.ok(eventState.totalGenerated > baseline.totalGenerated);
assert.ok(Math.abs(eventState.totalGenerated / baseline.totalGenerated - 1.55) < 0.000001);

const unhappy = createPassenger({ originId: city.stops[0].id, destinationId: city.stops[1].id });
unhappy.state = PASSENGER_STATES.ABANDONED;
state.passengers.push(unhappy);
assert.ok(satisfaction(state) > satisfaction({ ...state, eventsEnabled: false, activeEvents: [] }));

state.elapsedDays = 2;
assert.equal(finishExpiredEvents(state), 1);
assert.equal(activeEvents(state).length, 0);
assert.deepEqual(eventEffects(state), { demandMultiplier: 1, fareMultiplier: 1, satisfactionDelta: 0 });

console.log(JSON.stringify({ ok: true, event: festival.type, generatedRatio: eventState.totalGenerated / baseline.totalGenerated }));
