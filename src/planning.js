/** V33 — Mode planification : file de travaux posés gratuitement, puis
 *  payés d'un bloc (ou retirés sans frais si le plan est abandonné).
 *
 *  Options conservatrices (documentées dans CHANGES.md) :
 *  - la file ne couvre que ROUTES et ARRÊTS (les lignes gardent leur
 *    estimation propre, estimateLineCost V25) ;
 *  - les travaux planifiés n'entrent pas dans la pile d'annulation voirie :
 *    tant que le plan n'est pas validé, c'est la file qui pilote l'annulation ;
 *  - à l'abandon, un arrêt devenu desservi par une ligne, ou une route
 *    réutilisée par un itinéraire, est CONSERVÉ (on ne casse pas une ligne).
 */
import { invalidateRoutingCache } from "./routing.js";
import { demolishStop } from "./stops.js";

/** Total estimé de la file de travaux (routes + arrêts). */
export function planTotalCost(queue) {
  return (queue || []).reduce(function (sum, item) {
    return sum + ((item && Number(item.cost)) || 0);
  }, 0);
}

/** Les entrées dont l'infrastructure a disparu (travaux défaits à la main
 *  pendant le plan) ne doivent plus être facturées à la validation. */
export function planPendingItems(state, queue) {
  const stops = (state && state.city && state.city.stops) || [];
  const roads = (state && state.city && state.city.roads) || [];
  return (queue || []).filter(function (item) {
    if (!item) return false;
    if (item.kind === "stop") return stops.some(function (s) { return s.id === item.stopId; });
    if (item.kind === "road") return roads.some(function (r) { return r.id === item.roadId; });
    return false;
  });
}

/** Paiement atomique du plan : tout ou rien, refus motivé sinon. */
export function applyPlan(state, queue, log = () => {}) {
  if (!state) return false;
  const items = planPendingItems(state, queue);
  const total = planTotalCost(items);
  if ((state.money ?? 0) < total) {
    log("Plan refusé : " + total.toLocaleString("fr-FR") + " € nécessaires (budget " + (state.money ?? 0).toLocaleString("fr-FR") + " €).");
    return false;
  }
  state.money -= total;
  return true;
}

/** Abandon : retire gratuitement les travaux planifiés (jamais payés).
 *  Retourne le nombre de travaux effectivement retirés. */
export function clearPlan(state, queue, log = () => {}) {
  if (!state || !state.city) return 0;
  const city = state.city;
  let removed = 0;
  let touched = false;
  for (const item of queue || []) {
    if (!item) continue;
    if (item.kind === "road") {
      const road = city.roads.find(function (r) { return r.id === item.roadId; });
      if (!road) continue;
      const usedByLine = !!(road.a && road.b && (state.lines || []).some(function (line) {
        return line.route && Array.isArray(line.route.nodeIds)
          && line.route.nodeIds.includes(road.a) && line.route.nodeIds.includes(road.b);
      }));
      if (usedByLine) continue; // conservateur : une ligne dépend de cette voirie
      city.roads = city.roads.filter(function (r) { return r.id !== item.roadId; });
      removed++;
      touched = true;
    } else if (item.kind === "stop") {
      // demolishStop refuse un arrêt desservi (conservateur) et nettoie tout.
      if (demolishStop(state, item.stopId, function (m) { log("Plan : " + m); })) {
        removed++;
        touched = true;
      }
    }
  }
  if (touched) invalidateRoutingCache(state);
  return removed;
}
