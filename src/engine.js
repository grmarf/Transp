import { TICK_MINUTES, STOP_RADIUS, distance } from "./constants.js";
import { findPassengerRoute, routeLegs, invalidateRoutingCache } from "./routing.js";
import { PASSENGER_STATES, createPassenger, waitStats, intermodalStats } from "./passengers.js";
import {
  createVehicle,
  updateVehicles,
  vehiclePosition,
  buyVehicleForLine,
  sellVehicleFromLine,
  lineOccupancyRate,
  returnPassengersToWaiting,
  lineHeadwayMinutes,
  lineOperatingCost,
  vehicleMode,
  VEHICLE_RESALE_RATIO,
  ADD_VEHICLE_COST,
  congestionHeatmap
} from "./vehicles.js";
import { growCity, serviceLevel } from "./growth.js";
import { maybeStartRoadworks, maybeEndRoadworks } from "./disruptions.js";
import { evaluateScenario } from "./scenarios.js";
import { eventDemandMultiplier, eventJournal, eventSatisfactionDelta, finishExpiredEvents, startContextualEvent } from "./events.js";
import { evaluateProgression } from "./progression.js";

export {
  TICK_MINUTES, STOP_RADIUS, distance, vehiclePosition, buyVehicleForLine,
  sellVehicleFromLine, lineOccupancyRate, lineHeadwayMinutes, ADD_VEHICLE_COST,
  VEHICLE_RESALE_RATIO, vehicleMode, serviceLevel, congestionHeatmap, intermodalStats,
  eventDemandMultiplier, eventSatisfactionDelta
};

function progressionMetrics(state) {
  const intermodal = intermodalStats(state);
  return { satisfaction: satisfaction(state), transferShare: intermodal.shareWithTransfer };
}

/** V16.1 — browser actions unlock milestones without waiting for midnight. */
export function evaluateLiveProgression(state, log = () => {}) {
  if (!state.progressionEnabled) return [];
  return evaluateProgression(state, progressionMetrics(state), log);
}
export function stopById(state, id) {
  return state.city.stops.find(s => s.id === id);
}


export function lineLength(state, line) {
  if (line.route?.totalLength) return line.route.totalLength;
  let d = 0;
  for (let i = 1; i < line.stopIds.length; i++) {
    d += distance(stopById(state, line.stopIds[i - 1]), stopById(state, line.stopIds[i]));
  }
  return d;
}

export function createLine(state) {
  state.lineMode = true;
  state.pendingStops = [];
}

export function cancelLineMode(state) {
  state.lineMode = false;
  state.pendingStops = [];
  state.extendingLineId = null;
}

// V12.0 — line editing: append new stops to an existing line instead of
// only ever creating a fresh one. Reuses the same lineMode/pendingStops
// flow as line creation (one tap-collection loop, one finish action) so
// the map interaction the player already knows keeps working unchanged.
export function startExtendLine(state, lineId) {
  const line = state.lines.find(l => l.id === lineId);
  if (!line) return false;
  state.lineMode = true;
  state.pendingStops = [];
  state.extendingLineId = lineId;
  return true;
}

// V12.0 — flat administrative fee for extending a line, on top of the
// same per-pixel road/infrastructure cost a new line pays (kept far below
// finishLine's 800€ base fee: an extension reuses an already-running line).
const EXTEND_LINE_BASE_FEE = 200;

export function finishExtendLine(state, log, routeLine) {
  const line = state.lines.find(l => l.id === state.extendingLineId);
  if (!line) { cancelLineMode(state); return false; }

  if (state.pendingStops.length < 1) {
    log("Sélectionnez au moins un arrêt à ajouter à la ligne.");
    return false;
  }

  const newStopIds = [...line.stopIds, ...state.pendingStops];
  const mode = vehicleMode(line.mode);
  // V13.0: extending a metro line stays underground; same fallback as
  // finishLine when no undergroundNetwork exists.
  const network = mode.id === "metro" && state.undergroundNetwork ? state.undergroundNetwork : state.network;
  const route = routeLine(network, newStopIds);
  if (!route) {
    log(mode.id === "metro"
      ? "Extension impossible : aucun tunnel possible vers ces arrêts."
      : "Extension impossible : les nouveaux arrêts ne sont pas reliés par le réseau routier.");
    return false;
  }

  const oldLength = lineLength(state, line);
  const newLength = route.totalLength ?? oldLength;
  const addedLength = Math.max(0, newLength - oldLength);
  const infrastructureCost = Math.round(addedLength * mode.trackCostPerPixel);
  const cost = EXTEND_LINE_BASE_FEE + Math.round(addedLength * 1.2) + infrastructureCost;

  if (state.money < cost) {
    log(`Extension impossible : ${cost.toLocaleString("fr-FR")} € nécessaires.`);
    return false;
  }

  state.money -= cost;
  line.stopIds = newStopIds;
  line.route = route;
  invalidateRoutingCache(state);

  const addedNames = state.pendingStops
    .map(id => stopById(state, id)?.name)
    .filter(Boolean)
    .join(", ");
  log(`${line.name} étendue vers ${addedNames} : coût ${cost.toLocaleString("fr-FR")} €.`);
  cancelLineMode(state);
  return true;
}

export function finishLine(state, log, routeLine, modeId = "bus") {
  if (state.pendingStops.length < 2) {
    log("Une ligne nécessite au moins 2 arrêts.");
    return false;
  }

  const stopIds = [...state.pendingStops];
  const mode = vehicleMode(modeId);
  // V13.0: a metro line tunnels through its own independent underground
  // network (direct point-to-point, ignores surface roads) instead of
  // following the road graph like bus/tram. Falls back to the surface
  // network when none was built (older callers/tests that never set
  // state.undergroundNetwork), preserving V12's behavior exactly.
  const network = mode.id === "metro" && state.undergroundNetwork ? state.undergroundNetwork : state.network;
  const route = routeLine(network, stopIds);
  if (!route) {
    log(mode.id === "metro"
      ? "Création impossible : aucun tunnel possible entre ces arrêts."
      : "Création impossible : les arrêts sélectionnés ne sont pas reliés par le réseau routier.");
    return false;
  }

  const line = {
    id: state.nextLineId++,
    name: `Ligne ${state.nextLineId - 1}`,
    color: ["#e85d5d","#4d8fe8","#55b878","#c978d8","#e0a44b","#45bfc1"][(state.nextLineId - 2) % 6],
    mode: mode.id,
    stopIds,
    route,
    vehicles: [],
    income: 0,
    expenses: 0,
    riders: 0
  };

  // V7.0: tram/métro add a one-time infrastructure cost (track/tunnel) on
  // top of the usual road-based line cost; 0 for bus, which uses existing
  // roads — so a bus line's cost is exactly what it was before V7.0.
  const infrastructureCost = Math.round(lineLength(state, line) * mode.trackCostPerPixel);
  const cost = 800 + Math.round(lineLength(state, line) * 1.2) + infrastructureCost;
  if (state.money < cost) {
    log(`Création impossible : ${cost.toLocaleString("fr-FR")} € nécessaires.`);
    return false;
  }

  state.money -= cost;
  state.lines.push(line);
  invalidateRoutingCache(state);

  const vehicle = createVehicle(state, line.id, { mode: mode.id });
  state.vehicles.push(vehicle);
  line.vehicles.push(vehicle.id);
  evaluateLiveProgression(state, log);

  const infraNote = infrastructureCost > 0 ? ` (dont ${infrastructureCost.toLocaleString("fr-FR")} € d'infrastructure ${mode.name.toLowerCase()})` : "";
  log(`${line.name} créée (${mode.name}) : ${line.stopIds.length} arrêts, ${route.nodeIds.length - 1} segments réseau, coût ${cost.toLocaleString("fr-FR")} €${infraNote}.`);
  cancelLineMode(state);
  return true;
}

// V11.0 — line management: remove a line entirely. Every vehicle on it is
// sold off (same partial refund as sellVehicleFromLine) and its passengers
// are put back into circulation rather than lost; any passenger elsewhere
// whose cached itinerary used this line is reset so routing recomputes
// around its removal instead of trying to board a line that no longer runs.
export function deleteLine(state, lineId, log) {
  const line = state.lines.find(l => l.id === lineId);
  if (!line) return false;

  let refund = 0;
  for (const vehicleId of [...line.vehicles]) {
    const vehicle = state.vehicles.find(v => v.id === vehicleId);
    if (!vehicle) continue;
    returnPassengersToWaiting(state, vehicle);
    refund += Math.round(vehicleMode(vehicle.mode).purchaseCost * VEHICLE_RESALE_RATIO);
  }
  state.vehicles = state.vehicles.filter(v => v.lineId !== lineId);
  state.lines = state.lines.filter(l => l.id !== lineId);
  state.money += refund;
  invalidateRoutingCache(state);

  for (const passenger of state.passengers) {
    if (routeLegs(passenger.itinerary).some(leg => leg.lineId === lineId)) {
      passenger.itinerary = null;
      if (passenger.legIndex) passenger.legIndex = 0;
    }
  }

  log(`${line.name} supprimée : ${line.vehicles.length} véhicule${line.vehicles.length > 1 ? "s" : ""} revendu${line.vehicles.length > 1 ? "s" : ""} (+${refund.toLocaleString("fr-FR")} €).`);
  return true;
}

// V5.0 — trip generation: households (population) as origins, workplaces
// (jobs) and shops/leisure (commerce) as destination attractors, with a
// realistic time-of-day mix instead of a single symmetric `demand` field
// used for both ends of the trip.
const TRIP_RATE = 0.00033; // tuned to keep overall trip volume close to V4.0's

export function generateDemand(state, rng) {
  // Demand is generated over the actual simulated interval. At 1x this is
  // exactly one 10-minute slice; at 1000x we integrate all 1000 slices so
  // rush/off-peak demand remains coherent instead of being generated once
  // and then skipping almost seven simulated days.
  const slices = Math.max(1, Math.ceil(state.speed));
  const sliceMinutes = (TICK_MINUTES * state.speed) / slices;
  const stops = state.city.stops;

  for (let slice = 0; slice < slices; slice++) {
    const hour = ((state.time + slice * sliceMinutes) / 60) % 24;
    const isRush = (hour >= 7 && hour < 9) || (hour >= 17 && hour < 19.5);
    const rush = isRush ? 1.8 : 0.75;
    const jobsWeight = isRush ? 1 : 0.3;
    const commerceWeight = isRush ? 0.3 : 1;
    const intervalFactor = sliceMinutes / TICK_MINUTES;

    for (const origin of stops) {
      const base = rng() * TRIP_RATE * origin.population * rush * intervalFactor *
        (state.scenario?.demandMultiplier ?? 1) * eventDemandMultiplier(state);
      if (base <= 0) continue;

      const candidates = stops.filter(s => s.id !== origin.id);
      let totalWeight = 0;
      const weights = candidates.map(destination => {
        const d = Math.max(1, distance(origin, destination));
        const attractiveness = destination.jobs * jobsWeight + destination.commerce * commerceWeight;
        const weight = attractiveness * (0.65 + Math.min(1.35, d / 350));
        totalWeight += weight;
        return weight;
      });

      candidates.forEach((destination, i) => {
        const generated = base * (weights[i] / totalWeight);
        if (!origin.waitingByDestination) origin.waitingByDestination = {};
        state.totalDemand += generated;
        state.totalGenerated += generated;

        const pool = (origin.waitingByDestination[destination.id] || 0) + generated;
        const count = Math.floor(pool);
        origin.waitingByDestination[destination.id] = pool - count;

        for (let n = 0; n < count; n++) {
          const passenger = createPassenger({
            originId: origin.id,
            destinationId: destination.id,
            createdAt: (state.time + slice * sliceMinutes) % 1440
          });
          passenger.id = state.nextPassengerId++;
          passenger.itinerary = findPassengerRoute(state, origin.id, destination.id);
          if (!passenger.itinerary) passenger.state = PASSENGER_STATES.ABANDONED;
          state.passengers.push(passenger);
        }
      });
    }
  }
}

export function economy(state) {
  // V4.0: cost is computed and attributed per line (so profitability is
  // comparable line by line), instead of one flat global deduction.
  const hours = (TICK_MINUTES / 60) * state.speed;
  for (const line of state.lines) {
    const cost = lineOperatingCost(state, line, hours);
    line.expenses = (line.expenses || 0) + cost;
    state.money -= cost;
  }
}

/** V4.0 — aggregate financial picture, for the sidebar bilan. */
export function networkFinancials(state) {
  const income = state.lines.reduce((a, l) => a + (l.income || 0), 0);
  const expenses = state.lines.reduce((a, l) => a + (l.expenses || 0), 0);
  return { income, expenses, net: income - expenses };
}

/** V12.0 — decision-support: surfaces the network's weak points instead of
 * making the player scan every line/stop by hand. Pure read of already
 * tracked state (income/expenses, occupancy, service level, demand
 * pressure) — no new simulation, so it can't itself change outcomes.
 */
export function networkOpportunities(state) {
  let worstLine = null;
  for (const line of state.lines) {
    const net = (line.income || 0) - (line.expenses || 0);
    if (!worstLine || net < worstLine.net) worstLine = { line, net };
  }
  // Only worth flagging if it's actually losing money.
  const unprofitableLine = worstLine && worstLine.net < 0 ? worstLine : null;

  let saturatedLine = null;
  for (const line of state.lines) {
    const occupancy = lineOccupancyRate(state, line);
    if (occupancy != null && occupancy >= 0.85 && (!saturatedLine || occupancy > saturatedLine.occupancy)) {
      saturatedLine = { line, occupancy };
    }
  }

  let underservedStop = null;
  for (const stop of state.city.stops) {
    const level = serviceLevel(state, stop);
    if (level >= 0.3) continue; // already decently served
    const pressure = Object.values(stop.waitingByDestination || {}).reduce((a, v) => a + v, 0);
    if (pressure < 1) continue; // no meaningful unmet demand yet
    if (!underservedStop || pressure > underservedStop.pressure) underservedStop = { stop, level, pressure };
  }

  return { unprofitableLine, saturatedLine, underservedStop };
}

export function satisfaction(state) {
  // V3.0: based on real passenger wait times and abandonment instead of the
  // legacy origin.waitingByDestination bucket, which accumulated demand
  // without ever being decremented and made satisfaction drift to 0 over
  // any sufficiently long game.
  const { avgWaitMinutes, waitingCount, abandonedCount } = waitStats(state);
  const waitPenalty = avgWaitMinutes * 0.6;
  const abandonPenalty = waitingCount + abandonedCount > 0
    ? (abandonedCount / (waitingCount + abandonedCount)) * 40
    : 0;
  const intermodal = intermodalStats(state);
  const intermodalBonus = intermodal.shareWithTransfer > 0.15 ? 5 : 0;
  return Math.max(0, Math.min(100, 100 - waitPenalty - abandonPenalty + intermodalBonus + eventSatisfactionDelta(state)));
}

/** Derived narrative entries for the V14 city journal. */
export function cityJournal(state) {
  const entries = [];
  const intermodal = intermodalStats(state);
  if (intermodal.shareWithTransfer > 0.2) {
    entries.push({ type: "positive", text: `Le réseau intermodal fonctionne : ${(intermodal.shareWithTransfer * 100).toFixed(0)}% des voyages utilisent des correspondances.` });
  }
  const { unprofitableLine, saturatedLine, underservedStop } = networkOpportunities(state);
  if (unprofitableLine) entries.push({ type: "warning", text: `${unprofitableLine.line.name} perd de l'argent (${Math.round(unprofitableLine.net).toLocaleString("fr-FR")} €).` });
  if (saturatedLine) entries.push({ type: "warning", text: `${saturatedLine.line.name} est saturée (${(saturatedLine.occupancy * 100).toFixed(0)}% de remplissage).` });
  if (underservedStop) entries.push({ type: "info", text: `Le quartier ${underservedStop.stop.name} manque de transport (niveau de service ${(underservedStop.level * 100).toFixed(0)}%).` });
  entries.push(...eventJournal(state));
  if (!entries.length) entries.push({ type: "positive", text: "Le réseau fonctionne correctement." });
  return entries;
}

/**
 * Remove terminal passenger agents after a bounded retention window. Agents
 * still referenced by a vehicle are never removed. Historical totals remain
 * in state counters, while active waiting/transferring/onboard agents stay.
 */
export function cleanupPassengers(state, retentionDays = state.passengerRetentionDays ?? 2) {
  const now = (state.elapsedDays || 0) * 1440 + (state.time || 0);
  const cutoff = now - Math.max(0, retentionDays) * 1440;
  const onboard = new Set(state.vehicles.flatMap(vehicle => vehicle.onboard || []));
  const before = state.passengers.length;
  state.passengers = state.passengers.filter(passenger => {
    const terminal = passenger.state === PASSENGER_STATES.ARRIVED || passenger.state === PASSENGER_STATES.ABANDONED;
    if (!terminal || onboard.has(passenger.id)) return true;
    // Older saves only have a clock-time `arrivedAt`, which is not an
    // absolute timestamp once the simulation crosses midnight. Retain those
    // records rather than risking premature deletion after migration.
    const completedAt = passenger.completedAt ?? null;
    return completedAt == null || completedAt > cutoff;
  });
  return before - state.passengers.length;
}

export function step(state, rng, log) {
  if (state.paused) return;
  for (const passenger of state.passengers) {
    if (passenger.state === PASSENGER_STATES.WAITING || passenger.state === PASSENGER_STATES.TRANSFERRING) {
      passenger.waitedMinutes += TICK_MINUTES * state.speed;
      if (passenger.waitedMinutes >= 120 && !findPassengerRoute(state, passenger.currentStopId, passenger.destinationId)) {
        passenger.state = PASSENGER_STATES.ABANDONED;
        passenger.completedAt = (state.elapsedDays || 0) * 1440 + state.time;
      } else if (passenger.waitedMinutes >= 240) {
        passenger.state = PASSENGER_STATES.ABANDONED;
        passenger.completedAt = (state.elapsedDays || 0) * 1440 + state.time;
      }
    }
  }
  generateDemand(state, rng);
  updateVehicles(state, rng, log);
  economy(state);

  // V6.0 — urban evolution / V8.0 — roadworks lifecycle: both run once per
  // simulated day (not per tick): a day boundary is crossed exactly when
  // adding this tick's minutes pushes state.time past 1440.
  // V6.0 — urban evolution / V8.0 — roadworks lifecycle / V9.0 — scenario
  // evaluation: all run once per simulated day. V9.1: at very high speed
  // (e.g. 1000x) a single tick can cross *several* day boundaries, so this
  // loops over every day actually crossed instead of assuming at most one.
  const newTime = state.time + TICK_MINUTES * state.speed;
  const daysCrossed = Math.floor(newTime / 1440);
  // Defensive default: a save from before V11.0 won't have this field.
  if (!state.dailyBaseline) state.dailyBaseline = { income: 0, expenses: 0 };
  for (let d = 0; d < daysCrossed; d++) {
    state.elapsedDays = (state.elapsedDays || 0) + 1;
    growCity(state, rng, log);
    maybeEndRoadworks(state, log);
    maybeStartRoadworks(state, rng, log);
    finishExpiredEvents(state, log);
    const wait = waitStats(state);
    const serviceRatio = state.totalDemand > 0 ? state.totalArrived / state.totalDemand : 0;
    const activePassengers = state.passengers.length + state.totalArrived;
    startContextualEvent(state, rng, log, {
      satisfaction: satisfaction(state),
      abandonedRate: activePassengers > 0 ? wait.abandonedCount / activePassengers : 0,
      serviceRatio
    });
    // V9.0: evaluated last, after this day's growth/economy/disruptions have
    // landed, using metrics computed here so scenarios.js needs no import
    // from engine.js (avoids an engine <-> scenarios cycle).
    if (state.progressionEnabled) evaluateProgression(state, progressionMetrics(state), log);
    evaluateScenario(state, log, { net: networkFinancials(state).net, currentSatisfaction: satisfaction(state) });

    // V11.0 — record this day's income/expense/net delta (not the running
    // cumulative total) so the UI can show a cash-flow trend across days.
    const fin = networkFinancials(state);
    const dayIncome = fin.income - state.dailyBaseline.income;
    const dayExpenses = fin.expenses - state.dailyBaseline.expenses;
    state.dailyBaseline = { income: fin.income, expenses: fin.expenses };
    if (!state.dailyStats) state.dailyStats = [];
    state.dailyStats.push({ day: state.elapsedDays, income: dayIncome, expenses: dayExpenses, net: dayIncome - dayExpenses });
    if (state.dailyStats.length > 14) state.dailyStats.shift();
    cleanupPassengers(state);
  }
  state.time = newTime % 1440;
  if (state.money < 0) {
    state.money = 0;
    if (rng() < 0.05) log("Les finances sont à zéro : le réseau accumule du retard.");
  }
}
