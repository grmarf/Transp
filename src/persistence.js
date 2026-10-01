/** V20.0 — strict current-save persistence, no historical migrations. */

export const SAVE_FORMAT_VERSION = 2;
// Backward-compatible export for callers using the pre-V20 name.
export const SAVE_VERSION = SAVE_FORMAT_VERSION;
export const SAVE_KEY = "transport-tycoon-v20-save";
const SAVE_FORMAT = "transport-tycoon-save";
const STATE_VERSION = "20.0";

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function invalid(message) { throw new Error(`Sauvegarde V20 invalide : ${message}`); }

export function validateSavePayload(payload) {
  if (!payload || typeof payload !== "object") invalid("objet absent");
  if (payload.format !== SAVE_FORMAT) invalid("format inconnu");
  if (payload.version !== SAVE_FORMAT_VERSION) invalid(`Format de sauvegarde invalide (attendu: ${SAVE_FORMAT_VERSION}) : version de format non supportée`);
  if (!payload.savedAt || Number.isNaN(Date.parse(payload.savedAt))) invalid("date absente ou invalide");
  if (payload.rngState !== null && payload.rngState !== undefined && !Number.isInteger(payload.rngState)) invalid("état du générateur aléatoire invalide");

  const state = payload.state;
  if (!state || typeof state !== "object") invalid("état absent");
  if (state.version !== STATE_VERSION) invalid("version du jeu différente de V20.0");
  if (!state.city || !Array.isArray(state.city.stops) || !Array.isArray(state.city.roads)) invalid("ville incomplète");
  for (const field of ["lines", "vehicles", "passengers", "dailyStats", "dailyReports", "activeEvents", "activeContracts", "completedGoals"]) {
    if (!Array.isArray(state[field])) invalid(`champ ${field} absent ou invalide`);
  }
  for (const field of ["money", "time", "elapsedDays", "nextLineId", "nextVehicleId"]) {
    if (!Number.isFinite(state[field])) invalid(`champ numérique ${field} invalide`);
  }
  if (state.network && (!Array.isArray(state.network.closedEdgeIds) || !Array.isArray(state.network.roadworksReopenDay))) {
    invalid("réseau sérialisé incomplet");
  }
  return payload;
}

export function serializeState(state, rngState = null) {
  const clean = clone({
    ...state,
    network: state.network ? {
      version: state.network.version,
      closedEdgeIds: [...(state.network.closedEdgeIds || [])],
      roadworksReopenDay: [...(state.network.roadworksReopenDay || [])]
    } : null,
    undergroundNetwork: state.undergroundNetwork ? {
      version: state.undergroundNetwork.version,
      closedEdgeIds: [...(state.undergroundNetwork.closedEdgeIds || [])],
      roadworksReopenDay: [...(state.undergroundNetwork.roadworksReopenDay || [])]
    } : null
  });
  const payload = { format: SAVE_FORMAT, version: SAVE_FORMAT_VERSION, savedAt: new Date().toISOString(), rngState, state: clean };
  return validateSavePayload(payload);
}

export function saveGame(state, rngState, storage = globalThis.localStorage) {
  if (!storage) throw new Error("localStorage indisponible");
  const payload = serializeState(state, rngState);
  storage.setItem(SAVE_KEY, JSON.stringify(payload));
  return payload;
}

export function hasSavedGame(storage = globalThis.localStorage) {
  return !!storage?.getItem(SAVE_KEY);
}

export function readSavedGame(storage = globalThis.localStorage) {
  if (!storage) return null;
  const raw = storage.getItem(SAVE_KEY);
  if (!raw) return null;
  try { return validateSavePayload(JSON.parse(raw)); }
  catch (error) { throw new Error(error.message.startsWith("Sauvegarde V20 invalide") ? error.message : "Sauvegarde V20 invalide : JSON illisible"); }
}

export function clearSavedGame(storage = globalThis.localStorage) {
  storage?.removeItem(SAVE_KEY);
}

export function exportGameToFile(state, rngState = null) {
  const payload = serializeState(state, rngState);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `transport-tycoon-v20-${state.city?.seed || "save"}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return payload;
}

export async function importGameFromFile(file) {
  if (!file) return null;
  let payload;
  try { payload = JSON.parse(await file.text()); }
  catch { throw new Error("Fichier de sauvegarde V20 illisible"); }
  return validateSavePayload(payload);
}
