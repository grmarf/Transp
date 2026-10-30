/** V28 — Carrefours : croisements à 90°, patches visuels et arrêts de carrefour.
 *
 * Module 100 % pur (importable en Node sans navigateur) :
 *  - computeCarrefours(city) : croisements géométriques entre voiries ;
 *  - orthogonaliseRoads(city) : quand deux routes se croisent loin de
 *    l'angle droit, la route la plus récente est pliée en coude pour
 *    traverser l'autre à 90° — un vrai carrefour se forme ;
 *  - placeCarrefourStops(city, rng) : un arrêt supplémentaire est posé sur
 *    chaque carrefour (jamais sur une voie rapide), raccordé au réseau par
 *    la fusion de jonction de network.js (nœud à la même position).
 *
 * Les routes sans `points` (voiries d'arrêt à arrêt générées par la ville)
 * reçoivent une polyline en coude ; le rendu et le réseau suivent alors
 * exactement cette géométrie (patron V27 des arêtes-polylignes).
 */

import { roadPoints } from "./network.js";
import { DISTRICT_AREA_KM2 } from "./city.js";

export const CARREFOUR_ARM = 22;          // longueur (px) des branches perpendiculaires
export const RIGHT_ANGLE_TOLERANCE = 12;  // écart maximal (degrés) à 90° sans redressement
export const CARREFOUR_STOP_MIN_GAP = 48; // distance minimale à un autre arrêt
export const CARREFOUR_STOP_MAX = 10;     // plafond d'arrêts de carrefour par ville

const CARREFOUR_NAMES = [
  "Carrefour du Marché", "Carrefour des Écoles", "Carrefour de la Mairie",
  "Carrefour Saint-Michel", "Carrefour des Tilleuls", "Carrefour de la Gare",
  "Carrefour du Moulin", "Carrefour des Platanes", "Carrefour de la Poste",
  "Carrefur des Acacias", "Carrefour du Pont", "Carrefour Bellecour"
];

/** Intersection stricte de deux segments, intérieure aux deux (t, u ∈ ]0.02, 0.98[). */
export function segmentCross(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denominator = d1x * d2y - d1y * d2x;
  if (Math.abs(denominator) < 1e-12) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denominator;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denominator;
  if (t <= 0.02 || t >= 0.98 || u <= 0.02 || u >= 0.98) return null;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y, t, u };
}

/** Angle non orienté (0–90°) entre deux directions. */
function acuteAngle(d1x, d1y, d2x, d2y) {
  const dot = d1x * d2x + d1y * d2y;
  const n1 = Math.hypot(d1x, d1y) || 1;
  const n2 = Math.hypot(d2x, d2y) || 1;
  const deg = Math.acos(Math.max(-1, Math.min(1, dot / (n1 * n2)))) * 180 / Math.PI;
  return deg > 90 ? 180 - deg : deg;
}

/** Vrai si le point p repose sur l'intérieur du segment [a, b]. */
function pointOnSegmentInterior(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy || 1;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  if (t < 0.02 || t > 0.98) return false;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) < 0.75;
}

/** Tous les croisements entre voiries : [{ x, y, angle, roadA, roadB }].
 *  `angle` est l'angle aigu entre les deux voiries : 90 = déjà
 *  perpendiculaire, en dessous de (90 - RIGHT_ANGLE_TOLERANCE) = à redresser. */
export function computeCarrefours(city) {
  const stopsById = new Map((city.stops || []).map(s => [s.id, s]));
  const roads = (city.roads || [])
    .map(road => ({ road, points: roadPoints(road, stopsById) }))
    .filter(entry => entry.points);
  const out = [];
  for (let i = 0; i < roads.length; i++) {
    for (let j = i + 1; j < roads.length; j++) {
      const a = roads[i], b = roads[j];
      for (let si = 0; si < a.points.length - 1; si++) {
        for (let sj = 0; sj < b.points.length - 1; sj++) {
          const hit = segmentCross(a.points[si], a.points[si + 1], b.points[sj], b.points[sj + 1]);
          if (!hit) continue;
          // route plus ancienne = référence ; la plus récente se plie.
          const angle = acuteAngle(
            a.points[si + 1].x - a.points[si].x, a.points[si + 1].y - a.points[si].y,
            b.points[sj + 1].x - b.points[sj].x, b.points[sj + 1].y - b.points[sj].y);
          out.push({ x: hit.x, y: hit.y, angle, roadA: a.road, roadB: b.road });
        }
      }
    }
  }
  // V28 — un sommet de polyline posé sur l'intérieur d'une autre voirie
  // (le coude à 90° fraîchement plié, ou un accolement) est un carrefour :
  // le croisement segment × segment ne le voit plus une fois plié.
  for (let i = 0; i < roads.length; i++) {
    for (let j = 0; j < roads.length; j++) {
      if (i === j) continue;
      const host = roads[i], guest = roads[j];
      for (let k = 1; k < guest.points.length - 1; k++) {
        const v = guest.points[k];
        for (let s = 0; s < host.points.length - 1; s++) {
          if (!pointOnSegmentInterior(v, host.points[s], host.points[s + 1])) continue;
          const duplicate = out.some(c => Math.hypot(c.x - v.x, c.y - v.y) < 1 &&
            ((c.roadA === host.road && c.roadB === guest.road) ||
             (c.roadA === guest.road && c.roadB === host.road)));
          if (duplicate) continue;
          const next = guest.points[k + 1];
          const dir = { x: next.x - v.x, y: next.y - v.y };
          const angle = acuteAngle(
            host.points[s + 1].x - host.points[s].x, host.points[s + 1].y - host.points[s].y,
            dir.x, dir.y);
          out.push({ x: v.x, y: v.y, angle, roadA: host.road, roadB: guest.road });
        }
      }
    }
  }
  return out;
}

/** Plie `road` pour qu'elle traverse le carrefour `c` à 90°.
 *  Retourne la liste des nouveaux sous-segments créés (à vérifier par
 *  l'appelant, p.ex. collision bâtiment), ou null si le pli est impossible. */
export function bendRoadAtCarrefour(city, c) {
  const stopsById = new Map((city.stops || []).map(s => [s.id, s]));
  const oldPoints = roadPoints(c.roadA, stopsById);
  if (!oldPoints) return null;
  // Direction de la voirie de référence au point de croisement : celle du
  // segment qui contient le point c.
  let dir = null;
  {
    let best = Infinity;
    for (let i = 0; i < oldPoints.length - 1; i++) {
      const a = oldPoints[i], b = oldPoints[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / lenSq));
      const px = a.x + t * dx, py = a.y + t * dy;
      const d = Math.hypot(c.x - px, c.y - py);
      if (d < best) { best = d; dir = { x: dx / Math.sqrt(lenSq), y: dy / Math.sqrt(lenSq) }; }
    }
  }
  if (!dir) return null;
  const nx = -dir.y, ny = dir.x; // normale unitaire → direction de traversée à 90°

  const points = roadPoints(c.roadB, stopsById);
  if (!points || points.length < 2) return null;
  // Segment de la route pliée qui contient le croisement.
  let k = -1;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / lenSq));
    const px = a.x + t * dx, py = a.y + t * dy;
    if (Math.hypot(c.x - px, c.y - py) < 1 && t > 0.02 && t < 0.98) { k = i; break; }
  }
  if (k < 0) return null;
  const segLen = Math.hypot(points[k + 1].x - points[k].x, points[k + 1].y - points[k].y);
  const arm = Math.min(CARREFOUR_ARM, segLen * 0.3);
  if (arm < 4) return null;
  // Oriente les bras : `before` du côté du point précédent, `after` du suivant.
  const toPrev = { x: points[k].x - c.x, y: points[k].y - c.y };
  let before = { x: c.x + nx * arm, y: c.y + ny * arm };
  let after = { x: c.x - nx * arm, y: c.y - ny * arm };
  if (toPrev.x * nx + toPrev.y * ny < 0) {
    const tmp = before; before = after; after = tmp;
  }
  const newPoints = points.slice(0, k + 1)
    .concat([before, { x: c.x, y: c.y }, after])
    .concat(points.slice(k + 1));
  const added = [
    { a: points[k], b: before },
    { a: before, b: { x: c.x, y: c.y } },
    { a: { x: c.x, y: c.y }, b: after },
    { a: after, b: points[k + 1] }
  ];
  c.roadB.points = newPoints;
  return added;
}

/** Redresse tous les croisements de la ville en carrefours à 90°.
 *  `isBlocked(a, b)` (optionnel) peut refuser un sous-segment du pli —
 *  le pli est alors annulé (retour à la géométrie d'origine).
 *  Retourne le nombre de carrefours redressés. */
export function orthogonaliseRoads(city, isBlocked = null) {
  let bends = 0;
  const done = new Set();
  for (let pass = 0; pass < 6; pass++) {
    let acted = false;
    for (const c of computeCarrefours(city)) {
      const key = (c.roadA.id || "?") + "|" + (c.roadB.id || "?") + "|" +
        Math.round(c.x) + "," + Math.round(c.y);
      if (done.has(key)) continue;
      done.add(key);
      if (c.angle >= 90 - RIGHT_ANGLE_TOLERANCE) continue; // déjà ~perpendiculaire
      const backup = c.roadB.points ? c.roadB.points.slice() : null;
      const added = bendRoadAtCarrefour(city, c);
      if (!added) continue;
      if (isBlocked && added.some(seg => isBlocked(seg.a, seg.b))) {
        c.roadB.points = backup || undefined; // annule le pli
        continue;
      }
      bends += 1;
      acted = true;
    }
    if (!acted) break;
  }
  return bends;
}

/** Id du prochain arrêt de carrefour (persistance comprise). */
function nextCarrefourNumber(city) {
  let max = 0;
  for (const stop of city.stops || []) {
    const m = /^carrefour-(\d+)$/.exec(stop.id || "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Pose un arrêt de carrefour en (x, y) — position exacte du croisement
 *  pour que network.js fusionne la jonction dans ce nœud (patron near()). */
export function addCarrefourStop(city, x, y, rng = Math.random) {
  const stops = city.stops || (city.stops = []);
  let nearest = null;
  for (const stop of stops) {
    if (!nearest || Math.hypot(stop.x - x, stop.y - y) < Math.hypot(nearest.x - x, nearest.y - y)) nearest = stop;
  }
  const n = nextCarrefourNumber(city);
  const population = Math.round(150 + rng() * 350);
  const jobs = Math.round(80 + rng() * 200);
  const stop = {
    id: `carrefour-${n}`,
    name: CARREFOUR_NAMES[(n - 1) % CARREFOUR_NAMES.length],
    x, y,
    demand: 0.4,
    waiting: 0,
    waitingByDestination: {},
    districtId: nearest ? nearest.districtId : "district-1",
    population,
    jobs,
    commerce: Math.round(60 + rng() * 120),
    density: Math.round(population / DISTRICT_AREA_KM2),
    hasSpawnedSatellite: true, // un carrefour n'essime pas de nouveau quartier
    isCarrefour: true
  };
  stops.push(stop);
  return stop;
}

/** Vrai si un carrefour peut recevoir un arrêt (voirie desservable, place). */
function carrefourCanHostStop(city, c, count) {
  if (count >= CARREFOUR_STOP_MAX) return false;
  // Un carrefour est un nœud de traversée, pas un arrêt de tronçon : seule
  // la voie rapide (pas de desserte) est exclue.
  if ((c.roadA.type === "highway") || (c.roadB.type === "highway")) return false;
  for (const stop of city.stops || []) {
    if (Math.hypot(stop.x - c.x, stop.y - c.y) < CARREFOUR_STOP_MIN_GAP) return false;
  }
  return true;
}

/** Aménage la ville : carrefours à 90° puis un arrêt par carrefour.
 *  À appeler après createCity (partie neuve) ou après le commit d'une voirie
 *  joueur (opts.road limite alors le traitement à cette seule route).
 *  Retourne { bends, stops } — les nombres d'aménagements réalisés. */
export function developCityCarrefours(city, rng = Math.random, opts = {}, isBlocked = null, log = () => {}) {
  const only = opts.road || null;
  const isBlockedAll = isBlocked;
  let bends = 0;
  if (only) {
    // Ne plie que la voirie joueur fraîchement posée face au reste de la ville.
    const stopsById = new Map((city.stops || []).map(s => [s.id, s]));
    const backup = only.points ? only.points.slice() : null;
    const crossings = computeCarrefours(city).filter(c => c.roadB === only || c.roadA === only);
    for (const c of crossings) {
      if (c.roadB !== only) continue; // seule la route la plus récente se plie
      if (c.angle < 90 - RIGHT_ANGLE_TOLERANCE) {
        const added = bendRoadAtCarrefour(city, c);
        if (added && isBlockedAll && added.some(seg => isBlockedAll(seg.a, seg.b))) {
          // Un pli bloqué annule toute la retouche : le tracé joueur reste tel quel.
          if (backup) only.points = backup; else delete only.points;
          bends = 0;
          break;
        } else if (added) bends += 1;
      }
    }
  } else {
    bends = orthogonaliseRoads(city, isBlockedAll);
  }
  // Arrêts de carrefour, une fois la géométrie stabilisée.
  let count = (city.stops || []).filter(s => /^carrefour-\d+$/.test(s.id || "")).length;
  let stops = 0;
  for (const c of computeCarrefours(city)) {
    if (only && c.roadA !== only && c.roadB !== only) continue;
    if (!carrefourCanHostStop(city, c, count)) continue;
    const stop = addCarrefourStop(city, c.x, c.y, rng);
    count += 1;
    stops += 1;
    log(`Carrefour aménagé à 90° : nouvel arrêt « ${stop.name} ».`);
  }
  return { bends, stops };
}

// === FIN DU FICHIER carrefours.js ===
