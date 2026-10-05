/** V8.0 — Disruptions: roadworks.
 * A road segment can close for a few simulated days; any line that used it
 * gets rerouted automatically. Passenger itineraries (routing.js) reference
 * lines and stops, not physical paths, so they stay valid across a reroute
 * with no changes needed there.
 */
import { routeLine, countComponents } from "./network.js";
import { vehicleMode } from "./vehicles.js";

export const ROADWORKS_DAILY_CHANCE = 0.15;
export const ROADWORKS_DURATION_DAYS_MIN = 2;
export const ROADWORKS_DURATION_DAYS_MAX = 5;

/** Recompute every line's route against the network's current topology
 * (open roads only). A line that becomes unreachable keeps its last known
 * route rather than being deleted — a legitimate, visible consequence of
 * the disruption rather than a crash.
 */
export function refreshAllLineRoutes(state, log) {
  for (const line of state.lines) {
    const routeNetwork = vehicleMode(line.mode).id === "metro" && state.undergroundNetwork
      ? state.undergroundNetwork : state.network;
    const newRoute = routeLine(routeNetwork, line.stopIds);
    if (!newRoute) {
      log(`${line.name} : plus aucun itinéraire disponible tant que les travaux durent.`);
      continue;
    }
    line.route = newRoute;
    for (const vehicleId of line.vehicles) {
      const vehicle = state.vehicles.find(v => v.id === vehicleId);
      // The new route can be shorter than the one a vehicle was mid-way
      // through; clamp it back onto the line rather than leaving it
      // indexing past the end of the new route.
      if (vehicle && vehicle.routeIndex >= newRoute.nodeIds.length) {
        vehicle.routeIndex = 0;
        vehicle.progress = 0;
      }
    }
  }
}

export function maybeStartRoadworks(state, rng, log) {
  // V9.0: scenario difficulty can scale how often roadworks occur (default 1).
  const chance = ROADWORKS_DAILY_CHANCE * (state.scenario?.roadworksChanceMultiplier ?? 1);
  if (rng() >= chance) return;
  const network = state.network;
  if (!network.closedEdgeIds) network.closedEdgeIds = new Set();
  if (!network.roadworksReopenDay) network.roadworksReopenDay = new Map();

  const openEdges = network.edges.filter(e => !network.closedEdgeIds.has(e.id));
  if (openEdges.length < 2) return;

  // Never let a closure fully sever the network into unreachable pieces —
  // tentatively close each candidate, starting at the random position, and
  // skip bridges. This keeps roadworks active even when the first random
  // edge happens to be the only connection to a district.
  const startIndex = Math.floor(rng() * openEdges.length);
  let edge = null;
  for (let offset = 0; offset < openEdges.length; offset++) {
    const candidate = openEdges[(startIndex + offset) % openEdges.length];
    network.closedEdgeIds.add(candidate.id);
    if (countComponents(network) === 1) {
      edge = candidate;
      break;
    }
    network.closedEdgeIds.delete(candidate.id);
  }
  if (!edge) return;

  const duration = ROADWORKS_DURATION_DAYS_MIN +
    Math.floor(rng() * (ROADWORKS_DURATION_DAYS_MAX - ROADWORKS_DURATION_DAYS_MIN + 1));
  network.roadworksReopenDay.set(edge.id, (state.elapsedDays || 0) + duration);
  network.pathCache.clear();

  const a = network.nodes.get(edge.a);
  const b = network.nodes.get(edge.b);
  log(`Travaux : route ${a?.name ?? edge.a} ↔ ${b?.name ?? edge.b} fermée pour ${duration} jour${duration > 1 ? "s" : ""}.`);
  refreshAllLineRoutes(state, log);
}

export function maybeEndRoadworks(state, log) {
  const network = state.network;
  if (!network.roadworksReopenDay?.size) return;

  let changed = false;
  for (const [edgeId, reopenDay] of network.roadworksReopenDay) {
    if ((state.elapsedDays || 0) >= reopenDay) {
      network.closedEdgeIds.delete(edgeId);
      network.roadworksReopenDay.delete(edgeId);
      changed = true;
    }
  }
  if (!changed) return;

  network.pathCache.clear();
  log("Travaux terminés : une route du réseau a rouvert.");
  refreshAllLineRoutes(state, log);
}
