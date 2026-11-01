/** V34 — Scénarios & défis (réécriture complète de l'ébauche V9).
 *
 * Contrats inchangés : SCENARIOS, findScenario(id), scenarioProgress(state,
 * metrics) et evaluateScenario(state, log, metrics) — engine.js appelle
 * evaluateScenario une fois par jour simulé avec { net, currentSatisfaction }
 * et ce module n'importe jamais engine.js (pas de cycle d'imports).
 *
 * Nouveautés :
 *  - objectifs MULTIPLES par scénario (objectives[]), tous mesurables :
 *    "transported" (passagers arrivés), "netBalance" (bilan net),
 *    "lineOfType" (ouvrir N ligne(s) d'un mode donné : bus/tram/metro) ;
 *  - contrainte continue "satisfactionMin" : échec immédiat si violée ;
 *  - médailles or / argent / bronze à la victoire selon la marge de temps ;
 *  - record par scénario (meilleure médaille puis jour le plus tôt), stocké
 *    HORS sauvegarde dans une clé localStorage dédiée : aucune migration du
 *    format de sauvegarde n'est nécessaire (V32 reste en v4) ;
 *  - compatibilité : chaque scénario garde un champ "objective" (alias du
 *    premier objectif) et scenarioObjectives() accepte l'ancienne forme
 *    mono-objectif des sauvegardes V33.
 */

export const MEDAL_EMOJI = { gold: "🥇", silver: "🥈", bronze: "🥉" };
const MEDAL_RANK = { gold: 3, silver: 2, bronze: 1 };
export const SCENARIO_RECORDS_KEY = "vietlignes-scenario-records-v1";

export const SCENARIOS = [
  {
    id: "sandbox",
    name: "Bac à sable",
    difficulty: "Libre",
    description: "Aucun objectif : construis la ville et le réseau que tu veux.",
    startingMoney: 50000,
    durationDays: null,
    objectives: [],
    objective: null,
    demandMultiplier: 1,
    roadworksChanceMultiplier: 1,
    growthRateMultiplier: 1
  },
  {
    id: "premiers-pas",
    name: "Premiers pas",
    difficulty: "Facile",
    description: "Ton tout premier réseau : 500 passagers transportés en 12 jours, demande en hausse mais travaux rares.",
    startingMoney: 50000,
    durationDays: 12,
    objectives: [
      { type: "transported", target: 500, label: "Transporter 500 passagers" }
    ],
    demandMultiplier: 1.1,
    roadworksChanceMultiplier: 0.4,
    growthRateMultiplier: 1
  },
  {
    id: "expansion-express",
    name: "Expansion express",
    difficulty: "Normal",
    description: "Budget serré, horloge courte : un réseau rentable ET 250 passagers en 15 jours.",
    startingMoney: 35000,
    durationDays: 15,
    objectives: [
      { type: "netBalance", target: 20000, label: "Atteindre 20 000 € de bilan net" },
      { type: "transported", target: 250, label: "Transporter 250 passagers" }
    ],
    demandMultiplier: 1,
    roadworksChanceMultiplier: 1,
    growthRateMultiplier: 1
  },
  {
    id: "crise-infrastructure",
    name: "Crise infrastructure",
    difficulty: "Difficile",
    description: "Travaux publics partout, ville au ralenti : tiens la satisfaction sans jamais passer sous 50 %.",
    startingMoney: 25000,
    durationDays: 10,
    objectives: [
      { type: "satisfactionMin", target: 50, label: "Ne jamais passer sous 50 % de satisfaction" },
      { type: "transported", target: 300, label: "Transporter 300 passagers" }
    ],
    demandMultiplier: 1,
    roadworksChanceMultiplier: 2.5,
    growthRateMultiplier: 0.6
  },
  {
    id: "cap-sur-le-metro",
    name: "Cap sur le métro",
    difficulty: "Difficile",
    description: "Perce les tunnels : ouvre une vraie ligne de métro et démontre sa puissance (400 passagers).",
    startingMoney: 45000,
    durationDays: 14,
    objectives: [
      { type: "lineOfType", vehicleType: "metro", count: 1, label: "Ouvrir une ligne de métro" },
      { type: "transported", target: 400, label: "Transporter 400 passagers" }
    ],
    demandMultiplier: 1,
    roadworksChanceMultiplier: 1,
    growthRateMultiplier: 1
  },
  {
    id: "ville-qui-grandit",
    name: "Ville qui grandit",
    difficulty: "Expert",
    description: "Croissance ×2 et demande ×1,2 : suis le rythme sans jamais passer sous 45 % de satisfaction.",
    startingMoney: 30000,
    durationDays: 18,
    objectives: [
      { type: "transported", target: 900, label: "Transporter 900 passagers" },
      { type: "satisfactionMin", target: 45, label: "Ne jamais passer sous 45 % de satisfaction" }
    ],
    demandMultiplier: 1.2,
    roadworksChanceMultiplier: 1,
    growthRateMultiplier: 2
  }
];

// Compat V33 : chaque scénario expose aussi son premier objectif sous
// "objective" — l'ancien champ mono-objectif reste ainsi cohérent pour
// les sauvegardes et tout code qui le lit encore.
for (const s of SCENARIOS) {
  s.objective = Array.isArray(s.objectives) && s.objectives.length ? s.objectives[0] : null;
}

export function findScenario(id) {
  return SCENARIOS.find(function (s) { return s.id === id; }) || SCENARIOS[0];
}

/** Normalise les objectifs : nouvelle forme (objectives[]) ou ancienne
 *  forme mono-objectif des sauvegardes V33 ({ objective: {...} }). */
export function scenarioObjectives(scenario) {
  if (!scenario) return [];
  if (Array.isArray(scenario.objectives) && scenario.objectives.length) {
    return scenario.objectives;
  }
  if (scenario.objective) return [scenario.objective];
  return [];
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** Progression détaillée : { overall: 0..1|null, items: [{ type, label,
 *  progress: 0..1|null, done, failed }] }. overall = minimum des objectifs
 *  mesurables (les contraintes continues y sont exclues). null si le
 *  scénario n'a aucun objectif. */
export function scenarioProgress(state, metrics = {}) {
  const scenario = state && state.scenario;
  const objectives = scenarioObjectives(scenario);
  if (!objectives.length) return null;
  const items = objectives.map(function (obj) {
    if (obj.type === "transported") {
      const value = state.totalArrived || 0;
      const p = clamp01(value / obj.target);
      return { type: obj.type, label: obj.label, progress: p, done: value >= obj.target, failed: false };
    }
    if (obj.type === "netBalance") {
      const value = Number(metrics.net) || 0;
      const p = clamp01(value / obj.target);
      return { type: obj.type, label: obj.label, progress: p, done: value >= obj.target, failed: false };
    }
    if (obj.type === "lineOfType") {
      const target = obj.count || 1;
      const value = (state.lines || []).filter(function (l) {
        return l && l.mode === obj.vehicleType;
      }).length;
      const p = clamp01(value / target);
      return { type: obj.type, label: obj.label, progress: p, done: value >= target, failed: false };
    }
    if (obj.type === "satisfactionMin") {
      const current = metrics.currentSatisfaction;
      const violated = Number.isFinite(current) && current < obj.target;
      return { type: obj.type, label: obj.label, progress: null, done: false, failed: violated };
    }
    return { type: obj.type || "?", label: obj.label || "?", progress: null, done: false, failed: false };
  });
  const measurable = items.filter(function (it) { return it.progress != null; });
  const overall = measurable.length
    ? measurable.reduce(function (m, it) { return Math.min(m, it.progress); }, 1)
    : null;
  return { overall: overall, items: items };
}

/** Médaille selon la marge de temps à la victoire (null sans durée). */
export function scenarioMedal(scenario, state) {
  if (!scenario || !scenario.durationDays) return null;
  const day = (state.elapsedDays || 0) + 1;
  if (day / scenario.durationDays <= 0.7) return { id: "gold", label: "or" };
  if (day / scenario.durationDays < 1) return { id: "silver", label: "argent" };
  return { id: "bronze", label: "bronze" };
}

/** Appelé une fois par jour simulé (engine.js) ; statue sur le scénario.
 *  Victoire = tous les objectifs mesurables atteints (contraintes tenues).
 *  Échec = contrainte violée, ou délai dépassé sans victoire. */
export function evaluateScenario(state, log = () => {}, metrics = {}) {
  const scenario = state.scenario;
  if (!scenario || scenario.status !== "active") return;
  const objectives = scenarioObjectives(scenario);
  if (!objectives.length) return;
  const report = scenarioProgress(state, metrics);
  const items = report.items || [];
  const measurable = items.filter(function (it) { return it.progress != null; });
  const constraint = items.filter(function (it) { return it.type === "satisfactionMin"; });
  const violated = constraint.filter(function (it) { return it.failed; });

  if (violated.length) {
    scenario.status = "lost";
    log("Défi échoué : " + scenario.name + " — " + violated[0].label + ".");
    return;
  }
  if (measurable.length && measurable.every(function (it) { return it.done; })) {
    scenario.status = "won";
    scenario.medal = scenarioMedal(scenario, state);
    log("🏆 Défi réussi : " + scenario.name + " !" +
      (scenario.medal ? " Médaille " + scenario.medal.label + " 🏅" : ""));
    return;
  }
  if (scenario.durationDays && (state.elapsedDays || 0) >= scenario.durationDays) {
    const allDone = measurable.every(function (it) { return it.done; });
    if (allDone) {
      // Un défi purement « tenir N jours » : la contrainte est tenue jusqu'au bout.
      scenario.status = "won";
      scenario.medal = scenarioMedal(scenario, state);
      log("🏆 Défi réussi : " + scenario.name + " — tenu jusqu'au dernier jour !");
    } else {
      scenario.status = "lost";
      const missing = measurable.filter(function (it) { return !it.done; })
        .map(function (it) { return it.label; }).join(" · ");
      log("Défi échoué : " + scenario.name + " — délai dépassé. Il manquait : " + missing + ".");
    }
  }
}

// ---------------------------------------------------------------------------
// Records par scénario — stockés HORS sauvegarde (clé localStorage dédiée),
// donc aucun impact sur le format de sauvegarde versionné (V32, format 4).
// ---------------------------------------------------------------------------

export function loadScenarioRecords() {
  try {
    if (typeof localStorage === "undefined") return {};
    return JSON.parse(localStorage.getItem(SCENARIO_RECORDS_KEY) || "{}") || {};
  } catch (e) {
    return {};
  }
}

export function saveScenarioRecords(records) {
  try {
    if (typeof localStorage === "undefined") return false;
    localStorage.setItem(SCENARIO_RECORDS_KEY, JSON.stringify(records || {}));
    return true;
  } catch (e) {
    return false;
  }
}

/** Pur : garde le meilleur résultat pour le scénario (médaille, puis jour
 *  le plus tôt). Une victoire ne peut jamais être écrasée par un échec. */
export function recordScenarioResult(records, scenarioId, result) {
  const next = Object.assign({}, records || {});
  const prev = next[scenarioId];
  const rank = function (r) {
    return r && r.status === "won" ? (MEDAL_RANK[r.medal] || 0) : -1;
  };
  if (!prev || rank(result) > rank(prev) ||
      (rank(result) === rank(prev) && (result.day || 0) < (prev.day || 0))) {
    next[scenarioId] = { status: result.status, medal: result.medal || null, day: result.day };
  }
  return next;
}
