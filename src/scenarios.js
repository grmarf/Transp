/** V9.0 — Scenarios: objectives, difficulty, constraints.
 * This module never imports engine.js: it doesn't compute simulation
 * metrics itself, engine.js's step() passes them in already computed
 * (avoids an engine <-> scenarios import cycle, same reasoning as growth.js
 * needing vehicles.js but not engine.js in V6.0).
 */

export const SCENARIOS = [
  {
    id: "sandbox",
    name: "Bac à sable",
    difficulty: "Libre",
    startingMoney: 50000,
    durationDays: null,
    objective: null,
    demandMultiplier: 1,
    roadworksChanceMultiplier: 1,
    growthRateMultiplier: 1
  },
  {
    id: "premiers-pas",
    name: "Premiers pas",
    difficulty: "Facile",
    startingMoney: 50000,
    durationDays: 10,
    objective: { type: "transported", target: 500, label: "Transporter 500 passagers" },
    demandMultiplier: 1.1,
    roadworksChanceMultiplier: 0.4,
    growthRateMultiplier: 1
  },
  {
    id: "expansion-express",
    name: "Expansion express",
    difficulty: "Normal",
    startingMoney: 35000,
    durationDays: 15,
    objective: { type: "netBalance", target: 20000, label: "Atteindre 20 000 € de bilan net" },
    demandMultiplier: 1,
    roadworksChanceMultiplier: 1,
    growthRateMultiplier: 1
  },
  {
    id: "crise-infrastructure",
    name: "Crise infrastructure",
    difficulty: "Difficile",
    startingMoney: 25000,
    durationDays: 10,
    objective: { type: "satisfaction", target: 50, label: "Tenir 50 % de satisfaction pendant 10 jours" },
    demandMultiplier: 1,
    roadworksChanceMultiplier: 2.5,
    growthRateMultiplier: 0.6
  }
];

export function findScenario(id) {
  return SCENARIOS.find(s => s.id === id) || SCENARIOS[0];
}

/** 0..1, or null if the current scenario has no measurable objective. */
export function scenarioProgress(state, metrics) {
  const scenario = state.scenario;
  if (!scenario?.objective) return null;
  const { type, target } = scenario.objective;
  if (type === "transported") return Math.max(0, Math.min(1, state.totalArrived / target));
  if (type === "netBalance") return Math.max(0, Math.min(1, metrics.net / target));
  if (type === "satisfaction") {
    return scenario.durationDays ? Math.max(0, Math.min(1, (state.elapsedDays || 0) / scenario.durationDays)) : 0;
  }
  return 0;
}

/** Called once per simulated day; mutates state.scenario.status. */
export function evaluateScenario(state, log, metrics) {
  const scenario = state.scenario;
  if (!scenario || scenario.status !== "active" || !scenario.objective) return;

  const { type, target } = scenario.objective;
  let met = false;
  let violated = false;

  if (type === "transported") met = state.totalArrived >= target;
  else if (type === "netBalance") met = metrics.net >= target;
  else if (type === "satisfaction") violated = metrics.currentSatisfaction < target;

  if (met) {
    scenario.status = "won";
    log(`Scénario réussi : ${scenario.name} !`);
    return;
  }
  if (violated) {
    scenario.status = "lost";
    log(`Scénario échoué : ${scenario.name} (satisfaction passée sous ${target} %).`);
    return;
  }
  if (scenario.durationDays && (state.elapsedDays || 0) >= scenario.durationDays) {
    if (type === "satisfaction") {
      scenario.status = "won";
      log(`Scénario réussi : ${scenario.name} !`);
    } else {
      scenario.status = "lost";
      log(`Scénario échoué : ${scenario.name} (délai dépassé).`);
    }
  }
}
