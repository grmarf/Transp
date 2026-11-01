/** V30 — Gestion des arrêts : construction, démolition, multimodalité.
 *
 * Les arrêts restent des points de desserte du graphe ville (city.stops) ;
 * ce module n'introduit aucune structure parallèle. Trois opérations :
 *  - buildStop : pose d'un arrêt neuf (coût fixe, espacement minimal,
 *    refus propre avec motif si la case est occupée, hors territoire ou
 *    si les fonds manquent) ;
 *  - demolishStop : démolition (REFUSÉE si l'arrêt est desservi par au moins
 *    une ligne — option conservatrice : le joueur retire d'abord la ligne ;
 *    les passagers en attente à cet arrêt sont abandonnés et comptés) ;
 *  - upgradeStopMultimodal / downgradeStopMultimodal : pôle multimodal.
 *
 * Bonus multimodal (conservateur, documenté dans CHANGES.md) :
 *  - un passager EN CORRESPONDANCE à un arrêt multimodal attend deux fois
 *    moins vite (engine.step applique MULTIMODAL_TRANSFER_WAIT_FACTOR) ;
 *  - un arrêt multimodal est 20 % plus attractif comme destination
 *    (generateDemand, moteur historique).
 * Les sauvegardes n'ont pas besoin de migration : stop.multimodal est un
 * champ optionnel (absent = faux pour toute partie antérieure).
 */
import { invalidateRoutingCache } from "./routing.js";
import { PASSENGER_STATES } from "./passengers.js";

export const STOP_BUILD_COST = 1200;
export const MULTIMODAL_UPGRADE_COST = 6000;
export const MULTIMODAL_REFUND_RATIO = 0.5;
export const MIN_STOP_SPACING = 80;
export const MULTIMODAL_TRANSFER_WAIT_FACTOR = 0.5;
export const MULTIMODAL_ATTRACTIVENESS_BONUS = 1.2;

function uniqueStopId(city) {
  let n = city.stops.length + 1;
  while (city.stops.some(s => s.id === "stop-" + n)) n++;
  return "stop-" + n;
}

function nearestDistrict(city, x, y) {
  let best = null, bestDist = Infinity;
  for (const d of city.districts || []) {
    const dist = Math.hypot((d.center ? d.center.x : 0) - x, (d.center ? d.center.y : 0) - y);
    if (dist < bestDist) { best = d; bestDist = dist; }
  }
  return best;
}

/** Validation sans mutation : raison prête à afficher en cas de refus. */
export function canBuildStop(state, x, y, options = {}) {
  if (!state || !state.city) return { ok: false, reason: "aucune ville chargée" };
  const city = state.city;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: "position invalide" };
  const w = Number(city.width) || 1000, h = Number(city.height) || 650;
  if (x < 30 || y < 30 || x > w - 30 || y > h - 30) {
    return { ok: false, reason: "hors du territoire de la ville" };
  }
  for (const s of city.stops) {
    if (Math.hypot(s.x - x, s.y - y) < MIN_STOP_SPACING) {
      return { ok: false, reason: "trop proche de « " + s.name + " » (espacement minimal " + MIN_STOP_SPACING + " px)" };
    }
  }
  if (!options.free && (state.money ?? 0) < STOP_BUILD_COST) {
    return { ok: false, reason: "fonds insuffisants (" + STOP_BUILD_COST.toLocaleString("fr-FR") + " € nécessaires)" };
  }
  return { ok: true };
}

/** Construit un arrêt. Retourne l'arrêt créé, ou null après refus motivé. */
export function buildStop(state, x, y, log = () => {}, options = {}) {
  const check = canBuildStop(state, x, y, options);
  if (!check.ok) { log("Construction refusée : " + check.reason + "."); return null; }
  const city = state.city;
  const id = uniqueStopId(city);
  city.customStopCount = (city.customStopCount || 0) + 1;
  const label = city.customStopCount;
  const district = nearestDistrict(city, x, y);
  const stop = {
    id,
    name: "Arrêt " + label,
    x: Math.round(x),
    y: Math.round(y),
    demand: 0.8,
    waiting: 0,
    waitingByDestination: {},
    districtId: district ? district.id : "district-" + (city.stops.length + 1),
    population: 350,
    jobs: 180,
    commerce: 120,
    density: Math.round(350 / 3),
    hasSpawnedSatellite: false,
    multimodal: false,
    builtByPlayer: true
  };
  city.stops.push(stop);
  if (!options.free) state.money -= STOP_BUILD_COST;
  invalidateRoutingCache(state);
  log(options.free
    ? "Arrêt « " + stop.name + " » posé (plan : " + STOP_BUILD_COST.toLocaleString("fr-FR") + " € à la validation du plan)."
    : "Arrêt « " + stop.name + " » construit (" + STOP_BUILD_COST.toLocaleString("fr-FR") + " €). Raccordez-le à la voirie puis tracez une ligne pour le desservir.");
  return stop;
}

/** Un arrêt desservi par une ligne ne peut PAS être démolit (conservateur). */
export function canDemolishStop(state, stopId) {
  const stop = state && state.city && state.city.stops.find(s => s.id === stopId);
  if (!stop) return { ok: false, reason: "arrêt introuvable" };
  const servedBy = (state.lines || []).filter(l => (l.stopIds || []).includes(stopId));
  if (servedBy.length) {
    return { ok: false, reason: "desservi par " + servedBy.map(l => l.name).join(", ") };
  }
  if ((state.pendingStops || []).includes(stopId)) {
    return { ok: false, reason: "sélectionné dans un tracé de ligne en cours" };
  }
  return { ok: true };
}

/** Démolit un arrêt libre. Conséquences traitées : passagers en attente à
 *  cet arrêt (ou dont il est la destination) abandonnés et comptés, voirie
 *  raccordée supprimée, demandes en file à destination de l'arrêt purgées. */
export function demolishStop(state, stopId, log = () => {}) {
  const check = canDemolishStop(state, stopId);
  if (!check.ok) { log("Suppression refusée : " + check.reason + "."); return false; }
  const city = state.city;
  const stop = city.stops.find(s => s.id === stopId);
  let dropped = 0;
  const now = (state.elapsedDays || 0) * 1440 + (state.time || 0);
  for (const p of state.passengers || []) {
    if (p.destinationId === stopId || p.currentStopId === stopId || p.originId === stopId) {
      if (p.state === PASSENGER_STATES.WAITING || p.state === PASSENGER_STATES.TRANSFERRING) {
        p.state = PASSENGER_STATES.ABANDONED;
        p.completedAt = now;
        state.totalAbandoned = (state.totalAbandoned || 0) + 1;
        dropped++;
      }
    }
  }
  const attached = (r) => r.a === stopId || r.b === stopId || r.startStopId === stopId || r.endStopId === stopId;
  const removedRoads = city.roads.filter(attached);
  city.roads = city.roads.filter(r => !attached(r));
  city.stops = city.stops.filter(s => s.id !== stopId);
  for (const other of city.stops) {
    if (other.waitingByDestination) delete other.waitingByDestination[stopId];
  }
  if (state.selectedStop === stopId) state.selectedStop = null;
  invalidateRoutingCache(state);
  log("Arrêt « " + stop.name + " » démoli" +
    (removedRoads.length ? " (" + removedRoads.length + " segment(s) de voirie raccordé(s) supprimé(s))" : "") +
    (dropped ? ", " + dropped + " passager(s) en attente perdu(s)" : "") + ".");
  return true;
}

/** Transforme un arrêt en pôle multimodal (bonus de correspondance). */
export function upgradeStopMultimodal(state, stopId, log = () => {}) {
  const stop = state && state.city && state.city.stops.find(s => s.id === stopId);
  if (!stop) { log("Arrêt introuvable."); return false; }
  if (stop.multimodal) { log("« " + stop.name + " » est déjà un pôle multimodal."); return false; }
  if ((state.money ?? 0) < MULTIMODAL_UPGRADE_COST) {
    log("Upgrade multimodal impossible : " + MULTIMODAL_UPGRADE_COST.toLocaleString("fr-FR") + " € nécessaires.");
    return false;
  }
  state.money -= MULTIMODAL_UPGRADE_COST;
  stop.multimodal = true;
  invalidateRoutingCache(state);
  log("« " + stop.name + " » devient un pôle multimodal (" + MULTIMODAL_UPGRADE_COST.toLocaleString("fr-FR") + " €) : correspondances fluidifiées, attractivité renforcée.");
  return true;
}

/** Rétrogradation : le pôle redevient un arrêt simple, remboursement partiel. */
export function downgradeStopMultimodal(state, stopId, log = () => {}) {
  const stop = state && state.city && state.city.stops.find(s => s.id === stopId);
  if (!stop || !stop.multimodal) { log("Cet arrêt n'est pas un pôle multimodal."); return false; }
  stop.multimodal = false;
  const refund = Math.round(MULTIMODAL_UPGRADE_COST * MULTIMODAL_REFUND_RATIO);
  state.money += refund;
  invalidateRoutingCache(state);
  log("« " + stop.name + " » redevient un arrêt simple (remboursement " + refund.toLocaleString("fr-FR") + " €).");
  return true;
}
