// V33 — mode planification : file de travaux, paiement atomique, abandon gratuit.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCity } from "../src/city.js";
import { createState } from "../src/state.js";
import { createNetwork, routeLine } from "../src/network.js";
import { createLine, finishLine } from "../src/engine.js";
import { buildStop, STOP_BUILD_COST } from "../src/stops.js";
import { planTotalCost, applyPlan, clearPlan } from "../src/planning.js";

const log = () => {};

const makeState = () => {
  const city = createCity("V33-PLAN");
  const state = createState(city);
  state.network = createNetwork(city);
  return state;
};

const freeSpot = (state) => {
  for (let y = 60; y <= 440; y += 20) {
    for (let x = 60; x <= 900; x += 20) {
      let ok = true;
      for (const s of state.city.stops) {
        if (Math.hypot(s.x - x, s.y - y) < 80) { ok = false; break; }
      }
      if (ok) return { x, y };
    }
  }
  return null;
};

// --- 1. Totaux & paiement atomique ------------------------------------------
{
  const state = makeState();
  const queue = [
    { kind: "road", roadId: "built-road-1", cost: 900 },
    { kind: "stop", stopId: "stop-99", cost: STOP_BUILD_COST }
  ];
  assert.equal(planTotalCost(queue), 900 + STOP_BUILD_COST, "total de la file");
  state.money = 1000;
  assert.equal(applyPlan(state, queue, log), false, "budget insuffisant -> refus");
  assert.equal(state.money, 1000, "refus ne débite rien");
  state.money = 5000;
  assert.equal(applyPlan(state, queue, log), true, "budget suffisant -> validé");
  assert.equal(state.money, 5000 - 900 - STOP_BUILD_COST, "paiement atomique");
  assert.equal(applyPlan(state, [], log), true, "file vide -> validée sans frais");
  const gone = [{ kind: "stop", stopId: "stop-inconnu", cost: STOP_BUILD_COST }];
  const money = state.money;
  assert.equal(applyPlan(state, gone, log), true, "entrée orpheline ignorée");
  assert.equal(state.money, money, "rien facturé pour une entrée orpheline");
}

// --- 2. Abandon : retrait gratuit routes + arrêts planifiés ------------------
{
  const state = makeState();
  const spot = freeSpot(state);
  assert.ok(spot, "position libre");
  const road = { id: "built-road-1", start: { x: spot.x, y: spot.y }, end: { x: spot.x + 200, y: spot.y }, type: "street", cost: 900 };
  state.city.roads.push(road);
  const money0 = state.money;
  const stop = buildStop(state, spot.x, spot.y + 150, log, { free: true });
  assert.ok(stop, "arrêt posé gratuitement en mode plan");
  assert.equal(state.money, money0, "aucun débit à la pose");
  const queue = [
    { kind: "road", roadId: road.id, cost: 900 },
    { kind: "stop", stopId: stop.id, cost: STOP_BUILD_COST }
  ];
  const removed = clearPlan(state, queue, log);
  assert.equal(removed, 2, "deux travaux retirés");
  assert.ok(!state.city.roads.some(r => r.id === road.id), "route planifiée retirée");
  assert.ok(!state.city.stops.some(s => s.id === stop.id), "arrêt planifié retiré");
  assert.equal(state.money, money0, "abandon sans frais");
}

// --- 3. Conservatisme : un arrêt devenu desservi est conservé ----------------
{
  const state = makeState();
  const [a, b] = state.city.stops.slice(0, 2).map(s => s.id);
  createLine(state);
  state.pendingStops = [a, b];
  assert.equal(finishLine(state, log, routeLine, "bus"), true, "ligne créée");
  const queue = [{ kind: "stop", stopId: a, cost: STOP_BUILD_COST }];
  assert.equal(clearPlan(state, queue, log), 0, "arrêt desservi conservé à l'abandon");
  assert.ok(state.city.stops.some(s => s.id === a), "l'arrêt reste en place");
}

// --- 4. buildStop option free : rétrocompatible ------------------------------
{
  const state = makeState();
  const spot = freeSpot(state);
  state.money = STOP_BUILD_COST;
  const paid = buildStop(state, spot.x, spot.y, log);
  assert.ok(paid, "pose payée");
  assert.equal(state.money, 0, "coût débité sans options");
  state.money = 0;
  const spot2 = freeSpot(state);
  assert.ok(spot2, "seconde position libre");
  const freeStop = buildStop(state, spot2.x, spot2.y, log, { free: true });
  assert.ok(freeStop, "pose gratuite possible sans fonds");
  assert.equal(state.money, 0, "aucun débit avec l'option free");
}

// --- 5. Câblage statique ------------------------------------------------------
{
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const mainjs = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const statejs = readFileSync(new URL("../src/state.js", import.meta.url), "utf8");
  const changes = readFileSync(new URL("../CHANGES.md", import.meta.url), "utf8");
  for (const id of ["planModeBtn", "planApplyBtn", "planClearBtn"]) {
    assert.ok(html.includes('id="' + id + '"'), "bouton " + id + " dans le shell");
  }
  assert.ok(html.includes("./src/planning.js"), "planning.js vérifié par le shell");
  assert.ok(mainjs.includes("setPlanMode"), "bascule du mode plan câblée");
  assert.ok(mainjs.includes("planTotalCost(state.planQueue"), "total affiché dans les instructions");
  assert.ok(mainjs.includes("applyPlan(state, state.planQueue"), "validation câblée");
  assert.ok(mainjs.includes("clearPlan(state, state.planQueue"), "abandon câblé");
  assert.ok(statejs.includes("planMode: false"), "état planMode initialisé");
  const versions = [...html.matchAll(/\?v=(\d+)/g)].map((m) => m[1]);
  assert.equal(new Set(versions).size, 1, "anti-cache uniforme");
  assert.ok(Number(versions[0]) >= 39, "anti-cache bumpé (v39)");
  assert.ok(changes.includes("## V33"), "CHANGES documente la V33");
}

console.log(JSON.stringify({ ok: true, suite: "v33-plan-mode" }));
