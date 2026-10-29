/** V27 — génération origine-destination des passagers depuis les bâtiments.
 *
 * Module 100 % pur (importable en Node sans navigateur). Tant que
 * state.buildingsEnabled est faux, l'ancienne génération aux arrêts
 * (engine.generateDemand) reste seule en jeu ; les tests antérieurs
 * conservent leurs trajectoires exactes.
 *
 * Principe (Cities in Motion) :
 *  - le matin (6 h–10 h), chaque résident d'un bâtiment résidentiel
 *    choisit une destination pondérée : bureaux 40 %, commerces 30 %,
 *    industries 20 %, services 10 % ;
 *  - le soir (16 h–20 h), les trajets s'inversent (emplois → résidences) ;
 *  - en dehors de ces créneaux, un flux réduit résidentiel →
 *    commerces/loisirs/services ;
 *  - l'agent part de l'arrêt couvert le plus proche de son bâtiment
 *    d'origine (une ligne active y passe) ; s'il n'y en a aucun à portée,
 *    le trajet n'est pas généré (demande perdue, comptée) ;
 *  - l'arrêt de destination est celui le plus proche du bâtiment cible.
 */
import { distance } from "./constants.js";
import { servedStopIds } from "./coverage.js";
import { BUILDING_TYPES } from "./buildings.js";

/** Fenêtres de pointe (heures simulées). */
export const OD_MORNING_START = 6;
export const OD_MORNING_END = 10;
export const OD_EVENING_START = 16;
export const OD_EVENING_END = 20;

/** Mix matinal résidentiel → emplois (spec §4.6). */
export const OD_DESTINATION_MIX = Object.freeze({
  office: 0.40,
  commercial: 0.30,
  industrial: 0.20,
  service: 0.10
});

/** Flux hors pointe : résidentiel → commerces / loisirs / services. */
export const OD_OFFPEAK_MIX = Object.freeze({
  commercial: 0.55,
  leisure: 0.25,
  service: 0.20
});

/** Porte de marche bâtiment → arrêt d'origine (px). */
export const OD_WALK_RADIUS_PX = 260;

/** Chaque résident part environ une fois par créneau matinal (240 min). */
const MORNING_MINUTES = (OD_MORNING_END - OD_MORNING_START) * 60;
const EVENING_MINUTES = (OD_EVENING_END - OD_EVENING_START) * 60;
/** Hors pointe, le flux tombe à ~15 % du volume de pointe. */
const OFFPEAK_RATE = 0.15;

/** Arrêt couvert (desservi par une ligne active) le plus proche d'un bâtiment. */
export function nearestCoveredStop(state, building, radius = OD_WALK_RADIUS_PX) {
  const stops = state?.city?.stops || [];
  const served = servedStopIds(state);
  if (!served.size) return null;
  const center = { x: building.x + (building.w || 0) / 2, y: building.y + (building.h || 0) / 2 };
  let best = null, bestD = radius;
  for (const stop of stops) {
    if (!served.has(stop.id)) continue;
    const d = distance(center, stop);
    if (d <= bestD) { bestD = d; best = stop; }
  }
  return best;
}

/** Arrêt le plus proche d'un bâtiment (couverture non requise : on arrive
 *  où l'on peut, la-distance-au-but joue sur la satisfaction du trajet). */
export function nearestStop(state, building) {
  const stops = state?.city?.stops || [];
  const center = { x: building.x + (building.w || 0) / 2, y: building.y + (building.h || 0) / 2 };
  let best = null, bestD = Infinity;
  for (const stop of stops) {
    const d = distance(center, stop);
    if (d < bestD) { bestD = d; best = stop; }
  }
  return best;
}

/** Bâtiments d'origine pour un créneau : résidences le matin, emplois le soir. */
export function originBuildings(state, slot) {
  const buildings = state?.city?.buildings || [];
  if (slot === "morning") {
    return buildings.filter(b => !b.abandoned && b.type === "residential" && (b.residents || 0) > 0);
  }
  if (slot === "evening") {
    return buildings.filter(b => !b.abandoned && ["office", "commercial", "industrial", "service"].includes(b.type) && (b.jobs || 0) > 0);
  }
  // Hors pointe : les résidences alimentent surtout commerces et loisirs.
  return buildings.filter(b => !b.abandoned && b.type === "residential" && (b.residents || 0) > 0);
}

/** Poids d'attractivité d'une destination (taille × décroissance de distance). */
function destinationWeight(originBuilding, destination) {
  const size = destination.jobs || destination.residents || 1;
  const d = Math.max(1, distance(
    { x: originBuilding.x, y: originBuilding.y },
    { x: destination.x, y: destination.y }
  ));
  return size * (0.5 + Math.min(1.5, 400 / d));
}

/** Tirage pondéré d'un bâtiment cible selon le mix du créneau. */
export function pickDestinationBuilding(state, rng, origin, mix) {
  const buildings = (state?.city?.buildings || []).filter(b => !b.abandoned && b.id !== origin.id);
  // 1. tirage du type cible selon le mix (40/30/20/10 le matin)
  let roll = rng();
  let targetType = null, acc = 0;
  for (const [type, share] of Object.entries(mix)) {
    acc += share;
    if (roll <= acc) { targetType = type; break; }
  }
  if (!targetType) targetType = Object.keys(mix)[0];
  // 2. tirage pondéré parmi les destinations de ce type
  const pool = buildings.filter(b => b.type === targetType);
  const fallback = pool.length === 0 ? buildings.filter(b => (b.jobs || 0) > 0 || (b.residents || 0) > 0) : pool;
  if (!fallback.length) return null;
  const weights = fallback.map(d => destinationWeight(origin, d));
  const total = weights.reduce((a, w) => a + w, 0);
  if (!(total > 0)) return fallback[0];
  roll = rng() * total;
  for (let i = 0; i < fallback.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return fallback[i];
  }
  return fallback[fallback.length - 1];
}

/** Créneau OD pour une heure simulée (0–24). */
export function odSlot(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= OD_MORNING_START && h < OD_MORNING_END) return "morning";
  if (h >= OD_EVENING_START && h < OD_EVENING_END) return "evening";
  return "offpeak";
}

/** Volume attendu de trajets d'un bâtiment d'origine pour une tranche.
 *  Renvoie un nombre attendu (peut être < 1) : l'appelant tire le count. */
export function expectedTrips(building, slot, sliceMinutes, intervalFactor) {
  const people = slot === "evening" ? (building.jobs || 0) : (building.residents || 0);
  const windowMinutes = slot === "morning" ? MORNING_MINUTES : slot === "evening" ? EVENING_MINUTES : MORNING_MINUTES / OFFPEAK_RATE;
  const rate = slot === "offpeak" ? OFFPEAK_RATE : 1;
  return (people / windowMinutes) * sliceMinutes * intervalFactor * rate;
}

/** Sens du trajet pour un créneau (étiquette de journal/debug). */
export function odSlotLabel(slot) {
  if (slot === "morning") return "matin";
  if (slot === "evening") return "soir";
  return "creuse";
}

export function odMixForSlot(slot) {
  if (slot === "morning") return OD_DESTINATION_MIX;
  if (slot === "evening") return { residential: 1 };
  return OD_OFFPEAK_MIX;
}

export { BUILDING_TYPES };

/** V27 — l'OD a-t-elle des origines (bâtiments peuplés : résidents ou emplois) ?
 *  Tant que non, engine.generateDemand garde la génération historique aux
 *  arrêts : sans ce repli, une partie fraîche (aucune zone peinte, donc
 *  aucun bâtiment) ne générerait jamais un seul passager. */
export function odHasOrigins(state) {
  return (state?.city?.buildings || []).some(b =>
    !b.abandoned && ((b.residents || 0) > 0 || (b.jobs || 0) > 0));
}

