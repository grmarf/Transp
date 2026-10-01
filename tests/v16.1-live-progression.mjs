import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createState } from '../src/state.js';
import { evaluateLiveProgression } from '../src/engine.js';

const legacy = createState(createCity('V16.1-LEGACY'));
legacy.lines = [{ id: 1, mode: 'bus' }];
const legacyMoney = legacy.money;
assert.deepEqual(evaluateLiveProgression(legacy), []);
assert.equal(legacy.money, legacyMoney);

const live = createState(createCity('V16.1-LIVE'));
live.progressionEnabled = true;
live.lines = [{ id: 1, mode: 'bus' }];
const liveMoney = live.money;
const logs = [];
const unlocked = evaluateLiveProgression(live, logs.push.bind(logs));
assert.equal(unlocked.length, 2);
assert.ok(unlocked.some(goal => goal.id === 'first-line'));
assert.equal(live.money, liveMoney + unlocked.reduce((sum, goal) => sum + goal.reward, 0));
assert.equal(live.completedGoals.length, 2);
assert.equal(logs.length, 2);
assert.equal(evaluateLiveProgression(live, logs.push.bind(logs)).length, 0);
assert.equal(logs.length, 2);

console.log(JSON.stringify({ ok: true, immediateGoal: unlocked[0].id, reward: unlocked[0].reward }));
