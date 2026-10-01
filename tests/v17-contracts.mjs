import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createState } from '../src/state.js';
import { CONTRACT_TYPES, contractSummary, evaluateContracts, refreshContracts } from '../src/contracts.js';

const state = createState(createCity('V17-CONTRACTS'));
state.contractsEnabled = true;
assert.equal(refreshContracts(state, 0), true);
assert.equal(state.activeContracts.length, 2);
assert.equal(state.contractsEndDay, 3);
assert.equal(refreshContracts(state, 1), false);

const first = contractSummary(state, { satisfaction: 100, coverage: 1, transferShare: 1 });
assert.equal(first.length, 2);
const moneyBefore = state.money;
const logs = [];
const done = evaluateContracts(state, { satisfaction: 100, coverage: 1, transferShare: 1 }, logs.push.bind(logs));
assert.equal(done.length, 2);
assert.equal(state.money, moneyBefore + done.reduce((sum, item) => sum + item.reward, 0));
assert.equal(state.contractHistory.length, 2);
assert.equal(evaluateContracts(state, { satisfaction: 100, coverage: 1, transferShare: 1 }).length, 0);

state.elapsedDays = 3;
assert.equal(refreshContracts(state, 3), true);
assert.equal(state.contractCycle, 2);
assert.equal(state.activeContracts.length, 2);
assert.ok(CONTRACT_TYPES.some(contract => state.activeContracts.some(active => active.id === contract.id)));

console.log(JSON.stringify({ ok: true, cycle: state.contractCycle, completed: state.contractHistory.length }));
