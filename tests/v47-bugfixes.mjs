// V47 — correctifs issus de l'audit : contrats (évaluation au dernier jour,
// id inconnu), rapport du jour et panneau contrats (champs exacts), CSS
// cassé recollé, avance rapide (interface gelée, aléa relayé), sauvegardes
// allégées, anti-cache v47 aligné sur le cache du service worker.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCity, mulberry32 } from "../src/city.js";
import { createState } from "../src/state.js";
import { createNetwork } from "../src/network.js";
import { step } from "../src/engine.js";
import { refreshContracts, contractSummary, evaluateContracts } from "../src/contracts.js";
import { fastForwardState } from "../src/worker-core.js";
import { serializeState } from "../src/persistence.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const log = () => {};

// --- 1. Contrats : un objectif atteint le dernier jour est récompensé ----
{
  const city = createCity("V47-CONTRACTS");
  const state = createState(city);
  state.network = createNetwork(city);
  state.contractsEnabled = true;
  state.contractCycle = -1; // première paire : ridership + service
  assert.equal(refreshContracts(state, 0), true);
  assert.equal(state.contractsEndDay, 3);
  state.totalArrived = 30; // objectif « Plan de fréquentation » (25) franchi
  state.elapsedDays = 2;   // dernier jour de validité (« encore 1 jour »)
  state.time = 1430;       // 10 minutes avant le passage de jour
  const moneyBefore = state.money;
  step(state, mulberry32(1), log); // franchit le jour 3 : évaluation PUIS renouvellement
  assert.equal(state.elapsedDays, 3, "le jour 3 est franchi");
  assert.ok(state.contractHistory.some(c => c.id === "ridership"),
    "un contrat atteint pendant son dernier jour doit être récompensé, pas remplacé avant évaluation");
  assert.ok(state.money >= moneyBefore + 1800, "la récompense (1800 €) est créditée");
  assert.equal(state.activeContracts.map(c => c.id).join("+"), "service+coverage",
    "la paire n'est renouvelée qu'après l'évaluation");
}

// --- 2. Contrats : id inconnu (sauvegarde éditée) sans crash --------------
{
  const state = createState(createCity("V47-ROBUST"));
  state.network = createNetwork(state.city);
  state.contractsEnabled = true;
  state.activeContracts = [{ id: "introuvable", cycle: 9, startedDay: 0, completed: false, baseline: 0 }];
  const summary = contractSummary(state, {});
  assert.equal(summary.length, 1, "contractSummary ne lève pas sur un id inconnu");
  assert.equal(summary[0].progress, 0, "progression neutre pour un id inconnu");
  const moneyBefore = state.money;
  evaluateContracts(state, {}, log);
  assert.equal(state.money, moneyBefore, "ni récompense ni corruption du budget (NaN)");
  assert.equal(state.contractHistory.length, 0, "aucune complétion enregistrée");
}

// --- 3. Rapport du jour et panneau contrats : champs exacts ---------------
{
  const renderer = read("src/renderer.js");
  assert.ok(renderer.includes("report.avgWaitMinutes"), "le panneau lit avgWaitMinutes (plus de NaN)");
  assert.ok(renderer.includes("report.abandonedCount"), "le panneau lit abandonedCount (plus de undefined)");
  assert.ok(!renderer.includes("Math.round(report.avgWait)") && !renderer.includes("report.abandoned +"),
    "plus de champs fantômes du rapport");
  assert.ok(renderer.includes("Math.round(c.progress * 100)"), "progression en pourcentage (0–1 → 0–100)");
  assert.ok(renderer.includes('(c.completed ? "completed" : "")'), "statut réellement branché sur completed");
}

// --- 4. style.css : déclarations cassées recollées + gel de l'interface ---
{
  const style = read("src/style.css");
  assert.ok(style.includes("overscroll-behavior: none;"), "overscroll-behavior recollé (scroll chaining bloqué)");
  assert.ok(style.includes("word-break: break-word;"), "word-break recollé");
  assert.ok(style.includes("font-weight:bold;"), "font-weight du badge recollé");
  assert.ok(!style.includes("overscr\n") && !style.includes("word-b\n") && !style.includes("font-w\neight"),
    "aucun saut de ligne en plein mot subsiste");
  assert.ok(style.includes("body.ff-busy"), "règle de gel de l'interface pendant l'avance rapide");
}

// --- 5. Avance rapide : interface gelée + aléa du worker relayé ----------
{
  const mainjs = read("src/main.js");
  assert.ok(mainjs.includes('classList.add("ff-busy")') && mainjs.includes('classList.remove("ff-busy")'),
    "l'interface est gelée pendant l'avance rapide puis rendue");
  assert.ok(mainjs.includes("if (ffBusy) return;"), "l'API de clic refuse d'agir pendant l'avance rapide");
  assert.ok(mainjs.includes("rngState: result.rngState"), "l'état du générateur du worker est relayé au boot");
  const workerCore = read("src/worker-core.js");
  assert.ok(workerCore.includes("rngState: rng.getState()"), "fastForwardState renvoie l'état du générateur");
  const state = createState(createCity("V47-FF"));
  state.network = createNetwork(state.city);
  const res = fastForwardState(state, 42, 144);
  assert.equal(res.ticks, 144, "144 ticks = 1 jour");
  assert.ok(Number.isFinite(res.rngState) && res.rngState >= 0, "rngState présent, fini et positif");
  assert.equal(state.elapsedDays, 1, "un jour simulé");
}

// --- 6. Sauvegardes : plus de JSON mort (grille foncière, piles voirie) ---
{
  const state = createState(createCity("V47-SAVE"));
  state.network = createNetwork(state.city);
  const payload = serializeState(state, 123);
  assert.ok(!("landValueGrid" in payload.state.city),
    "la grille de valeur foncière n'est plus sérialisée (Float32Array inutile en JSON, reconstruite au premier cycle horaire)");
  assert.ok(!("roadUndoStack" in payload.state) && !("roadRedoStack" in payload.state),
    "les piles d'annulation voirie ne sont plus sérialisées (remises à zéro au démarrage)");
  const asState = JSON.parse(JSON.stringify(payload)).state; // lecture identique à localStorage
  assert.ok(!asState.city.landValueGrid && !asState.roadUndoStack, "le JSON final ne contient ni grille ni piles");
}

// --- 7. Divers : anti-cache uniforme v47, cache SW aligné, coquille ------
{
  const index = read("index.html");
  const versions = [...index.matchAll(/\?v=(\d+)/g)].map(m => m[1]);
  assert.equal(new Set(versions).size, 1, "anti-cache uniforme");
  assert.equal(versions[0], "47", "anti-cache bumpé v47");
  const sw = read("sw.js");
  assert.ok(sw.includes("vtl-cache-v47"), "version de cache du service worker alignée");
  const carrefours = read("src/carrefours.js");
  assert.ok(!carrefours.includes("Carrefur"), "coquille « Carrefur » corrigée");
}

console.log(JSON.stringify({ ok: true, suite: "v47-bugfixes" }));
