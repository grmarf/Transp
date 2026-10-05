/** V6.0 — Urban evolution.
 * The one causal link the whole plan has been building toward: how well a
 * stop is served by the transport network feeds back into how fast its
 * population/jobs/commerce grow — and, past a threshold, into whether the
 * city itself expands with a new district.
 */
import { DISTRICT_AREA_KM2, addSatelliteStop } from "./city.js";
import { addNetworkNode, createUndergroundNetwork } from "./network.js";
import { lineHeadwayMinutes } from "./vehicles.js";

// Daily growth rates (this runs once per simulated day, not per tick).
export const GROWTH_RATE_SERVED = 0.006;   // +0.6%/day for a well-served stop
export const GROWTH_RATE_UNSERVED = 0.0005; // background growth even with no transit access
export const SATELLITE_POP_THRESHOLD = 4000;
export const SATELLITE_SERVICE_LEVEL = 0.4;

/** 0 (no service) to 1 (very frequent service) for one stop.
 * Calibrated against this engine's actual headway scale, not an idealized
 * real-world one: with the vehicle speed used since V2.7, a single-vehicle
 * line already has a headway in the thousands of minutes (confirmed by the
 * V3.0 test fixture, ~18 400 min for one vehicle on a 3-stop line) — a
 * "30 min = full service" assumption would be unreachable in actual play.
 * A cheap 2nd/3rd vehicle (V3.0's buyVehicleForLine) already roughly halves
 * or thirds that headway, so the falloff below treats a headway near 0 as
 * excellent and one at/above ~20 000 (worse than a lone, slow vehicle) as
 * effectively no service.
 */
export function serviceLevel(state, stop) {
  const lines = state.lines.filter(l => l.stopIds.includes(stop.id));
  if (!lines.length) return 0;

  const headways = lines.map(l => lineHeadwayMinutes(state, l)).filter(Boolean);
  if (!headways.length) return 0.3; // served, but headway not computable yet (e.g. vehicle stalled)

  const bestHeadway = Math.min(...headways);
  return Math.max(0, Math.min(1, 1 - bestHeadway / 20000));
}

function growStop(state, stop) {
  const level = serviceLevel(state, stop);
  const rate = (GROWTH_RATE_UNSERVED + level * (GROWTH_RATE_SERVED - GROWTH_RATE_UNSERVED)) *
    (state.scenario?.growthRateMultiplier ?? 1); // V9.0: scenario difficulty
  stop.population *= 1 + rate;
  stop.jobs *= 1 + rate * 0.8;
  stop.commerce *= 1 + rate * 0.9;
  stop.density = Math.round(stop.population / DISTRICT_AREA_KM2);
  return level;
}

function maybeSpawnSatellite(state, rng, log, levels) {
  // La croissance urbaine est autonome : le service accélère l’essor mais ne
  // bloque plus l’extension. Un seul quartier par jour garde une pression
  // lisible pour le joueur et évite une explosion artificielle de la carte.
  const candidates = state.city.stops
    .filter(s => s.population >= SATELLITE_POP_THRESHOLD)
    .map(stop => ({
      stop,
      // Une zone dont le voisinage est déjà dense est moins intéressante
      // qu’un front urbain : on développe donc d’abord la périphérie.
      frontier: Math.min(...state.city.stops
        .filter(other => other.id !== stop.id)
        .map(other => Math.hypot(stop.x - other.x, stop.y - other.y)))
    }))
    .sort((a, b) => b.frontier - a.frontier || b.stop.population - a.stop.population);
  const candidate = candidates[0]?.stop;
  if (!candidate) return;
  const service = levels.get(candidate.id) || 0;

  const newStop = addSatelliteStop(state.city, candidate, rng);
  addNetworkNode(state.network, newStop.id, newStop.x, newStop.y, candidate.id);
  // V13.0: the underground network is a complete graph over every stop, so
  // a new stop needs a fresh rebuild (cheap at this scale) rather than an
  // incremental patch — regenerating it here keeps metro tunnels reachable
  // to newly spawned districts too.
  if (state.undergroundNetwork) state.undergroundNetwork = createUndergroundNetwork(state.city);
  // Le développement est volontairement sans plafond : les quartiers
  // peuvent continuer à essaimer et chaque nouvelle route est ajoutée au
  // réseau, puis révélée par l’animation de tracé du renderer.
  candidate.hasSpawnedSatellite = true;
  log(`Nouveau quartier : ${newStop.name}, raccordé à ${candidate.name} (service ${Math.round(service * 100)} %, extension autonome).`);
}

/** Run once per simulated day. */
export function growCity(state, rng, log) {
  const levels = new Map();
  for (const stop of state.city.stops) {
    levels.set(stop.id, growStop(state, stop));
  }
  maybeSpawnSatellite(state, rng, log, levels);
}
