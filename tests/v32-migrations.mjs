// V32 — versioning & migration des sauvegardes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCity } from "../src/city.js";
import { createState } from "../src/state.js";
import { createNetwork } from "../src/network.js";
import {
  SAVE_FORMAT_VERSION, SAVE_KEY, MIGRATIONS,
  serializeState, validateSavePayload, migrateSavePayload, readSavedGame
} from "../src/persistence.js";

const makeState = () => {
  const city = createCity("V32-SAVES");
  const state = createState(city);
  state.network = createNetwork(city);
  return state;
};

const makeLegacyPayload = () => {
  const payload = structuredClone(serializeState(makeState()));
  // Fabriquer une sauvegarde d'époque format 3 : drapeaux V30 absents.
  payload.version = 3;
  delete payload.migrationNotes;
  for (const stop of payload.state.city.stops) delete stop.multimodal;
  delete payload.state.city.customStopCount;
  return payload;
};

// --- 1. Les nouvelles sauvegardes sont au format courant ------------------
{
  assert.equal(SAVE_FORMAT_VERSION, 4, "format courant = 4");
  const payload = serializeState(makeState());
  assert.equal(payload.version, SAVE_FORMAT_VERSION, "sérialisation au format 4");
  assert.ok(!payload.migrationNotes, "aucune note de migration à l'écriture");
  validateSavePayload(payload);
}

// --- 2. Migration 3 -> 4 : champs explicites, notes traçables --------------
{
  assert.ok(MIGRATIONS.length >= 1, "au moins une étape déclarée");
  const legacy = makeLegacyPayload();
  const migrated = migrateSavePayload(legacy);
  assert.equal(migrated.version, 4, "payload porté au format 4");
  assert.ok(migrated.migrationNotes && migrated.migrationNotes.length === 1, "une étape journalisée");
  assert.ok(migrated.migrationNotes[0].includes("multimodal"), "l'étape documente son effet");
  for (const stop of migrated.state.city.stops) {
    assert.equal(stop.multimodal, false, "drapeau multimodal explicite (absent = faux)");
  }
  assert.ok(Number.isInteger(migrated.state.city.customStopCount), "compteur d'arrêts joueur posé");
  validateSavePayload(migrated);
}

// --- 3. Refus explicites : trop ancienne, trop récente ---------------------
{
  const tooOld = makeLegacyPayload();
  tooOld.version = 2;
  assert.throws(() => migrateSavePayload(tooOld), /trop ancienne/, "format < 3 refusé");

  const tooNew = makeLegacyPayload();
  tooNew.version = 99;
  assert.throws(() => migrateSavePayload(tooNew), /plus récente/, "format futur refusé");
}

// --- 4. Idempotence : une sauvegarde déjà au bon format ne bouge pas -------
{
  const fresh = structuredClone(serializeState(makeState()));
  const migrated = migrateSavePayload(fresh);
  assert.equal(migrated.version, 4, "reste au format 4");
  assert.ok(!migrated.migrationNotes, "aucune étape jouée");
}

// --- 5. readSavedGame migre depuis un storage périmé ------------------------
{
  const legacy = makeLegacyPayload();
  const raw = JSON.stringify(legacy);
  const storage = {
    getItem: (k) => (k === SAVE_KEY ? raw : null),
    setItem: () => {},
    removeItem: () => {}
  };
  const loaded = readSavedGame(storage);
  assert.equal(loaded.version, 4, "chargement migré au format 4");
  assert.ok(loaded.migrationNotes && loaded.migrationNotes.length === 1, "migration signalée au chargement");
  assert.equal(readSavedGame({ getItem: () => null, setItem: () => {} }), null, "sans sauvegarde -> null");
}

// --- 6. Câblage statique ---------------------------------------------------
{
  const persistencejs = readFileSync(new URL("../src/persistence.js", import.meta.url), "utf8");
  const mainjs = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const changes = readFileSync(new URL("../CHANGES.md", import.meta.url), "utf8");
  assert.ok(persistencejs.includes("export const MIGRATIONS"), "chaîne de migrations exportée");
  assert.ok(persistencejs.includes("migrateSavePayload(JSON.parse(raw))"), "readSavedGame migre");
  assert.ok(persistencejs.includes("return migrateSavePayload(payload);"), "l'import migre aussi");
  assert.ok(mainjs.includes("migrationNotes") && mainjs.includes("Sauvegarde migrée"), "journal des migrations au chargement");
  assert.ok(changes.includes("## V32"), "CHANGES documente la V32");
}

console.log(JSON.stringify({ ok: true, suite: "v32-migrations" }));
