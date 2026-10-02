/** V20.0 — strict current-save persistence, no historical migrations. */

export const SAVE_FORMAT_VERSION = 2;
// Backward-compatible export for callers using the pre-V20 name.
export const SAVE_VERSION = SAVE_FORMAT_VERSION;
export const SAVE_KEY = "transport-tycoon-v20-save";
const SAVE_FORMAT = "transport-tycoon-save";
const STATE_VERSION = "20.0";
const UINT32_MAX = 0xFFFFFFFF;
const PASSENGER_STATES = new Set(["WAITING", "BOARDING", "ON_VEHICLE", "TRANSFERRING", "ARRIVED", "ABANDONED"]);
const VEHICLE_MODES = new Set(["bus", "tram", "metro"]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function invalid(message) { throw new Error(`Sauvegarde V20 invalide : ${message}`); }
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} invalide`);
  return value;
}
function string(value, label) {
  if (typeof value !== "string" || value.length === 0) invalid(`${label} invalide`);
}
function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${label} invalide`);
}
function integer(value, label, { min = null, max = null } = {}) {
  if (!Number.isInteger(value) || (min !== null && value < min) || (max !== null && value > max)) invalid(`${label} invalide`);
}
function array(value, label) {
  if (!Array.isArray(value)) invalid(`${label} invalide`);
  return value;
}
function uniqueIds(items, label) {
  const ids = new Set();
  for (const item of items) {
    object(item, `${label}[]`);
    string(item.id, `${label}.id`);
    if (ids.has(item.id)) invalid(`${label} contient des identifiants dupliqués`);
    ids.add(item.id);
  }
  return ids;
}
function uniqueNumericIds(items, label) {
  const ids = new Set();
  for (const item of items) {
    object(item, `${label}[]`);
    integer(item.id, `${label}.id`, { min: 1 });
    if (ids.has(item.id)) invalid(`${label} contient des identifiants dupliqués`);
    ids.add(item.id);
  }
  return ids;
}
function coordinate(value, label) { finite(value, label); }

function validateCity(city) {
  object(city, "ville");
  for (const field of ["id", "name", "seed"]) string(city[field], `ville.${field}`);
  integer(city.numericSeed, "ville.numericSeed", { min: 0, max: UINT32_MAX });
  finite(city.width, "ville.width");
  finite(city.height, "ville.height");
  const stops = array(city.stops, "ville.stops");
  if (stops.length < 2) invalid("ville.stops doit contenir au moins deux arrêts");
  const stopIds = uniqueIds(stops, "ville.stops");
  for (const stop of stops) {
    string(stop.name, "arrêt.name");
    coordinate(stop.x, "arrêt.x"); coordinate(stop.y, "arrêt.y");
    for (const field of ["demand", "population", "jobs", "commerce", "density"]) finite(stop[field], `arrêt.${field}`);
    string(stop.districtId, "arrêt.districtId");
    object(stop.waitingByDestination, "arrêt.waitingByDestination");
    for (const [destinationId, amount] of Object.entries(stop.waitingByDestination)) {
      if (!stopIds.has(destinationId)) invalid("demande vers un arrêt inconnu");
      finite(amount, "demande en attente");
      if (amount < 0) invalid("demande en attente négative");
    }
  }
  const roads = array(city.roads, "ville.roads");
  for (const road of roads) {
    object(road, "ville.roads[]");
    if (!stopIds.has(road.a) || !stopIds.has(road.b) || road.a === road.b) invalid("route invalide");
    string(road.type, "route.type");
  }
  const districts = array(city.districts, "ville.districts");
  uniqueIds(districts, "ville.districts");
  for (const district of districts) {
    string(district.name, "district.name");
    object(district.center, "district.center");
    coordinate(district.center.x, "district.center.x"); coordinate(district.center.y, "district.center.y");
    finite(district.populationFactor, "district.populationFactor");
  }
  return stopIds;
}

function validateSerializedNetwork(network, label) {
  if (network === null || network === undefined) return;
  object(network, label);
  string(network.version, `${label}.version`);
  const closed = array(network.closedEdgeIds, `${label}.closedEdgeIds`);
  for (const edgeId of closed) string(edgeId, `${label}.closedEdgeIds[]`);
  const reopen = array(network.roadworksReopenDay, `${label}.roadworksReopenDay`);
  for (const entry of reopen) {
    array(entry, `${label}.roadworksReopenDay[]`);
    if (entry.length !== 2) invalid(`${label}.roadworksReopenDay contient une entrée invalide`);
    string(entry[0], `${label}.roadworksReopenDay[].id`);
    finite(entry[1], `${label}.roadworksReopenDay[].jour`);
  }
}

function validateState(state) {
  object(state, "état");
  if (state.version !== STATE_VERSION) invalid("version du jeu différente de V20.0");
  const stopIds = validateCity(state.city);
  for (const field of ["lines", "vehicles", "passengers", "dailyStats", "dailyReports", "activeEvents", "activeContracts", "completedGoals"]) array(state[field], `état.${field}`);
  for (const field of ["money", "time", "elapsedDays", "nextLineId", "nextVehicleId", "nextPassengerId", "transported", "totalDemand", "totalGenerated", "totalBoarded", "totalArrived"]) finite(state[field], `état.${field}`);
  if (state.money < 0 || state.time < 0 || state.time >= 1440 || state.elapsedDays < 0) invalid("compteur temporel ou financier hors limites");
  for (const field of ["elapsedDays", "nextLineId", "nextVehicleId", "nextPassengerId", "transported", "totalBoarded", "totalArrived"]) integer(state[field], `état.${field}`, { min: 0 });
  if (state.totalAbandoned !== undefined) integer(state.totalAbandoned, "état.totalAbandoned", { min: 0 });
  if (state.logs !== undefined) {
    array(state.logs, "état.logs");
    for (const entry of state.logs) string(entry, "état.logs[]");
  }
  if (state.journal !== undefined) {
    array(state.journal, "état.journal");
    for (const entry of state.journal) {
      object(entry, "état.journal[]");
      string(entry.type, "journal.type"); string(entry.text, "journal.text");
    }
  }
  for (const entry of state.dailyStats) {
    object(entry, "état.dailyStats[]");
    integer(entry.day, "statistique.jour", { min: 0 });
    for (const field of ["income", "expenses", "net"]) finite(entry[field], `statistique.${field}`);
  }
  for (const report of state.dailyReports) {
    object(report, "état.dailyReports[]");
    integer(report.day, "rapport.jour", { min: 0 });
    for (const field of ["income", "expenses", "net", "satisfaction", "arrived", "abandonedCount", "avgWaitMinutes", "contractsCompleted", "goalsCompleted"]) finite(report[field], `rapport.${field}`);
    array(report.events, "rapport.events"); array(report.recommendations, "rapport.recommendations");
    for (const item of report.events) string(item, "rapport.events[]");
    for (const item of report.recommendations) string(item, "rapport.recommendations[]");
  }
  if (state.latestReport !== null && state.latestReport !== undefined) object(state.latestReport, "état.latestReport");
  for (const event of state.activeEvents) {
    object(event, "état.activeEvents[]"); integer(event.id, "événement.id", { min: 1 });
    string(event.type, "événement.type"); integer(event.startedDay, "événement.startedDay", { min: 0 }); integer(event.endsDay, "événement.endsDay", { min: 0 }); string(event.cause, "événement.cause");
  }
  if (state.eventHistory !== undefined) {
    array(state.eventHistory, "état.eventHistory");
    for (const event of state.eventHistory) object(event, "état.eventHistory[]");
  }
  for (const contract of state.activeContracts) {
    object(contract, "état.activeContracts[]"); string(contract.id, "contrat.id"); integer(contract.cycle, "contrat.cycle", { min: 0 });
    integer(contract.startedDay, "contrat.startedDay", { min: 0 });
    if (typeof contract.completed !== "boolean") invalid("contrat.completed invalide");
  }
  if (state.contractHistory !== undefined) {
    array(state.contractHistory, "état.contractHistory");
    for (const contract of state.contractHistory) object(contract, "état.contractHistory[]");
  }
  for (const goalId of state.completedGoals) string(goalId, "état.completedGoals[]");
  if (state.progressionHistory !== undefined) {
    array(state.progressionHistory, "état.progressionHistory");
    for (const completion of state.progressionHistory) object(completion, "état.progressionHistory[]");
  }
  for (const field of ["lines", "vehicles", "passengers"]) uniqueNumericIds(state[field], `état.${field}`);

  const lineIds = new Set();
  for (const line of state.lines) {
    string(line.name, "ligne.name"); string(line.color, "ligne.color");
    integer(line.id, "ligne.id", { min: 1 });
    if (lineIds.has(line.id)) invalid("lignes avec identifiants dupliqués");
    lineIds.add(line.id);
    if (!VEHICLE_MODES.has(line.mode)) invalid("mode de ligne inconnu");
    array(line.stopIds, "ligne.stopIds");
    if (line.stopIds.length < 2 || line.stopIds.some(id => !stopIds.has(id))) invalid("ligne avec arrêt inconnu");
    array(line.vehicles, "ligne.vehicles");
    for (const vehicleId of line.vehicles) integer(vehicleId, "ligne.vehicles[]", { min: 1 });
    object(line.route, "ligne.route");
    array(line.route.nodeIds, "ligne.route.nodeIds");
    if (line.route.nodeIds.some(id => !stopIds.has(id))) invalid("itinéraire de ligne avec nœud inconnu");
    finite(line.route.totalLength, "ligne.route.totalLength");
    finite(line.income, "ligne.income"); finite(line.expenses, "ligne.expenses"); finite(line.riders, "ligne.riders");
  }

  const vehicleIds = new Set();
  for (const vehicle of state.vehicles) {
    integer(vehicle.id, "véhicule.id", { min: 1 });
    if (vehicleIds.has(vehicle.id)) invalid("véhicules avec identifiants dupliqués");
    vehicleIds.add(vehicle.id);
    if (!lineIds.has(vehicle.lineId) || !VEHICLE_MODES.has(vehicle.mode)) invalid("véhicule rattaché à une ligne inconnue");
    integer(vehicle.routeIndex, "véhicule.routeIndex", { min: 0 });
    finite(vehicle.progress, "véhicule.progress");
    if (vehicle.progress < 0 || vehicle.progress > 1) invalid("progression de véhicule hors limites");
    integer(vehicle.direction, "véhicule.direction");
    finite(vehicle.capacity, "véhicule.capacity");
    if (vehicle.capacity <= 0) invalid("capacité de véhicule invalide");
    array(vehicle.onboard, "véhicule.onboard");
    for (const passengerId of vehicle.onboard) integer(passengerId, "véhicule.onboard[]", { min: 1 });
    finite(vehicle.speed, "véhicule.speed"); finite(vehicle.congestion, "véhicule.congestion");
    integer(vehicle.brokenTicksLeft, "véhicule.brokenTicksLeft", { min: 0 });
  }
  for (const line of state.lines) {
    if (line.vehicles.some(id => !vehicleIds.has(id))) invalid("ligne référant un véhicule inconnu");
  }

  const passengerIds = new Set();
  for (const passenger of state.passengers) {
    integer(passenger.id, "passager.id", { min: 1 });
    if (passengerIds.has(passenger.id)) invalid("passagers avec identifiants dupliqués");
    passengerIds.add(passenger.id);
    for (const field of ["originId", "destinationId", "currentStopId"]) if (!stopIds.has(passenger[field])) invalid("passager référant un arrêt inconnu");
    if (!PASSENGER_STATES.has(passenger.state)) invalid("état de passager inconnu");
    finite(passenger.createdAt, "passager.createdAt"); finite(passenger.waitedMinutes, "passager.waitedMinutes");
    finite(passenger.transfersDone, "passager.transfersDone"); finite(passenger.travelMinutes, "passager.travelMinutes");
    if (passenger.waitedMinutes < 0 || passenger.transfersDone < 0 || passenger.travelMinutes < 0) invalid("métrique de passager négative");
    if (passenger.itinerary !== null) {
      array(passenger.itinerary, "passager.itinerary");
      for (const leg of passenger.itinerary) {
        object(leg, "passager.itinerary[]");
        integer(leg.lineId, "étape de trajet.lineId", { min: 1 });
        if (!lineIds.has(leg.lineId) || !stopIds.has(leg.from) || !stopIds.has(leg.to)) invalid("étape de trajet incohérente");
      }
    }
    if (passenger.vehicleId !== null && !vehicleIds.has(passenger.vehicleId)) invalid("passager rattaché à un véhicule inconnu");
  }
  for (const vehicle of state.vehicles) for (const passengerId of vehicle.onboard) if (!passengerIds.has(passengerId)) invalid("véhicule contenant un passager inconnu");
  validateSerializedNetwork(state.network, "état.network");
  validateSerializedNetwork(state.undergroundNetwork, "état.undergroundNetwork");
  return state;
}

export function validateSavePayload(payload) {
  object(payload, "payload");
  if (payload.format !== SAVE_FORMAT) invalid("format inconnu");
  if (payload.version !== SAVE_FORMAT_VERSION) invalid(`Format de sauvegarde invalide (attendu: ${SAVE_FORMAT_VERSION}) : version de format non supportée`);
  if (!payload.savedAt || Number.isNaN(Date.parse(payload.savedAt))) invalid("date absente ou invalide");
  if (payload.rngState !== null && payload.rngState !== undefined) integer(payload.rngState, "état du générateur aléatoire", { min: 0, max: UINT32_MAX });
  validateState(payload.state);
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
