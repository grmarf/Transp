/** Passenger routing — V14 intermodal routing. */

export const TRANSFER_PENALTY_HOPS = 3;

function buildLineAdjacency(line) {
  const stops = line.stopIds || [];
  const adj = new Map();
  if (stops.length < 2) return adj;
  for (let i = 0; i < stops.length; i++) {
    const reachable = [];
    for (let hops = 1; hops < stops.length; hops++) {
      reachable.push({ to: stops[(i + hops) % stops.length], hops });
    }
    adj.set(stops[i], reachable);
  }
  return adj;
}

/**
 * Returns an array of legs for backward compatibility. The array also carries
 * `.legs`, `.transfers` and `.totalHops`, so V14 callers can use route metrics
 * without breaking V2-V13 callers that expect route.length and route[i].
 */
export function findPassengerRoute(state, originId, destinationId) {
  if (originId === destinationId) return null;
  const lines = state.lines.filter(l => Array.isArray(l.stopIds) && l.stopIds.length >= 2);
  if (!lines.length) return null;
  const lineAdjs = lines.map(line => ({ line, adj: buildLineAdjacency(line) }));

  const startKey = `${originId}|@`;
  const dist = new Map([[startKey, 0]]);
  const prev = new Map();
  const queue = [startKey];
  const settled = new Set();
  let destinationKey = null;

  while (queue.length) {
    let min = 0;
    for (let i = 1; i < queue.length; i++) {
      if ((dist.get(queue[i]) ?? Infinity) < (dist.get(queue[min]) ?? Infinity)) min = i;
    }
    const key = queue.splice(min, 1)[0];
    if (settled.has(key)) continue;
    settled.add(key);
    const [current, arrivedLine] = key.split('|');
    if (current === destinationId) { destinationKey = key; break; }
    const currentDist = dist.get(key) ?? Infinity;

    for (const { line, adj } of lineAdjs) {
      for (const { to, hops } of (adj.get(current) || [])) {
        const transferCost = arrivedLine !== '@' && arrivedLine !== String(line.id)
          ? TRANSFER_PENALTY_HOPS : 0;
        const nextKey = `${to}|${line.id}`;
        const candidate = currentDist + hops + transferCost;
        if (candidate < (dist.get(nextKey) ?? Infinity)) {
          dist.set(nextKey, candidate);
          prev.set(nextKey, { key, lineId: line.id, from: current, to, hops });
          queue.push(nextKey);
        }
      }
    }
  }

  if (!destinationKey) return null;
  const legs = [];
  let cursor = destinationKey;
  let totalHops = 0;
  while (cursor !== startKey) {
    const step = prev.get(cursor);
    if (!step) return null;
    legs.unshift({ lineId: step.lineId, from: step.from, to: step.to });
    totalHops += step.hops;
    cursor = step.key;
  }

  const merged = [];
  for (const leg of legs) {
    const last = merged[merged.length - 1];
    if (last && last.lineId === leg.lineId && last.to === leg.from) last.to = leg.to;
    else merged.push({ ...leg });
  }
  // Array properties are ignored by JSON.stringify, so saves remain portable.
  merged.legs = merged;
  merged.transfers = Math.max(0, merged.length - 1);
  merged.totalHops = totalHops;
  return merged;
}

export function findPassengerRouteLegs(state, originId, destinationId) {
  return findPassengerRoute(state, originId, destinationId);
}

export function routeLegs(route) {
  return Array.isArray(route) ? route : (route?.legs || []);
}

export function routingStats(state) {
  let routablePairs = 0;
  let totalTransfers = 0;
  const stops = state.city.stops;
  for (const origin of stops) {
    for (const destination of stops) {
      if (origin.id === destination.id) continue;
      const route = findPassengerRoute(state, origin.id, destination.id);
      if (!route) continue;
      routablePairs++;
      totalTransfers += route.transfers || Math.max(0, route.length - 1);
    }
  }
  return {
    routablePairs,
    totalPairs: stops.length * (stops.length - 1),
    avgTransfers: routablePairs ? totalTransfers / routablePairs : 0
  };
}
