/** V14.0 — versioned local and file persistence. */
// Keep the serialized format at v1 for compatibility with existing V10 saves;
// the game-state version is tracked independently in state.js.
export const SAVE_VERSION = 1;
export const SAVE_KEY = "transport-tycoon-v14-save";
const LEGACY_SAVE_KEY = "transport-tycoon-v10-save";

function clone(value) { return JSON.parse(JSON.stringify(value)); }

export function serializeState(state, rngState = null) {
  const clean = clone({
    ...state,
    network: state.network ? {
      version: state.network.version,
      closedEdgeIds: [...(state.network.closedEdgeIds || [])],
      roadworksReopenDay: [...(state.network.roadworksReopenDay || [])]
    } : null,
    undergroundNetwork: null
  });
  return { format: "transport-tycoon-save", version: SAVE_VERSION, savedAt: new Date().toISOString(), rngState, state: clean };
}

export function saveGame(state, rngState, storage = globalThis.localStorage) {
  if (!storage) throw new Error("localStorage indisponible");
  const payload = serializeState(state, rngState);
  storage.setItem(SAVE_KEY, JSON.stringify(payload));
  return payload;
}

export function hasSavedGame(storage = globalThis.localStorage) {
  return !!storage && (!!storage.getItem(SAVE_KEY) || !!storage.getItem(LEGACY_SAVE_KEY));
}

export function readSavedGame(storage = globalThis.localStorage) {
  if (!storage) return null;
  const raw = storage.getItem(SAVE_KEY) || storage.getItem(LEGACY_SAVE_KEY);
  if (!raw) return null;
  const payload = JSON.parse(raw);
  if (payload?.format !== "transport-tycoon-save" || ![1, SAVE_VERSION].includes(payload.version) || !payload.state?.city) {
    throw new Error("Sauvegarde incompatible ou corrompue");
  }
  return payload;
}

export function clearSavedGame(storage = globalThis.localStorage) {
  if (!storage) return;
  storage.removeItem(SAVE_KEY); storage.removeItem(LEGACY_SAVE_KEY);
}

export function exportGameToFile(state, rngState = null) {
  const payload = serializeState(state, rngState);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `transport-tycoon-${state.city?.seed || "save"}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return payload;
}

export async function importGameFromFile(file) {
  if (!file) return null;
  const payload = JSON.parse(await file.text());
  if (payload?.format !== "transport-tycoon-save" || ![1, SAVE_VERSION].includes(payload.version) || !payload.state?.city) {
    throw new Error("Fichier de sauvegarde incompatible ou corrompu");
  }
  return payload;
}
