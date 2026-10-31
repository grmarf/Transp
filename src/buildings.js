/** V27 — Bâtiments : modèle, zonage, valeur foncière, croissance et déclin.
 *
 * Module 100 % pur (importable en Node sans navigateur) :
 *  - state.city.zones : rectangles peints par le joueur le long des routes ;
 *  - state.city.buildings : bâtiments émergents (résidentiel, commercial,
 *    bureaux, industriel, services, loisirs) avec densité low/mid/high ;
 *  - state.city.landValueGrid : grille de valeur foncière recalculée à
 *    chaque heure simulée (accès route / services / transport, moins
 *    pollution et nuisance) ;
 *  - updateBuildings() : croissances calibrées (~1 bâtiment par zone toutes
 *    les 2–4 h simulées), montée en densité, abandon, démolition auto.
 *
 * Le système est opt-in via state.buildingsEnabled (patron V22 des modules
 * démographics/events) : tous les tests antérieurs restent inchangés.
 */

import { distance } from "./constants.js";
import { ROAD_TYPES } from "./network.js";

export const BUILDING_TYPES = Object.freeze({
  residential: {
    id: "residential", label: "Résidentiel", icon: "🏠", zoneType: "residential",
    residents: { low: 20, mid: 100, high: 400 }, jobs: { low: 0, mid: 0, high: 0 }
  },
  commercial: {
    id: "commercial", label: "Commercial", icon: "🏪", zoneType: "commercial",
    residents: { low: 0, mid: 0, high: 0 }, jobs: { low: 30, mid: 150, high: 600 }
  },
  office: {
    id: "office", label: "Bureaux", icon: "🏢", zoneType: "commercial", // émerge dans les zones commerciales à haute valeur
    residents: { low: 0, mid: 0, high: 0 }, jobs: { low: 50, mid: 250, high: 1000 }
  },
  industrial: {
    id: "industrial", label: "Industriel", icon: "🏭", zoneType: "industrial",
    residents: { low: 0, mid: 0, high: 0 }, jobs: { low: 40, mid: 200, high: 800 }, pollutes: true
  },
  service: {
    id: "service", label: "Services", icon: "🏫", zoneType: "service",
    residents: { low: 0, mid: 0, high: 0 }, jobs: { low: 20, mid: 20, high: 20 }
  },
  leisure: {
    id: "leisure", label: "Loisirs", icon: "🎭", zoneType: "service",
    residents: { low: 0, mid: 0, high: 0 }, jobs: { low: 10, mid: 10, high: 10 }
  }
});

export const ZONE_TYPES = Object.freeze({
  residential: { id: "residential", label: "Résidentiel", color: "rgba(88, 178, 116, .35)" },
  commercial: { id: "commercial", label: "Commercial", color: "rgba(64, 145, 223, .35)" },
  industrial: { id: "industrial", label: "Industriel", color: "rgba(240, 173, 63, .35)" },
  service: { id: "service", label: "Services", color: "rgba(186, 104, 200, .35)" }
});

export const DENSITIES = Object.freeze({ low: "low", mid: "mid", high: "high" });

// Calibrage — la lisibilité prime : pas d'explosion de bâtiments en 30 s.
export const LAND_VALUE_CELL = 32;          // px par cellule de grille
export const ZONE_ROAD_ADJACENCY_PX = 4;   // une zone colle une voirie (spec)
export const GROWTH_MIN_HOURS = 2;          // 1 bâtiment / zone / 2–4 h simulées
export const GROWTH_MAX_HOURS = 4;
export const GROWTH_LAND_VALUE_MIN = 0.25;
export const ABANDON_LAND_VALUE = 0.15;
export const ABANDON_OCCUPANTS = 0.2;
export const ABANDON_GRACE_HOURS = 24;      // occupants bas depuis 24 h → abandon
export const AUTO_DEMOLISH_HOURS = 168;     // abandonné depuis 7 jours → disparaît
export const UPGRADE_OCCUPANTS = 0.9;
export const UPGRADE_LAND_VALUE = 0.6;
const BUILDING_FOOTPRINTS = { low: { w: 18, h: 18 }, mid: { w: 26, h: 26 }, high: { w: 38, h: 38 } };

// V28 — anti-superposition : un bâtiment ne chevauche jamais ni un voisin
// ni l'enrobé d'une voirie. Nombre de tirages de placement par émergence.
const PLACEMENT_ATTEMPTS = 16;
const BUILDING_GAP_PX = 2;      // gabarit minimal entre deux bâtiments
const ROAD_MARGIN_PX = 0.5;     // demi-épaisseur d'enrobé + liseré de sécurité

/** Bruit déterministe : décorrèle les tirages même avec un rng constant. */
function hash01(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Chevauchement de deux rectangles { x, y, w, h }, marge comprise. */
export function rectsOverlap(a, b, margin = 0) {
  return a.x - margin < b.x + b.w && a.x + a.w + margin > b.x &&
         a.y - margin < b.y + b.h && a.y + a.h + margin > b.y;
}

/** Vrai si le rectangle garde ses distances avec toute la voirie :
 *  aucun segment ne pénètre son gabarit (demi-épaisseur + liseré). */
export function rectClearOfRoads(state, rect) {
  for (const seg of roadSegments(state.city)) {
    const half = ((ROAD_TYPES[seg.road.type] || {}).width || 8) / 2 + ROAD_MARGIN_PX;
    if (segmentIntersectsRect(seg.a, seg.b, {
      x: rect.x - half, y: rect.y - half, w: rect.w + 2 * half, h: rect.h + 2 * half
    })) return false;
  }
  return true;
}

/** Placement sans chevauchement : bâtiments et voirie exclus du gabarit.
 *  Renvoie { x, y } ou null après PLACEMENT_ATTEMPTS tirages infructueux. */
function findClearSpot(state, zone, footprint, rng) {
  const margin = 4;
  const usableW = Math.max(1, zone.w - footprint.w - 2 * margin);
  const usableH = Math.max(1, zone.h - footprint.h - 2 * margin);
  const city = state.city;
  const fits = function (x, y) {
    const candidate = { x: Math.round(x), y: Math.round(y), w: footprint.w, h: footprint.h };
    if (candidate.x < zone.x || candidate.y < zone.y ||
        candidate.x + candidate.w > zone.x + zone.w ||
        candidate.h + candidate.y > zone.y + zone.h) return null;
    if (!rectClearOfRoads(state, candidate)) return null;
    if ((city.buildings || []).some(b => !b.demolished && rectsOverlap(candidate, b, BUILDING_GAP_PX))) return null;
    return { x: candidate.x, y: candidate.y };
  };
  // V28.1 — premier essai déterministe au coin de la zone : les bâtiments
  // alignent le front de rue et le reste de la zone reste disponible pour
  // un voisin (un unique bâtiment centré stérilisait les petites zones).
  const corner = fits(zone.x + margin, zone.y + margin);
  if (corner) return corner;
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
    const jx = attempt === 0 ? 0 : hash01(zone.x + zone.w * attempt * 7.3 + zone.createdAtHour);
    const jy = attempt === 0 ? 0 : hash01(zone.y + zone.h * attempt * 3.1 + zone.id.length * 17);
    const found = fits(zone.x + margin + ((rng() + jx) % 1) * usableW,
                       zone.y + margin + ((rng() + jy) % 1) * usableH);
    if (found) return found;
  }
  // V28.1 — balayage de dernier recours : si une place nette existe dans la
  // zone, elle est trouvée (le seul tirage aléatoire pouvait la manquer).
  for (let ys = 0; ys <= usableH; ys += 3) {
    for (let xs = 0; xs <= usableW; xs += 3) {
      const found = fits(zone.x + margin + xs, zone.y + margin + ys);
      if (found) return found;
    }
  }
  return null;
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

/** Distance point → segment [a,b]. */
export function pointToSegmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Tous les segments [p_i, p_i+1] des voiries de la ville. */
function roadSegments(city) {
  const stopsById = new Map((city.stops || []).map(s => [s.id, s]));
  const segments = [];
  for (const road of city.roads || []) {
    const pts = road.points && road.points.length >= 2
      ? road.points
      : normalisedRoadPoints(road, stopsById);
    if (!pts) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      segments.push({ a: pts[i], b: pts[i + 1], road });
    }
  }
  return segments;
}

function normalisedRoadPoints(road, stopsById) {
  const a = road.a && stopsById.get(road.a);
  const b = road.b && stopsById.get(road.b);
  if (a && b) return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
  if (road.start && road.end) return [road.start, road.end];
  return null;
}

/** Initialisation paresseuse (compat sauvegardes et tests antérieurs). */
export function ensureBuildingsState(state) {
  const city = state.city;
  if (!Array.isArray(city.zones)) city.zones = [];
  if (!Array.isArray(city.buildings)) city.buildings = [];
  if (!Number.isInteger(city.nextZoneId)) city.nextZoneId = 1;
  if (!Number.isInteger(city.nextBuildingId)) city.nextBuildingId = 1;
  // Une grille de valeur foncière rechargée depuis du JSON n'est plus un
  // tableau typé : on la jette, le prochain cycle horaire la reconstruit.
  const grid = city.landValueGrid;
  if (grid && (!grid.values || typeof grid.values.length !== "number" || !Number.isInteger(grid.cols))) {
    city.landValueGrid = null;
  }
  return state;
}

/** Distance minimale entre un rectangle (zone) et une voirie. */
export function zoneToRoadDistance(state, zone) {
  const corners = [
    { x: zone.x, y: zone.y }, { x: zone.x + zone.w, y: zone.y },
    { x: zone.x + zone.w, y: zone.y + zone.h }, { x: zone.x, y: zone.y + zone.h }
  ];
  const center = { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 };
  let best = Infinity;
  for (const segment of roadSegments(state.city)) {
    for (const point of corners) {
      best = Math.min(best, pointToSegmentDistance(point, segment.a, segment.b));
    }
    best = Math.min(best, pointToSegmentDistance(center, segment.a, segment.b));
    // Un segment peut traverser la zone elle-même.
    for (let t = 0.1; t < 1; t += 0.1) {
      const p = { x: segment.a.x + (segment.b.x - segment.a.x) * t, y: segment.a.y + (segment.b.y - segment.a.y) * t };
      if (p.x >= zone.x && p.x <= zone.x + zone.w && p.y >= zone.y && p.y <= zone.y + zone.h) return 0;
    }
  }
  return best;
}

/** Zonage : la zone doit longer une voirie (≤ ZONE_ROAD_ADJACENCY_PX). */
export function addZone(state, type, x, y, w, h, log = () => {}) {
  ensureBuildingsState(state);
  if (!ZONE_TYPES[type]) { log("Type de zone inconnu."); return null; }
  if (w < 12 || h < 12) { log("Zone trop petite."); return null; }
  const zone = { id: `zone-${state.city.nextZoneId++}`, type, x, y, w, h, createdAtHour: currentHour(state) };
  if (zoneToRoadDistance(state, zone) > ZONE_ROAD_ADJACENCY_PX) {
    state.city.nextZoneId--; // l'id n'est pas consommé
    log("Une zone ne peut exister qu'en bordure d'une route.");
    return null;
  }
  state.city.zones.push(zone);
  return zone;
}

export function removeZone(state, zoneId) {
  ensureBuildingsState(state);
  const before = state.city.zones.length;
  state.city.zones = state.city.zones.filter(z => z.id !== zoneId);
  // Les bâtiments existants restent (dézonage ≠ démolition).
  return before !== state.city.zones.length;
}

function currentHour(state) {
  return (state.elapsedDays || 0) * 24 + Math.floor((state.time || 0) / 60);
}

/** Grille de valeur foncière : base + accès, moins nuisances, normalisée 0–1. */
export function computeLandValueGrid(state) {
  ensureBuildingsState(state);
  const city = state.city;
  const cell = LAND_VALUE_CELL;
  const cols = Math.max(1, Math.ceil((city.width || 1000) / cell));
  const rows = Math.max(1, Math.ceil((city.height || 650) / cell));
  const segments = roadSegments(city);
  const services = (city.buildings || []).filter(b => b.type === "service" || b.type === "leisure");
  const industries = (city.buildings || []).filter(b => b.type === "industrial");
  const noisyRoads = (city.roads || []).filter(r => r.type === "highway" || r.type === "boulevard");
  const stops = city.stops || [];
  const values = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = { x: (c + 0.5) * cell, y: (r + 0.5) * cell };
      let v = 0.35;
      let roadD = Infinity, stopD = Infinity, serviceD = Infinity, industryD = Infinity, noiseD = Infinity;
      for (const s of segments) roadD = Math.min(roadD, pointToSegmentDistance(p, s.a, s.b));
      for (const stop of stops) stopD = Math.min(stopD, distance(p, stop));
      for (const b of services) serviceD = Math.min(serviceD, Math.hypot(p.x - b.x, p.y - b.y));
      for (const b of industries) industryD = Math.min(industryD, Math.hypot(p.x - b.x, p.y - b.y));
      for (const road of noisyRoads) {
        const pts = road.points && road.points.length >= 2 ? road.points : null;
        if (!pts) continue;
        for (let i = 0; i < pts.length - 1; i++) noiseD = Math.min(noiseD, pointToSegmentDistance(p, pts[i], pts[i + 1]));
      }
      v += 0.25 * proximity(roadD, 120);      // roadAccess
      v += 0.15 * proximity(serviceD, 200);    // serviceAccess
      v += 0.20 * proximity(stopD, 150);       // transitAccess
      v -= 0.20 * proximity(industryD, 180);   // pollution
      v -= 0.15 * proximity(noiseD, 90);       // nuisance voirie majeure
      values[r * cols + c] = clamp01(v);
    }
  }
  city.landValueGrid = { cell, cols, rows, values };
  return city.landValueGrid;
}

function proximity(d, range) {
  if (!Number.isFinite(d)) return 0;
  return clamp01(1 - d / range);
}

/** Échantillonnage de la valeur foncière (cellule englobante). */
export function landValueAt(state, x, y) {
  const grid = state.city.landValueGrid;
  if (!grid || !grid.values) return 0.5;
  const c = Math.max(0, Math.min(grid.cols - 1, Math.floor(x / grid.cell)));
  const r = Math.max(0, Math.min(grid.rows - 1, Math.floor(y / grid.cell)));
  return grid.values[r * grid.cols + c];
}

/** Demande par type de zone, 0–1 (indicateur HUD et condition de croissance). */
export function zoneDemand(state, type) {
  ensureBuildingsState(state);
  const buildings = state.city.buildings;
  const total = (t) => buildings.filter(b => b.type === t && !b.abandoned);
  let residents = 0, jobs = 0;
  for (const b of buildings) {
    if (b.abandoned) continue;
    residents += b.residents || 0;
    jobs += b.jobs || 0;
  }
  if (type === "residential") return clamp01(1 - residents / (jobs * 1.2 + 250));
  if (type === "commercial") return clamp01(1 - (total("commercial").length + total("office").length) / (residents / 300 + 3));
  if (type === "industrial") return clamp01(1 - total("industrial").length / (residents / 400 + 2));
  if (type === "service") return clamp01(1 - (total("service").length + total("leisure").length) / (residents / 500 + 2));
  return 0;
}

function densityForLandValue(landValue) {
  if (landValue >= 0.7) return "high";
  if (landValue >= 0.45) return "mid";
  return "low";
}

/** Type de bâtiment émergent dans une zone donnée. */
function emergingType(zone, landValue, rng) {
  if (zone.type === "residential") return "residential";
  if (zone.type === "industrial") return "industrial";
  if (zone.type === "service") return rng() < 0.75 ? "service" : "leisure";
  // Zone commerciale : des bureaux émergent sur les terrains à haute valeur.
  if (zone.type === "commercial") return landValue > 0.55 && rng() < 0.45 ? "office" : "commercial";
  return "commercial";
}

/** Fait émerger un bâtiment dans la zone ; null si la zone est saturée. */
function spawnBuilding(state, zone, hour, rng) {
  const city = state.city;
  const landValue = landValueAt(state, zone.x + zone.w / 2, zone.y + zone.h / 2);
  let density = densityForLandValue(landValue);
  const margin = 4;
  // Saturation : au plus ~1 bâtiment par 26×26 px de zone.
  const inZone = city.buildings.filter(b => b.zoneId === zone.id && !b.abandoned).length;
  if (inZone >= Math.max(1, Math.floor((zone.w * zone.h) / (26 * 26)))) return null;
  const spec = BUILDING_TYPES[emergingType(zone, landValue, rng)];
  // V28 — le bâtiment émerge au bord de la voirie sans jamais la recouvrir
  // ni chevaucher un voisin. Plusieurs tirages cherchent une place nette ;
  // si la densité visée ne tient pas (zone collée à une voirie large, voisins
  // déjà en place), la densité inférieure est tentée plutôt que de laisser
  // la zone stérile — une zone trop petite accueillait déjà la plus petite.
  let footprint = null;
  let spot = null;
  for (const candidate of [density, "mid", "low"]) {
    const f = BUILDING_FOOTPRINTS[candidate];
    if (zone.w < f.w + margin || zone.h < f.h + margin) continue;
    const found = findClearSpot(state, zone, f, rng);
    if (found) { density = candidate; footprint = f; spot = found; break; }
  }
  if (!spot) return null;
  const x = spot.x;
  const y = spot.y;
  const building = {
    id: `bld-${city.nextBuildingId++}`,
    type: spec.id,
    density,
    x: Math.round(x), y: Math.round(y), w: footprint.w, h: footprint.h,
    footprint: Math.round((footprint.w * footprint.h) / (13 * 13)),
    residents: spec.residents[density] || 0,
    jobs: spec.jobs[density] || 0,
    landValue,
    age: 0, level: 1,
    zoneId: zone.id,
    occupants: 0,
    abandoned: false,
    createdHour: hour
  };
  building.frontRoadId = nearestRoadId(state, building) || null;
  city.buildings.push(building);
  return building;
}

function nearestRoadId(state, building) {
  const center = { x: building.x + building.w / 2, y: building.y + building.h / 2 };
  let best = Infinity, id = null;
  for (const segment of roadSegments(state.city)) {
    const d = pointToSegmentDistance(center, segment.a, segment.b);
    if (d < best) { best = d; id = segment.road.id; }
  }
  return id;
}

/**
 * Cycle horaire : valeur foncière, croissance calibrée, remplissage,
 * montée en densité, abandon et démolition automatique.
 */
export function updateBuildings(state, rng = Math.random, hour = null, log = () => {}) {
  ensureBuildingsState(state);
  const simHour = hour === null ? currentHour(state) : hour;
  computeLandValueGrid(state);
  const city = state.city;

  // --- Croissance : 1 bâtiment par zone toutes les 2–4 h simulées ---------
  for (const zone of city.zones) {
    if (zone.nextGrowthAt === undefined || zone.nextGrowthAt === null) {
      zone.nextGrowthAt = simHour + GROWTH_MIN_HOURS + rng() * (GROWTH_MAX_HOURS - GROWTH_MIN_HOURS);
      continue; // première heure : la zone « prend racine »
    }
    if (simHour < zone.nextGrowthAt) continue;
    const landValue = landValueAt(state, zone.x + zone.w / 2, zone.y + zone.h / 2);
    const demand = zoneDemand(state, zone.type);
    if (landValue >= GROWTH_LAND_VALUE_MIN && demand > 0.05) {
      const building = spawnBuilding(state, zone, simHour, rng);
      if (building) {
        log(`${BUILDING_TYPES[building.type].icon} Nouveau ${BUILDING_TYPES[building.type].label.toLowerCase()} (${building.density}) en zone ${ZONE_TYPES[zone.type].label.toLowerCase()}.`);
      }
    }
    zone.nextGrowthAt = simHour + GROWTH_MIN_HOURS + rng() * (GROWTH_MAX_HOURS - GROWTH_MIN_HOURS);
  }

  // --- Cycle de vie des bâtiments ------------------------------------------
  for (const building of city.buildings) {
    building.age += 1;
    // Correction : échantillonnage au centre du bâtiment (cohérent avec
    // l'émergence), pas au coin haut-gauche.
    building.landValue = landValueAt(state, building.x + building.w / 2, building.y + building.h / 2);
    if (building.abandoned) {
      // Démolition automatique après un long abandon.
      if (simHour - (building.abandonedAtHour || building.createdHour || simHour) >= AUTO_DEMOLISH_HOURS) {
        building.demolished = true;
      }
      continue;
    }
    // Remplissage progressif : les occupants suivent la valeur et la demande.
    const occupancyTarget = clamp01(building.landValue * (0.5 + 0.5 * zoneDemand(state, BUILDING_TYPES[building.type].zoneType)));
    building.occupants = clamp01(building.occupants + (occupancyTarget - building.occupants) * 0.08 + (rng() - 0.5) * 0.02);
    // Montée en densité : un bâtiment plein sur un terrain cher s'agrandit.
    // Correction : la densité de départ dépend de la valeur foncière (un
    // bâtiment peut émerger directement en « mid » ou « high »). Piloter
    // l'agrandissement par le seul « level » rétrogradait silencieusement un
    // bâtiment « high » en « mid » (perte de résidents/emplois) ou laissait un
    // bâtiment « mid » redevenir « mid » (fausse montée en densité). On suit
    // désormais la densité réelle.
    const densityRank = { low: 0, mid: 1, high: 2 };
    if (building.occupants > UPGRADE_OCCUPANTS && building.landValue > UPGRADE_LAND_VALUE &&
        (densityRank[building.density] ?? 0) < 2 && building.level < 3) {
      const nextDensity = (densityRank[building.density] ?? 0) === 0 ? "mid" : "high";
      const footprint = BUILDING_FOOTPRINTS[nextDensity];
      const grown = { x: building.x, y: building.y, w: footprint.w, h: footprint.h };
      // V28 — pas d'agrandissement qui déborderait sur la voirie ou un voisin :
      // la montée en densité est reportée au prochain cycle convenable.
      const clear = rectClearOfRoads(state, grown) &&
        !city.buildings.some(b => b !== building && !b.demolished && rectsOverlap(grown, b, BUILDING_GAP_PX));
      if (clear) {
        building.level += 1;
        building.density = nextDensity;
        const spec = BUILDING_TYPES[building.type];
        building.residents = spec.residents[building.density] || 0;
        building.jobs = spec.jobs[building.density] || 0;
        building.w = footprint.w; building.h = footprint.h;
        log(`${spec.icon} Un ${spec.label.toLowerCase()} passe en densité ${building.density}.`);
      }
    }
    // Abandon : valeur trop basse ou inoccupation prolongée.
    const distressed = building.landValue < ABANDON_LAND_VALUE || building.occupants < ABANDON_OCCUPANTS;
    if (distressed) {
      building.distressedHours = (building.distressedHours || 0) + 1;
      if (building.distressedHours >= ABANDON_GRACE_HOURS) {
        building.abandoned = true;
        building.abandonedAtHour = simHour;
        building.occupants = 0;
        log(`${BUILDING_TYPES[building.type].icon} Un bâtiment est abandonné.`);
      }
    } else {
      building.distressedHours = 0;
    }
  }
  city.buildings = city.buildings.filter(b => !b.demolished);
  return city.buildings.length;
}

/** Démolition manuelle : les résidents non relogés pèsent sur la satisfaction. */
export function demolishBuilding(state, buildingId, log = () => {}) {
  ensureBuildingsState(state);
  const building = state.city.buildings.find(b => b.id === buildingId);
  if (!building) return false;
  state.city.buildings = state.city.buildings.filter(b => b.id !== buildingId);
  if ((building.residents || 0) > 0 && !building.abandoned) {
    state.buildingHomeless = (state.buildingHomeless || 0) + building.residents;
    log(`${building.residents} habitants relogés en urgence : satisfaction en baisse.`);
  }
  return true;
}

/** Statistiques pour le HUD (indicateurs de demande 0–100 %). */
export function buildingStats(state) {
  ensureBuildingsState(state);
  const buildings = state.city.buildings;
  const totals = { residents: 0, jobs: 0, abandoned: 0 };
  for (const b of buildings) {
    totals.residents += b.abandoned ? 0 : (b.residents || 0);
    totals.jobs += b.abandoned ? 0 : (b.jobs || 0);
    if (b.abandoned) totals.abandoned += 1;
  }
  return {
    buildings: buildings.length,
    ...totals,
    demand: {
      residential: zoneDemand(state, "residential"),
      commercial: zoneDemand(state, "commercial"),
      industrial: zoneDemand(state, "industrial"),
      service: zoneDemand(state, "service")
    }
  };
}

/**
 * V27 — amorçage d'une nouvelle partie : quelques zones collées à la voirie
 * générée (mix majoritairement résidentiel) pour que des bâtiments émergent
 * dès les premières heures simulées, sans attendre que le joueur découvre
 * l'outil de zonage. Déterministe (rng seedé) et idempotent : ne fait rien
 * si la ville a déjà des zones (sauvegarde rechargée, partie en cours).
 */
export function seedInitialZones(state, rng = Math.random, log = () => {}) {
  ensureBuildingsState(state);
  if (state.city.zones.length) return 0;
  const segments = roadSegments(state.city);
  if (!segments.length) return 0;
  const mix = [
    "residential", "residential", "commercial", "residential",
    "service", "residential", "industrial", "residential",
    "commercial", "residential", "service", "residential"
  ];
  const stride = Math.max(1, Math.floor(segments.length / mix.length));
  let seeded = 0;
  for (let i = 0; i < mix.length; i++) {
    const seg = segments[Math.min(segments.length - 1, i * stride)];
    const dx = seg.b.x - seg.a.x, dy = seg.b.y - seg.a.y;
    const t = 0.25 + rng() * 0.5;
    const px = seg.a.x + dx * t, py = seg.a.y + dy * t;
    // Normale unitaire au segment : la bande est posée à 3 px du bord de
    // voirie (adjacente au sens de ZONE_ROAD_ADJACENCY_PX), alternant de côté.
    const len = Math.hypot(dy, dx) || 1;
    const nx = -dy / len, ny = dx / len;
    const side = i % 2 === 0 ? 1 : -1;
    const w = 84, h = 44;
    const offset = h / 2 + 3;
    const zone = addZone(state, mix[i],
      Math.round(px - w / 2 + nx * side * offset),
      Math.round(py - h / 2 + ny * side * offset),
      w, h);
    if (zone) seeded += 1;
  }
  if (seeded) log(`Urbanisme : ${seeded} zones d'amorçage le long de la voirie.`);
  return seeded;
}



/** V27.2 — bâtiments dès la fondation : une ville neuve ne doit pas rester
 *  déserte pendant des heures simulées alors que les arrêts affichent déjà
 *  des habitants. Chaque zone d'amorçage reçoit immédiatement un bâtiment
 *  (résidents/emplois compris) : l'OD a des origines dès t0.
 *  Idempotent : ne fait rien si des bâtiments existent déjà. */
export function spawnInitialBuildings(state, rng = Math.random, log = () => {}) {
  ensureBuildingsState(state);
  if (state.city.buildings.length) return 0;
  let spawned = 0;
  for (const zone of state.city.zones) {
    if (spawnBuilding(state, zone, 0, rng)) spawned += 1;
  }
  if (spawned) log("Urbanisme : " + spawned + " bâtiment" + (spawned > 1 ? "s" : "") + " sort" + (spawned > 1 ? "ent" : "") + " de terre dès la fondation.");
  return spawned;
}



/** V27.3 — dette §7 : contrôle de collision bâtiment↔route lors du tracé.
 *  Un segment de voirie ne peut pas traverser un bâtiment occupé ; les
 *  bâtiments abandonnés sont expropriés (ruines) pour laisser passer la voirie.
 *  Module 100 % pur, réutilisable par les tests Node. */
function segmentsIntersect(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return false;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Vrai si le segment [a, b] pénètre le rectangle { x, y, w, h } :
 *  soit une extrémité est à l'intérieur, soit il franchit un bord. */
export function segmentIntersectsRect(a, b, rect) {
  const inside = function (p) {
    return p.x >= rect.x && p.x <= rect.x + rect.w &&
           p.y >= rect.y && p.y <= rect.y + rect.h;
  };
  if (inside(a) || inside(b)) return true;
  const c1 = { x: rect.x, y: rect.y };
  const c2 = { x: rect.x + rect.w, y: rect.y };
  const c3 = { x: rect.x + rect.w, y: rect.y + rect.h };
  const c4 = { x: rect.x, y: rect.y + rect.h };
  return segmentsIntersect(a, b, c1, c2) || segmentsIntersect(a, b, c2, c3) ||
         segmentsIntersect(a, b, c3, c4) || segmentsIntersect(a, b, c4, c1);
}

/** Bâtiments occupés que le segment [a, b] traverserait : ils bloquent
 *  le tracé. Les abandonnés n'apparaissent pas ici (expropriation). */
export function traceBlockedBuildings(state, a, b) {
  ensureBuildingsState(state);
  if (!state.buildingsEnabled) return [];
  return (state.city.buildings || []).filter(function (bld2) {
    return !bld2.abandoned && segmentIntersectsRect(a, b, bld2);
  });
}

/** Ruines abandonnées traversées par [a, b] : expropriées par la voirie
 *  (disparaissent sans créer de sans-abri). Renvoie le nombre démolies. */
export function expropriateAbandonedAlongTrace(state, a, b, log = () => {}) {
  ensureBuildingsState(state);
  if (!state.buildingsEnabled) return 0;
  const doomed = (state.city.buildings || []).filter(function (bld2) {
    return bld2.abandoned && segmentIntersectsRect(a, b, bld2);
  });
  if (doomed.length) {
    state.city.buildings = state.city.buildings.filter(function (bld2) {
      return !doomed.includes(bld2);
    });
    log("Voirie : " + doomed.length + " ruine" + (doomed.length > 1 ? "s" : "") + " abandonnée" + (doomed.length > 1 ? "s" : "") + " expropriée" + (doomed.length > 1 ? "s" : "") + " sur le tracé.");
  }
  return doomed.length;
}


