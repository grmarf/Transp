/** V2.5 — passenger routing
 * Builds passenger itineraries from the currently active transport lines.
 * The road network still determines how vehicles move; this module only
 * decides which transport lines a passenger should use.
 */

export function findPassengerRoute(state, originId, destinationId) {
  if (originId === destinationId) return [];
  const lines = state.lines.filter(l => Array.isArray(l.stopIds) && l.stopIds.length >= 2);
  if (!lines.length) return null;

  const queue = [{ stopId: originId, legs: [], visited: new Set([originId]) }];
  let best = null;

  while (queue.length) {
    const current = queue.shift();
    if (best && current.legs.length >= best.length) continue;

    for (const line of lines) {
      const start = line.stopIds.indexOf(current.stopId);
      if (start < 0) continue;

      for (let step = 1; step < line.stopIds.length; step++) {
        const stopId = line.stopIds[(start + step) % line.stopIds.length];
        const legs = [...current.legs, { lineId: line.id, from: current.stopId, to: stopId }];
        if (stopId === destinationId) {
          if (!best || compareRoutes(legs, best) < 0) best = legs;
          continue;
        }
        if (legs.length >= 5 || current.visited.has(stopId)) continue;
        const visited = new Set(current.visited);
        visited.add(stopId);
        queue.push({ stopId, legs, visited });
      }
    }
  }

  return best;
}

function compareRoutes(a, b) {
  if (a.length !== b.length) return a.length - b.length;
  const aTransfers = Math.max(0, a.length - 1);
  const bTransfers = Math.max(0, b.length - 1);
  return aTransfers - bTransfers;
}

export function routingStats(state) {
  let routablePairs = 0;
  const stops = state.city.stops;
  for (const origin of stops) {
    for (const destination of stops) {
      if (origin.id === destination.id) continue;
      if (findPassengerRoute(state, origin.id, destination.id)) routablePairs++;
    }
  }
  return { routablePairs, totalPairs: stops.length * (stops.length - 1) };
}
