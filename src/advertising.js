/** V22.0 — renewable advertising campaigns (events.js pattern).
 * One campaign at a time, a one-day cooldown after expiry, and a hard cap
 * on the demand boost. Opt-in via state.advertisingEnabled.
 */
export const CAMPAIGNS = Object.freeze({
  local: { id: "local", label: "Affichage local", icon: "📣", cost: 1500, durationDays: 3, demandMultiplier: 1.15 },
  city: { id: "city", label: "Campagne citadine", icon: "🏙", cost: 4000, durationDays: 3, demandMultiplier: 1.30 },
  target: { id: "target", label: "Marketing ciblé", icon: "🎯", cost: 6000, durationDays: 2, demandMultiplier: 1.45 }
});

function campaignById(id) {
  return Object.values(CAMPAIGNS).find(c => c.id === id) || null;
}

export function activeCampaigns(state) {
  if (!state?.advertisingEnabled) return [];
  return (state.activeCampaigns || []).filter(c => c.endsDay > (state.elapsedDays || 0));
}

/** Combined demand multiplier of running campaigns (capped). */
export function campaignDemandMultiplier(state) {
  return Math.min(1.45, activeCampaigns(state).reduce((m, c) => m * (campaignById(c.id)?.demandMultiplier ?? 1), 1));
}

export function startCampaign(state, id, log = () => {}) {
  if (!state.advertisingEnabled) return null;
  const def = campaignById(id);
  if (!def) return null;
  if (activeCampaigns(state).length) { log("Une campagne est déjà en cours."); return null; }
  if ((state.campaignCooldownUntil || 0) > (state.elapsedDays || 0)) { log("Vos équipes marketing doivent souffler un peu avant une nouvelle campagne."); return null; }
  if (state.money < def.cost) { log(`Campagne impossible : ${def.cost.toLocaleString("fr-FR")} € nécessaires.`); return null; }
  state.money -= def.cost;
  const campaign = {
    campaignId: state.nextCampaignId++, id: def.id,
    startedDay: state.elapsedDays || 0,
    endsDay: (state.elapsedDays || 0) + def.durationDays,
    passengersStart: state.totalArrived || 0
  };
  state.activeCampaigns = [...(state.activeCampaigns || []), campaign];
  log(`${def.icon} ${def.label} lancée : demande ×${def.demandMultiplier.toFixed(2)} pendant ${def.durationDays} jour(s) (−${def.cost.toLocaleString("fr-FR")} €).`);
  return campaign;
}

export function finishExpiredCampaigns(state, log = () => {}) {
  const before = state.activeCampaigns || [];
  const active = before.filter(c => c.endsDay > (state.elapsedDays || 0));
  const expired = before.filter(c => c.endsDay <= (state.elapsedDays || 0));
  for (const c of expired) {
    const def = campaignById(c.id);
    const carried = Math.max(0, (state.totalArrived || 0) - (c.passengersStart || 0));
    log(`${def?.icon || "📣"} ${def?.label || c.id} terminée : ${carried} passager(s) transportés pendant la campagne.`);
  }
  state.activeCampaigns = active;
  if (expired.length) {
    state.campaignCooldownUntil = (state.elapsedDays || 0) + 1;
    state.campaignHistory = [...(state.campaignHistory || []), ...expired].slice(-20);
  }
  return before.length - active.length;
}
