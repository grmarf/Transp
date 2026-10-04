import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createState } from '../src/state.js';
import { readSavedGame, SAVE_KEY, SAVE_VERSION, serializeState, validateSavePayload } from '../src/persistence.js';

const state = createState(createCity('V20-STRICT'));
const payload = serializeState(state, 123);
assert.equal(SAVE_VERSION, 2);
assert.equal(payload.state.version, '22.0');
assert.equal(state.wageLevel, 1);
assert.equal(state.fareLevel, 1);
assert.equal(state.activeCampaigns.length, 0);
assert.equal(validateSavePayload(payload), payload);

const storage = new Map([["vie-t-lignes-v14-save", JSON.stringify(payload)]]);
const fakeStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
assert.equal(readSavedGame(fakeStorage), null);

const invalid = { ...payload, version: 1 };
assert.throws(() => validateSavePayload(invalid), /version de format non supportée/);
const missingField = { ...payload, state: { ...payload.state, dailyReports: undefined } };
assert.throws(() => validateSavePayload(missingField), /dailyReports/);
assert.throws(() => readSavedGame({ getItem: () => '{broken-json' }), /illisible/);
assert.equal(SAVE_KEY, 'vie-t-lignes-v20-save');

console.log(JSON.stringify({ ok: true, saveVersion: SAVE_VERSION, legacyRejected: true }));
