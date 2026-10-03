/** V22.0 — network coverage: share of the population within walking
 * distance of a stop served by an active line (at least one vehicle).
 * Pure read of existing state, so the renderer and contracts can call it
 * freely; cities are small enough that no caching is needed.
 */
import { distance } from "./constants.js";

export const COVERAGE_RADIUS_PX = 220;

export function servedStopIds(state) {
  const served = new Set();
  for (const line of state?.lines || []) {
    if (!line.vehicles?.length) continue;
    for (const id of line.stopIds || []) served.add(id);
  }
  return served;
}

export function coverageRatio(state) {
  const stops = state?.city?.stops || [];
  if (!stops.length) return 0;
  const served = [...servedStopIds(state)].map(id => stops.find(s => s.id === id)).filter(Boolean);
  let covered = 0, total = 0;
  for (const stop of stops) {
    const pop = stop.population || 0;
    total += pop;
    if (served.some(s => s.id === stop.id || distance(s, stop) <= COVERAGE_RADIUS_PX)) covered += pop;
  }
  return total > 0 ? covered / total : 0;
}

export function coverageByDistrict(state) {
  const stops = state?.city?.stops || [];
  const served = [...servedStopIds(state)].map(id => stops.find(s => s.id === id)).filter(Boolean);
  const acc = {};
  for (const stop of stops) {
    const entry = acc[stop.districtId] || (acc[stop.districtId] = { covered: 0, total: 0, ratio: 0 });
    const pop = stop.population || 0;
    entry.total += pop;
    if (served.some(s => s.id === stop.id || distance(s, stop) <= COVERAGE_RADIUS_PX)) entry.covered += pop;
  }
  for (const entry of Object.values(acc)) entry.ratio = entry.total > 0 ? entry.covered / entry.total : 0;
  return acc;
}
