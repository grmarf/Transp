// V34 — scénarios & défis : objectifs multiples, médailles, records.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCity } from "../src/city.js";
import { createState } from "../src/state.js";
import {
  SCENARIOS, findScenario, scenarioObjectives, scenarioProgress,
  scenarioMedal, evaluateScenario,
  MEDAL_EMOJI, SCENARIO_RECORDS_KEY,
  loadScenarioRecords, saveScenarioRecords, recordScenarioResult
} from "../src/scenarios.js";

const makeState = (id) => {
  const city = createCity("V34-" + id);
  return createState(city, findScenario(id));
};
const logs = [];
const log = (m) => logs.push(m);
const metrics = { net: 0, currentSatisfaction: 100 };

// --- 1. Structure des scénarios ------------------------------------------------
{
  const ids = SCENARIOS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "ids uniques");
  for (const s of SCENARIOS) {
    assert.ok(s.name && s.difficulty, s.id + " : nom + difficulté");
    assert.ok(s.description, s.id + " : description");
    if (s.id === "sandbox") {
      assert.equal(scenarioObjectives(s).length, 0, "sandbox sans objectif");
      assert.equal(s.objective, null, "sandbox : objective alias null");
    } else {
      assert.ok(scenarioObjectives(s).length >= 1, s.id + " : >= 1 objectif");
      assert.deepEqual(s.objective, s.objectives[0], s.id + " : alias objective = objectives[0]");
      assert.ok(s.durationDays > 0, s.id + " : durée définie");
      for (const o of s.objectives) {
        assert.ok(o.label, s.id + " : chaque objectif a un label");
      }
    }
  }
  assert.ok(SCENARIOS.some((s) => s.id === "cap-sur-le-metro"), "nouveau défi métro");
  assert.ok(SCENARIOS.some((s) => s.id === "ville-qui-grandit"), "nouveau défi croissance");
  assert.deepEqual(MEDAL_EMOJI, { gold: "🥇", silver: "🥈", bronze: "🥉" }, "émojis médailles");
}

// --- 2. Progression multi-objectifs ---------------------------------------------
{
  const state = makeState("premiers-pas");
  state.totalArrived = 100;
  const p = scenarioProgress(state, metrics);
  assert.equal(p.overall, 0.2, "overall = min des progressions");
  assert.equal(p.items[0].progress, 0.2, "progression transported");
  assert.equal(p.items[0].done, false, "pas encore atteint");

  const state2 = makeState("expansion-express");
  state2.totalArrived = 250;
  const p2 = scenarioProgress(state2, { net: 10000, currentSatisfaction: 100 });
  assert.equal(p2.overall, 0.5, "min(0.5 net, 1.0 transported) = 0.5");
  assert.equal(p2.items[0].progress, 0.5, "netBalance à 50 %");
  assert.equal(p2.items[1].done, true, "transported atteint");

  const state3 = makeState("cap-sur-le-metro");
  state3.lines.push({ id: 1, mode: "metro" });
  const p3 = scenarioProgress(state3, metrics);
  assert.equal(p3.items[0].done, true, "ligne de métro ouverte");
  assert.equal(p3.items[0].progress, 1, "lineOfType complet");
  assert.equal(p3.overall, 0, "transported encore à 0");
  assert.equal(scenarioProgress(makeState("sandbox"), metrics), null, "sandbox -> null");
}

// --- 3. Médailles selon la marge de temps ---------------------------------------
{
  const state = makeState("premiers-pas"); // durée 12 j
  state.totalArrived = 500;
  state.elapsedDays = 5; // jour 6 : 6/12 = 0.5 <= 0.7 -> or
  assert.equal(scenarioMedal(state.scenario, state).id, "gold", "or : large marge");
  state.elapsedDays = 8; // jour 9 : 0.75 -> argent
  assert.equal(scenarioMedal(state.scenario, state).id, "silver", "argent : marge réduite");
  state.elapsedDays = 11; // jour 12 : 1.0 -> bronze
  assert.equal(scenarioMedal(state.scenario, state).id, "bronze", "bronze : dernier jour");
  assert.equal(scenarioMedal(findScenario("sandbox"), state), null, "sans durée -> pas de médaille");
}

// --- 4. evaluateScenario : victoire, échec contrainte, échec délai --------------
{
  logs.length = 0;
  const state = makeState("cap-sur-le-metro");
  state.lines.push({ id: 1, mode: "metro" });
  state.totalArrived = 400;
  state.elapsedDays = 2;
  evaluateScenario(state, log, metrics);
  assert.equal(state.scenario.status, "won", "tous objectifs atteints -> victoire");
  assert.equal(state.scenario.medal.id, "gold", "victoire précoce -> or");
  assert.ok(logs.some((m) => m.includes("Défi réussi")), "log de victoire");

  const state2 = makeState("crise-infrastructure");
  state2.totalArrived = 0;
  state2.elapsedDays = 3;
  evaluateScenario(state2, log, { net: 0, currentSatisfaction: 49 });
  assert.equal(state2.scenario.status, "lost", "satisfaction 49 < 50 -> échec immédiat");
  assert.ok(state2.scenario.status === "lost", "perdu avant le délai");

  const state3 = makeState("expansion-express");
  state3.totalArrived = 0;
  state3.elapsedDays = 15;
  evaluateScenario(state3, log, { net: 0, currentSatisfaction: 100 });
  assert.equal(state3.scenario.status, "lost", "délai dépassé sans victoire -> échec");
  assert.ok(logs.some((m) => m.includes("délai dépassé")), "log de délai dépassé");

  // Un objectif atteint seul ne suffit pas (expansion : transported ok, net non)
  const state4 = makeState("expansion-express");
  state4.totalArrived = 250;
  state4.elapsedDays = 5;
  evaluateScenario(state4, log, { net: 1000, currentSatisfaction: 100 });
  assert.equal(state4.scenario.status, "active", "un objectif sur deux -> toujours actif");
}

// --- 5. Compatibilité ancien format (sauvegarde V33 mono-objectif) ----------------
{
  const state = makeState("premiers-pas");
  // Simuler une sauvegarde V33 : scenario avec "objective" seul.
  state.scenario = {
    id: "premiers-pas",
    name: "Premiers pas",
    difficulty: "Facile",
    durationDays: 12,
    status: "active",
    objective: { type: "transported", target: 500, label: "Transporter 500 passagers" }
  };
  assert.equal(scenarioObjectives(state.scenario).length, 1, "repli sur objective");
  state.totalArrived = 500;
  state.elapsedDays = 4;
  evaluateScenario(state, log, metrics);
  assert.equal(state.scenario.status, "won", "l'ancien format reste jouable");
}

// --- 6. Records (pur, sans localStorage en Node) --------------------------------
{
  assert.equal(SCENARIO_RECORDS_KEY, "vietlignes-scenario-records-v1", "clé dédiée hors sauvegarde");
  assert.deepEqual(loadScenarioRecords(), {}, "Node : pas de localStorage -> {}");
  assert.equal(saveScenarioRecords({}), false, "Node : écriture ignorée proprement");
  let records = recordScenarioResult({}, "premiers-pas", { status: "won", medal: "silver", day: 6 });
  assert.equal(records["premiers-pas"].medal, "silver", "premier record");
  records = recordScenarioResult(records, "premiers-pas", { status: "won", medal: "bronze", day: 3 });
  assert.equal(records["premiers-pas"].medal, "silver", "bronze n'écrase pas argent");
  records = recordScenarioResult(records, "premiers-pas", { status: "won", medal: "gold", day: 9 });
  assert.equal(records["premiers-pas"].medal, "gold", "or écrase argent");
  assert.equal(records["premiers-pas"].day, 9, "jour de l'or conservé");
  records = recordScenarioResult(records, "premiers-pas", { status: "lost", medal: null, day: 2 });
  assert.equal(records["premiers-pas"].status, "won", "un échec n'écrase jamais une victoire");
  records = recordScenarioResult(records, "crise-infrastructure", { status: "lost", medal: null, day: 4 });
  assert.equal(records["crise-infrastructure"].status, "lost", "échec enregistré faute de mieux");
}

// --- 7. Câblage statique ----------------------------------------------------------
{
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const mainjs = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const enginejs = readFileSync(new URL("../src/engine.js", import.meta.url), "utf8");
  const changes = readFileSync(new URL("../CHANGES.md", import.meta.url), "utf8");
  assert.ok(enginejs.includes("evaluateScenario(state, log, { net: networkFinancials(state).net, currentSatisfaction: satisfaction(state) })"),
    "engine appelle toujours evaluateScenario avec les mêmes métriques");
  assert.ok(mainjs.includes("scenarioObjectives("), "banner lit les objectifs normalisés");
  assert.ok(mainjs.includes("recordScenarioResult("), "record câblé dans le banner");
  assert.ok(mainjs.includes("MEDAL_EMOJI"), "médailles affichées");
  assert.ok(mainjs.includes("Défi « "), "log de boot liste les objectifs");
  const versions = [...html.matchAll(/\?v=(\d+)/g)].map((m) => m[1]);
  assert.equal(new Set(versions).size, 1, "anti-cache uniforme");
  assert.ok(Number(versions[0]) >= 40, "anti-cache bumpé (v40)");
  assert.ok(changes.includes("## V34"), "CHANGES documente la V34");
}

console.log(JSON.stringify({ ok: true, suite: "v34-scenarios" }));
