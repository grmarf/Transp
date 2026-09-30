/** V10.0 — Persistence
 * Versioned local save/load without serialising runtime Maps/Sets directly.
 */
export const SAVE_VERSION = 1;
export const SAVE_KEY = "transport-tycoon-v10-save";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function serializeState(state, rngState = null) {
  return {
    format: "transport-tycoon-save",
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    rngState,
    state: clone({
      ...state,
      network: state.network ? {
        version: state.network.version,
        closedEdgeIds: [...(state.network.closedEdgeIds || [])],
        roadworksReopenDay: [...(state.network.roadworksReopenDay || [])]
      } : null
    })
  };
}

export function saveGame(state, rngState, storage = globalThis.localStorage) {
  if (!storage) throw new Error("localStorage indisponible");
  const payload = serializeState(state, rngState);
  storage.setItem(SAVE_KEY, JSON.stringify(payload));
  return payload;
}

export function readSavedGame(storage = globalThis.localStorage) {
  if (!storage) return null;
  const raw = storage.getItem(SAVE_KEY);
  if (!raw) return null;
  const payload = JSON.parse(raw);
  if (payload?.format !== "transport-tycoon-save" || payload.version !== SAVE_VERSION || !payload.state?.city) {
    throw new Error("Sauvegarde incompatible ou corrompue");
  }
  return payload;
}

export function clearSavedGame(storage = globalThis.localStorage) {
  if (!storage) return;
  storage.removeItem(SAVE_KEY);
}
