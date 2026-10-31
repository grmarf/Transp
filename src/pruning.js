/** V29.2 — Déssaimage automatique de la voirie.
 *
 * Module 100 % pur (importable en Node sans navigateur) :
 *  - pruneRedundantRoads(city) : retire les tronçons REDONDANTS — ceux dont
 *    le retrait ne déconnecte aucun arrêt (union-find sur les extrémités :
 *    les ponts ne sont jamais retirés). Les candidats sont priorisés par
 *    nombre de croisements générés, puis par longueur — on enlève d'abord
 *    ce qui encombre le plus la carte.
 *  - pruneOrphanCarrefourStops(city, protectedIds) : fait disparaître les
 *    arrêts de carrefour plus desservis par aucune voirie (orphelins après
 *    un déssaimage), sauf s'ils sont protégés (ligne, sélection en cours)
 *    ou chargés de passagers.
 *
 * Les voiries du joueur ne sont JAMAIS candidates : construites (built),
 * corridors, tracés libres (start/end sans a-b). Le déssaimage est
 * idempotent : un second passage ne trouve plus rien à retirer.
 */

import { computeCarrefours } from "./carrefours.js";
import { roadPoints } from "./network.js";

const ORPHAN_STOP_PROXIMITY = 16; // px — distance max à une voirie pour rester desservi

/** Composantes connexes des arrêts au travers des voiries a-b. */
function componentsCount(stopIds, roads) {
  const parent = new Map();
  for (const id of stopIds) parent.set(id, id);
  const find = function (id) {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(id) !== root) { const next = parent.get(id); parent.set(id, root); id = next; }
    return root;
  };
  const union = function (a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const road of roads) {
    if (road && road.a && road.b && parent.has(road.a) && parent.has(road.b)) union(road.a, road.b);
  }
  const roots = new Set();
  for (const id of stopIds) roots.add(find(id));
  return roots.size;
}

function roadLength(road, stopsById) {
  const a = stopsById.get(road.a), b = stopsById.get(road.b);
  return (a && b) ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}

/** Retire les tronçons redondants de city.roads (sur place).
 *  Retourne { removed, remaining } : voiries retirées / restantes. */
export function pruneRedundantRoads(city) {
  const stops = (city && city.stops) || [];
  const roads = (city && city.roads) || [];
  const stopIds = new Set(stops.map(s => s.id));
  const stopsById = new Map(stops.map(s => [s.id, s]));
  const candidates = [];
  const fixed = [];
  for (const road of roads) {
    // Candidate : voirie générée entre deux arrêts — jamais une voirie du
    // joueur (construite, corridor, tracé libre avec start/end).
    const isGenerated = road && road.a && road.b && stopIds.has(road.a) && stopIds.has(road.b)
      && road.built !== true && !road.corridorId && road.startStopId === undefined;
    (isGenerated ? candidates : fixed).push(road);
  }
  if (!candidates.length) return { removed: [], remaining: roads.length };
  // Priorité aux voiries qui créent le plus de croisements, puis aux longues.
  const crossings = new Map();
  for (const cross of computeCarrefours(city)) {
    crossings.set(cross.roadA, (crossings.get(cross.roadA) || 0) + 1);
    crossings.set(cross.roadB, (crossings.get(cross.roadB) || 0) + 1);
  }
  candidates.sort(function (r1, r2) {
    return ((crossings.get(r2) || 0) - (crossings.get(r1) || 0))
      || (roadLength(r2, stopsById) - roadLength(r1, stopsById));
  });
  const active = roads.slice();
  const reference = componentsCount(stopIds, roads);
  const removed = [];
  for (const candidate of candidates) {
    const without = active.filter(function (r) { return r !== candidate; });
    if (componentsCount(stopIds, without) === reference) {
      removed.push(candidate);
      active.length = 0;
      for (const r of without) active.push(r);
    }
  }
  city.roads = active;
  return { removed, remaining: active.length };
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Vrai si un point repose à proximité d'une polyline de voirie. */
function pointNearRoad(p, polylines) {
  for (const points of polylines) {
    for (let i = 0; i < points.length - 1; i++) {
      if (distanceToSegment(p, points[i], points[i + 1]) <= ORPHAN_STOP_PROXIMITY) return true;
    }
  }
  return false;
}

/** Retire les arrêts de carrefour orphelins (plus desservis par aucune
 *  voirie). Retourne la liste des arrêts retirés. */
export function pruneOrphanCarrefourStops(city, protectedIds) {
  const protectedSet = protectedIds instanceof Set ? protectedIds : new Set(protectedIds || []);
  const stops = (city && city.stops) || [];
  if (!stops.length) return [];
  const stopsById = new Map(stops.map(s => [s.id, s]));
  const polylines = ((city && city.roads) || [])
    .map(function (road) { return roadPoints(road, stopsById); })
    .filter(Boolean);
  const removed = [];
  city.stops = stops.filter(function (stop) {
    if (!/^carrefour-\d+$/.test(stop.id || "")) return true;
    if (protectedSet.has(stop.id)) return true;
    if ((stop.waiting || 0) > 0) return true;
    if (pointNearRoad(stop, polylines)) return true;
    removed.push(stop);
    return false;
  });
  return removed;
}

// === FIN DU FICHIER pruning.js ===
