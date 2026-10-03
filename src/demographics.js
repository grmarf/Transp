/** V22.0 — passenger demographic segments (Cities in Motion inspired).
 * Each passenger belongs to a social group with its own fare sensitivity,
 * wait tolerance and peak hours. Groups are opt-in (state.demographicsEnabled)
 * so legacy engine tests keep their exact trajectories.
 */
export const DEMOGRAPHICS = Object.freeze({
  commuter: { id: "commuter", label: "Actifs", icon: "💼", share: 0.40, fareSensitivity: 0.4, waitToleranceMinutes: 240, peakHours: [7, 8, 9, 17, 18, 19] },
  student: { id: "student", label: "Étudiants", icon: "🎓", share: 0.25, fareSensitivity: 0.8, waitToleranceMinutes: 300, peakHours: [8, 12, 17] },
  retiree: { id: "retiree", label: "Retraités", icon: "🧓", share: 0.20, fareSensitivity: 0.6, waitToleranceMinutes: 360, peakHours: [10, 11, 14, 15] },
  worker: { id: "worker", label: "Ouvriers", icon: "🧰", share: 0.15, fareSensitivity: 0.9, waitToleranceMinutes: 180, peakHours: [6, 7, 16, 17] }
});

const LIST = Object.values(DEMOGRAPHICS);

export function demographicById(id) {
  return DEMOGRAPHICS[id] || DEMOGRAPHICS.commuter;
}

/** Weighted draw; a group is more likely during its own peak hours. */
export function pickDemographic(rng, hour = 8) {
  const h = Math.floor(((hour % 24) + 24) % 24);
  const weights = LIST.map(d => d.share * (d.peakHours.includes(h) ? 1.3 : 1));
  const total = weights.reduce((a, w) => a + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < LIST.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return LIST[i].id;
  }
  return LIST[LIST.length - 1].id;
}

/**
 * Fare acceptance (1 = always boards → 0 = never boards) for a group at a
 * given fare level (1 = base fare). Price-sensitive groups refuse earlier;
 * passengers without a group (legacy saves / engine tests) always accept.
 */
export function fareAcceptance(demographicId, fareLevel = 1) {
  if (!demographicId || !fareLevel || fareLevel <= 1) return 1;
  const demo = demographicById(demographicId);
  return Math.max(0, Math.min(1, 1 - demo.fareSensitivity * (fareLevel - 1) * 1.1));
}

export function waitToleranceMinutes(demographicId) {
  return demographicById(demographicId).waitToleranceMinutes;
}
