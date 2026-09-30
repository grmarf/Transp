import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createState } from '../src/state.js';
import { evaluateProgression, progressionRank, progressionSummary } from '../src/progression.js';

const state = createState(createCity('V16-PROGRESSION'));
const initialMoney = state.money;
const logs = [];
assert.equal(evaluateProgression(state, { satisfaction: 0, transferShare: 0 }, logs.push.bind(logs)).length, 0);

state.lines = [{ id: 1, mode: 'bus' }];
state.totalArrived = 100;
let unlocked = evaluateProgression(state, { satisfaction: 80, transferShare: 0.2 }, logs.push.bind(logs));
assert.equal(unlocked.length, 4);
assert.deepEqual(state.completedGoals.sort(), ['first-line', 'happy-city', 'intermodal-city', 'ridership-100'].sort());
assert.equal(state.reputation, 38);
assert.equal(state.money, initialMoney + 2000 + 3000 + 4500 + 6000);
assert.equal(logs.length, 4);

// Rewards are one-shot even if the same metrics are evaluated repeatedly.
unlocked = evaluateProgression(state, { satisfaction: 100, transferShare: 1 }, logs.push.bind(logs));
assert.equal(unlocked.length, 0);
assert.equal(state.money, initialMoney + 15500);

state.lines.push({ id: 2, mode: 'metro' });
unlocked = evaluateProgression(state, { satisfaction: 80, transferShare: 0.2 }, logs.push.bind(logs));
assert.equal(unlocked.length, 1);
assert.equal(unlocked[0].id, 'metro-pioneer');
assert.equal(state.reputation, 58);
assert.equal(progressionRank(state.reputation), 'Icône de la ville');

const summary = progressionSummary(state, { satisfaction: 80, transferShare: 0.2 });
assert.equal(summary.completed, 5);
assert.equal(summary.total, 6);
assert.equal(summary.goals.filter(goal => goal.completed).length, 5);
assert.equal(summary.goals.find(goal => goal.id === 'network-builder').progress, 2 / 3);

console.log(JSON.stringify({ ok: true, completed: summary.completed, reputation: summary.reputation, rank: summary.rank }));
