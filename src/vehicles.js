/** V2.7 — Vehicles
 * Vehicle lifecycle and movement. Keeps vehicle-specific behavior isolated from
 * the economic/time simulation while preserving the existing engine contract.
 */

import { findPassengerRoute, routeLegs } from "./routing.js";
import { eventFareMultiplier } from "./events.js";
import { seasonFareMultiplier } from "./seasons.js";
import { PASSENGER_STATES } from "./passengers.js";
import { TICK_MINUTES } from "./constants.js";
import { fareAcceptance } from "./demographics.js";

export const DEFAULT_VEHICLE_CAPACITY = 35;
// V21.0 — vitesses accélérées pour rendre les trajets jouables. Les
// sauvegardes historiques ne sont pas concernées : aucune n’existe encore.
export const DEFAULT_VEHICLE_SPEED = 0.5;

// V7.0 — transport modes.
export const VEHICLE_MODES = {
  bus:   { id: "bus",   name: "Bus",     capacity: 35,  speed: 0.5, purchaseCost: 3000,  opexPerHour: 12, congestionResistance: 0,   trackCostPerPixel: 0 },
  tram:  { id: "tram",  name: "Tramway", capacity: 70,  speed: 2,   purchaseCost: 9000,  opexPerHour: 22, congestionResistance: 0.5, trackCostPerPixel: 2.5 },
  metro: { id: "metro", name: "Métro",   capacity: 160, speed: 5,   purchaseCost: 25000, opexPerHour: 45, congestionResistance: 1,   trackCostPerPixel: 6 }
};

export function vehicleMode(modeId) {
  return VEHICLE_MODES[modeId] || VEHICLE_MODES.bus;
}

export const ADD_VEHICLE_COST = 3000;
export const VEHICLE_RESALE_RATIO = 0.5;
export const VEHICLE_OPEX_PER_HOUR = 12;
export const FARE_BASE_LEG = 1.2;
export const FARE_PER_100PX = 0.5;

const CONGESTION_SLOWDOWN_PER_VEHICLE = 0.18;

export function createVehicle(state, lineId, options = {}) {
  const mode = vehicleMode(options.mode);
  return {
    id: state.nextVehicleId++,
    lineId,
    mode: mode.id,
    routeIndex: 0,
    progress: 0,
    direction: 1,
    capacity: options.capacity ?? mode.capacity,
    onboard: [],
    speed: options.speed ?? mode.speed,
    congestion: 1,
    congestionResistance: mode.congestionResistance,
    brokenTicksLeft: 0
  };
}

export function addVehicleToLine(state, line) {
  const ids = line.route?.nodeIds;
  if (!ids?.length) return null;

  const vehicle = createVehicle(state, line.id, { mode: line.mode });
  const existingCount = line.vehicles.length;
  vehicle.routeIndex = Math.floor((ids.length * existingCount) / (existingCount + 1)) % ids.length;

  state.vehicles.push(vehicle);
  line.vehicles.push(vehicle.id);
  return vehicle;
}

export function buyVehicleForLine(state, lineId, log) {
  const line = state.lines.find(l => l.id === lineId);
  if (!line) return false;

  const cost = vehicleMode(line.mode).purchaseCost;
  if (state.money < cost) {
    log(`Véhicule supplémentaire impossible : ${cost.toLocaleString("fr-FR")} € nécessaires.`);
    return false;
  }

  const vehicle = addVehicleToLine(state, line);
  if (!vehicle) return false;

  state.money -= cost;
  log(`${line.name} : véhicule supplémentaire ajouté (${line.vehicles.length} au total).`);
  return true;
}

export function returnPassengersToWaiting(state, vehicle) {
  for (const passengerId of vehicle.onboard) {
    const passenger = state.passengers.find(p => p.id === passengerId);
    if (!passenger) continue;
    passenger.currentStopId = passenger.originId;
    passenger.legIndex = 0;
    passenger.itinerary = null;
    passenger.vehicleId = null;
    passenger.state = PASSENGER_STATES.WAITING;
  }
  vehicle.onboard = [];
}

export function sellVehicleFromLine(state, lineId, vehicleId, log) {
  const line = state.lines.find(l => l.id === lineId);
  if (!line) return 0;
  if (line.vehicles.length <= 1) {
    log(`${line.name} : impossible de vendre le dernier véhicule (supprimez la ligne à la place).`);
    return 0;
  }

  const vehicle = state.vehicles.find(v => v.id === vehicleId && v.lineId === lineId);
  if (!vehicle) return 0;

  returnPassengersToWaiting(state, vehicle);
  line.vehicles = line.vehicles.filter(id => id !== vehicleId);
  state.vehicles = state.vehicles.filter(v => v.id !== vehicleId);

  const refund = Math.round(vehicleMode(vehicle.mode).purchaseCost * VEHICLE_RESALE_RATIO);
  state.money += refund;
  log(`${line.name} : véhicule vendu (+${refund.toLocaleString("fr-FR")} €, ${line.vehicles.length} restant${line.vehicles.length > 1 ? "s" : ""}).`);
  return refund;
}

export function lineOccupancyRate(state, line) {
  if (!line.vehicles.length) return null;
  let totalOnboard = 0;
  let totalCapacity = 0;
  for (const id of line.vehicles) {
    const vehicle = state.vehicles.find(v => v.id === id);
    if (!vehicle) continue;
    totalOnboard += vehicle.onboard.length;
    totalCapacity += vehicle.capacity;
  }
  return totalCapacity > 0 ? totalOnboard / totalCapacity : null;
}

/**
 * V21.0 — Intervalle (minutes) entre deux véhicules consécutifs sur la
 * ligne. Depuis que les lignes font un aller-retour, le cycle complet fait
 * `cycleLength` (≈ 2 × totalLength) : un véhicule met donc deux fois plus
 * de temps à boucler. On utilise `cycleLength` quand il existe, sinon on
 * retombe sur `totalLength` (rétrocompatibilité avec les sauvegardes
 * antérieures à V21.0 qui n'ont pas ce champ).
 */
export function lineHeadwayMinutes(state, line) {
  const cycleDistance = line.route?.cycleLength ?? line.route?.totalLength;
  if (!cycleDistance || !line.vehicles.length) return null;

  const speeds = line.vehicles
    .map(id => state.vehicles.find(v => v.id === id)?.speed)
    .filter(Boolean);
  if (!speeds.length) return null;

  const avgSpeed = speeds.reduce((a, s) => a + s, 0) / speeds.length;
  const pixelsPerTick = avgSpeed * 120;
  if (!pixelsPerTick) return null;

  const cycleTicks = cycleDistance / pixelsPerTick;
  const cycleMinutes = cycleTicks * TICK_MINUTES;
  return cycleMinutes / line.vehicles.length;
}

export function lineOperatingCost(state, line, hours) {
  let cost = 0;
  for (const vehicleId of line.vehicles) {
    const vehicle = state.vehicles.find(v => v.id === vehicleId);
    if (!vehicle) continue;
    const congestionPenalty = 1 + (1 - (vehicle.congestion ?? 1));
    const opexPerHour = vehicleMode(vehicle.mode).opexPerHour;
    cost += opexPerHour * hours * congestionPenalty;
  }
  return cost;
}

function stopById(state, id) {
  return state.city.stops.find(s => s.id === id);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isScheduledStop(line, nodeId) {
  return line.stopIds.includes(nodeId);
}

function legFare(state, leg, arrivalStop) {
  const boardedAt = stopById(state, leg.from);
  const d = boardedAt ? distance(boardedAt, arrivalStop) : 0;
  return (FARE_BASE_LEG + (d / 100) * FARE_PER_100PX) * eventFareMultiplier(state) * seasonFareMultiplier(state) * (state.fareLevel ?? 1);
}

function boardPassengers(state, line, vehicle, stop) {
  let free = Math.max(0, vehicle.capacity - vehicle.onboard.length);
  if (!free) return 0;
  const choices = state.passengers
    .filter(p => p.currentStopId === stop.id && p.state === PASSENGER_STATES.WAITING)
    .map(p => { if (!p.itinerary) p.itinerary = findPassengerRoute(state, stop.id, p.destinationId); return p; })
    .filter(p => {
      const legs = routeLegs(p.itinerary);
      return legs.length && legs[p.legIndex || 0]?.lineId === line.id;
    })
    .filter(p => !state.demographicsEnabled || fareAcceptance(p.demographic, state.fareLevel ?? 1) >= 0.3)
    .sort((a, b) => {
      const al = routeLegs(a.itinerary), bl = routeLegs(b.itinerary);
      return (al.length - (a.legIndex || 0)) - (bl.length - (b.legIndex || 0)) ||
        ((a.itinerary?.transfers || 0) - (a.transfersDone || 0)) - ((b.itinerary?.transfers || 0) - (b.transfersDone || 0)) ||
        (b.waitedMinutes || 0) - (a.waitedMinutes || 0);
    });
  let boarded = 0;
  for (const passenger of choices) {
    if (!free) break;
    passenger.state = PASSENGER_STATES.ON_VEHICLE;
    passenger.vehicleId = vehicle.id;
    vehicle.onboard.push(passenger.id);
    free--; boarded++;
  }
  state.totalBoarded += boarded;
  return boarded;
}

const TRANSFER_FARE_DISCOUNT = 0.5;

function alightPassengers(state, line, vehicle, stop) {
  let alight = 0;
  let revenue = 0;
  const remaining = [];

  for (const passengerId of vehicle.onboard) {
    const passenger = state.passengers.find(p => p.id === passengerId);
    if (!passenger) continue;
    const legs = routeLegs(passenger.itinerary);
    const leg = legs[passenger.legIndex || 0];
    if (!leg || leg.to !== stop.id || leg.lineId !== line.id) { remaining.push(passengerId); continue; }

    const fullFare = legFare(state, leg, stop);
    const fare = passenger.transfersDone > 0 ? fullFare * TRANSFER_FARE_DISCOUNT : fullFare;
    line.riders++;
    line.income += fare;
    line.incomeByDemo = line.incomeByDemo || {};
    const demoId = passenger.demographic || "commuter";
    line.incomeByDemo[demoId] = (line.incomeByDemo[demoId] || 0) + fare;
    state.money += fare;
    revenue += fare;
    alight++;
    if ((passenger.legIndex || 0) >= legs.length - 1) {
      passenger.currentStopId = stop.id;
      passenger.vehicleId = null;
      passenger.state = PASSENGER_STATES.ARRIVED;
      passenger.arrivedAt = state.time;
      passenger.completedAt = (state.elapsedDays || 0) * 1440 + state.time;
      state.totalArrived++;
      state.transported++;
    } else {
      passenger.legIndex++;
      passenger.transfersDone = (passenger.transfersDone || 0) + 1;
      passenger.currentStopId = stop.id;
      passenger.vehicleId = null;
      passenger.waitedMinutes = (passenger.waitedMinutes || 0) + 5 * state.speed;
      passenger.state = PASSENGER_STATES.WAITING;
    }
  }
  vehicle.onboard = remaining;
  return { alight, revenue };
}

function edgeKey(aId, bId) {
  return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
}

function currentEdgeKey(state, vehicle) {
  const line = state.lines.find(l => l.id === vehicle.lineId);
  const ids = line?.route?.nodeIds;
  if (!ids?.length) return null;
  const i = Math.min(vehicle.routeIndex, ids.length - 1);
  const next = (i + 1) % ids.length;
  return edgeKey(ids[i], ids[next]);
}

export function computeEdgeLoad(state) {
  const load = new Map();
  for (const vehicle of state.vehicles) {
    const key = currentEdgeKey(state, vehicle);
    if (!key) continue;
    load.set(key, (load.get(key) || 0) + 1);
  }
  return load;
}

export function congestionHeatmap(state) {
  const load = computeEdgeLoad(state);
  const heat = [];
  for (const [key, count] of load) {
    const [aId, bId] = key.split("|");
    const a = stopById(state, aId), b = stopById(state, bId);
    if (!a || !b) continue;
    heat.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, load: count, congestion: Math.max(0, 1 - congestionFactor(count)) });
  }
  return heat;
}

function congestionFactor(sharing) {
  return 1 / (1 + Math.max(0, sharing - 1) * CONGESTION_SLOWDOWN_PER_VEHICLE);
}

export const BREAKDOWN_CHANCE_PER_TICK = 0.0006;
export const BREAKDOWN_DURATION_TICKS_MIN = 12;
export const BREAKDOWN_DURATION_TICKS_MAX = 30;
export const BREAKDOWN_DURATION_MINUTES_MIN = BREAKDOWN_DURATION_TICKS_MIN * TICK_MINUTES;
export const BREAKDOWN_DURATION_MINUTES_MAX = BREAKDOWN_DURATION_TICKS_MAX * TICK_MINUTES;

function maybeBreakDown(state, vehicle, rng, log) {
  const remaining = vehicle.brokenTicksLeft === 0
    ? 0
    : (vehicle.brokenMinutesLeft ?? ((vehicle.brokenTicksLeft || 0) * TICK_MINUTES));
  const simulatedTicks = Math.max(1, state.speed);
  const wage = state.wageLevel ?? 1;
  const wageFactor = wage < 1 ? 1 + (1 - wage) * 2 : (wage >= 1.1 ? 0.7 : 1);
  const chanceThisStep = 1 - Math.pow(1 - BREAKDOWN_CHANCE_PER_TICK * wageFactor, simulatedTicks);
  if (remaining > 0 || rng() >= chanceThisStep) return;
  vehicle.brokenMinutesLeft = BREAKDOWN_DURATION_MINUTES_MIN +
    Math.floor(rng() * (BREAKDOWN_DURATION_MINUTES_MAX - BREAKDOWN_DURATION_MINUTES_MIN));
  vehicle.brokenTicksLeft = Math.ceil(vehicle.brokenMinutesLeft / TICK_MINUTES);
  const line = state.lines.find(l => l.id === vehicle.lineId);
  log(`Panne : un véhicule de ${line?.name ?? "?"} est immobilisé.`);
}

export function updateVehicles(state, rng = () => 1, log = () => {}) {
  const edgeLoad = computeEdgeLoad(state);

  for (const vehicle of state.vehicles) {
    const line = state.lines.find(l => l.id === vehicle.lineId);
    if (!line || !line.route?.nodeIds?.length) continue;

    maybeBreakDown(state, vehicle, rng, log);
    const elapsedMinutes = TICK_MINUTES * state.speed;
    const brokenMinutes = vehicle.brokenTicksLeft === 0
      ? 0
      : (vehicle.brokenMinutesLeft ?? ((vehicle.brokenTicksLeft || 0) * TICK_MINUTES));
    if (brokenMinutes > 0) {
      const remainingAfter = Math.max(0, brokenMinutes - elapsedMinutes);
      vehicle.brokenMinutesLeft = remainingAfter;
      vehicle.brokenTicksLeft = Math.ceil(remainingAfter / TICK_MINUTES);
      vehicle.congestion = 0;
      continue;
    }
    vehicle.brokenMinutesLeft = 0;
    vehicle.brokenTicksLeft = 0;
    for (const passengerId of vehicle.onboard) {
      const passenger = state.passengers.find(p => p.id === passengerId);
      if (passenger) passenger.travelMinutes = (passenger.travelMinutes || 0) + elapsedMinutes;
    }

    const ids = line.route.nodeIds;
    let budget = vehicle.speed * 120 * state.speed;
    let hops = 0;
    const maxHops = ids.length * 2 + 2;

    while (budget > 0 && hops < maxHops) {
      const i = Math.min(vehicle.routeIndex, ids.length - 1);
      const next = (i + 1) % ids.length;
      const a = state.network.nodes.get(ids[i]);
      const b = state.network.nodes.get(ids[next]);
      if (!a || !b) break;

      const sharing = edgeLoad.get(edgeKey(a.id, b.id)) || 1;
      const roadCongestion = congestionFactor(sharing);
      vehicle.congestion = 1 - (1 - roadCongestion) * (1 - (vehicle.congestionResistance ?? 0));

      const dist = Math.max(50, distance(a, b));
      const remainingDist = (1 - vehicle.progress) * dist;
      const coveredThisEdge = budget * vehicle.congestion;

      if (coveredThisEdge < remainingDist) {
        vehicle.progress += coveredThisEdge / dist;
        break;
      }

      budget -= remainingDist / vehicle.congestion;
      vehicle.progress = 0;
      vehicle.routeIndex = next;
      hops++;
      if (!isScheduledStop(line, b.id)) continue;

      const stop = stopById(state, b.id);
      if (!stop) continue;
      const result = alightPassengers(state, line, vehicle, stop);
      if (result.revenue > 0) log(`+${result.revenue.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} € passagers · ${line.name}.`);
      boardPassengers(state, line, vehicle, stop);
    }
  }
}

export function vehiclePosition(state, vehicle) {
  const line = state.lines.find(l => l.id === vehicle.lineId);
  if (!line?.route?.nodeIds?.length) return null;
  const ids = line.route.nodeIds;
  const i = Math.min(vehicle.routeIndex, ids.length - 1);
  const j = (i + 1) % ids.length;
  const a = state.network.nodes.get(ids[i]);
  const b = state.network.nodes.get(ids[j]);
  if (!a || !b) return null;
  return { x: a.x + (b.x - a.x) * vehicle.progress, y: a.y + (b.y - a.y) * vehicle.progress };
}

// === FIN DU FICHIER vehicles.js ===
