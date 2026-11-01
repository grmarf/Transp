// V30 — gestion des arrêts : construction, démolition, multimodalité.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCity, mulberry32 } from "../src/city.js";
import { createState } from "../src/state.js";
import { createNetwork, routeLine } from "../src/network.js";
import { createLine, finishLine, step } from "../src/engine.js";
import { PASSENGER_STATES, createPassenger } from "../src/passengers.js";
import {
  canBuildStop, buildStop, canDemolishStop, demolishStop,
  upgradeStopMultimodal, downgradeStopMultimodal,
  STOP_BUILD_COST, MULTIMODAL_UPGRADE_COST, MIN_STOP_SPACING
} from "../src/stops.js";

const log = () => {};

const makeState = () => {
  const city = createCity("V30-STOPS");
  const state = createState(city);
  state.network = createNetwork(city);
  return state;
};

// --- 1. Construction : validation et refus motivés -------------------------
{
  const state = makeState();
  const s0 = state.city.stops[0];
  assert.equal(canBuildStop(state, s0.x, s0.y).ok, false, "trop proche -> refus");
  assert.ok(canBuildStop(state, s0.x, s0.y).reason.includes("trop proche"), "motif lisible");
  assert.equal(canBuildStop(state, -50, 100).ok, false, "hors territoire -> refus");
  const far = { x: Math.min(900, s0.x + MIN_STOP_SPACING * 2), y: Math.min(600, s0.y + MIN_STOP_SPACING * 2) };
  assert.equal(canBuildStop(state, far.x, far.y).ok, true, "position libre -> ok");
  const money0 = state.money;
  const stop = buildStop(state, far.x, far.y, log);
  assert.ok(stop, "arrêt construit");
  assert.equal(state.money, money0 - STOP_BUILD_COST, "coût débité");
  assert.ok(state.city.stops.some(s => s.id === stop.id), "arrêt dans la ville");
  assert.equal(state.city.stops.filter(s => s.id === stop.id).length, 1, "id unique");
  assert.equal(buildStop(state, far.x + 5, far.y + 5, log), null, "doublon trop proche -> refus");
  assert.equal(state.money, money0 - STOP_BUILD_COST, "refus ne coûte rien");
  state.money = 0;
  assert.equal(canBuildStop(state, 500, 500).ok, false, "fonds insuffisants -> refus");
  assert.equal(buildStop(state, 500, 500, log), null, "construction sans fonds -> null");
}

// --- 2. Suppression : refus si desservi, nettoyage sinon --------------------
{
  const state = makeState();
  const [a, b] = state.city.stops.slice(0, 2).map(s => s.id);
  createLine(state);
  state.pendingStops = [a, b];
  assert.equal(finishLine(state, log, routeLine, "bus"), true, "ligne créée");
  assert.equal(canDemolishStop(state, a).ok, false, "arrêt desservi -> refus");
  assert.ok(canDemolishStop(state, a).reason.includes("Ligne 1"), "motif nomme la ligne");
  assert.equal(demolishStop(state, a, log), false, "démolition refusée");

  const s3 = state.city.stops[2];
  const passenger = createPassenger({ id: 1, originId: s3.id, destinationId: s3.id });
  passenger.currentStopId = s3.id;
  state.passengers.push(passenger);
  const roadsBefore = state.city.roads.length;
  assert.equal(demolishStop(state, s3.id, log), true, "arrêt libre démoli");
  assert.ok(!state.city.stops.some(s => s.id === s3.id), "arrêt retiré");
  assert.ok(state.city.roads.length <= roadsBefore, "voirie raccordée supprimée");
  assert.ok(state.city.roads.every(r => r.a !== s3.id && r.b !== s3.id), "plus de voirie pendante");
  assert.equal(passenger.state, PASSENGER_STATES.ABANDONED, "passager en attente abandonné");
  assert.equal(state.totalAbandoned, 1, "abandon compté");

  state.pendingStops = [state.city.stops[0].id];
  assert.equal(canDemolishStop(state, state.city.stops[0].id).ok, false, "tracé en cours -> refus");
}

// --- 3. Multimodal : upgrade, bonus, rétrogradation -------------------------
{
  const state = makeState();
  const stop = state.city.stops[0];
  state.money = 100;
  assert.equal(upgradeStopMultimodal(state, stop.id, log), false, "sans fonds -> refus");
  state.money = MULTIMODAL_UPGRADE_COST;
  assert.equal(upgradeStopMultimodal(state, stop.id, log), true, "upgrade ok");
  assert.equal(state.money, 0, "coût upgrade débité");
  assert.equal(stop.multimodal, true, "drapeau posé");
  assert.equal(upgradeStopMultimodal(state, stop.id, log), false, "double upgrade refusé");

  // Bonus : une correspondance à un arrêt multimodal attend deux fois moins vite.
  const waiting = createPassenger({ id: 2, originId: stop.id, destinationId: state.city.stops[1].id });
  waiting.currentStopId = stop.id;
  waiting.state = PASSENGER_STATES.TRANSFERRING;
  waiting.waitedMinutes = 0;
  state.passengers.push(waiting);
  step(state, mulberry32(42), log);
  assert.ok(waiting.waitedMinutes >= 4.99 && waiting.waitedMinutes <= 5.01,
    "correspondance multimodale : demi-tick (" + waiting.waitedMinutes + " min)");

  // Sans multimodal : tick complet.
  const state2 = makeState();
  const waiting2 = createPassenger({ id: 3, originId: state2.city.stops[0].id, destinationId: state2.city.stops[1].id });
  waiting2.currentStopId = state2.city.stops[0].id;
  waiting2.state = PASSENGER_STATES.TRANSFERRING;
  waiting2.waitedMinutes = 0;
  state2.passengers.push(waiting2);
  step(state2, mulberry32(42), log);
  assert.ok(waiting2.waitedMinutes >= 9.99, "correspondance simple : tick complet");

  const moneyBefore = state.money;
  assert.equal(downgradeStopMultimodal(state, stop.id, log), true, "rétrogradation ok");
  assert.equal(stop.multimodal, false, "drapeau retiré");
  assert.equal(state.money, moneyBefore + Math.round(MULTIMODAL_UPGRADE_COST * 0.5), "remboursement 50 %");
}

// --- 4. Câblage statique : UI, moteur, rendu, anti-cache --------------------
{
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const mainjs = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const rendererjs = readFileSync(new URL("../src/renderer.js", import.meta.url), "utf8");
  const enginejs = readFileSync(new URL("../src/engine.js", import.meta.url), "utf8");
  for (const id of ["buildStopBtn", "demolishStopBtn", "multimodalStopBtn"]) {
    assert.ok(html.includes('id="' + id + '"'), "bouton " + id + " dans le shell");
  }
  assert.ok(mainjs.includes('"arrets"'), "page Arrêts dans le menu en cascade");
  assert.ok(mainjs.includes("stopToolMode"), "état stopToolMode câblé");
  assert.ok(mainjs.includes("handleStopToolTap"), "tap routé vers l'outil arrêt");
  assert.ok(rendererjs.includes("s.multimodal"), "rendu du pôle multimodal");
  assert.ok(enginejs.includes("waitFactor"), "bonus d'attente appliqué au moteur");
  assert.ok(enginejs.includes("destination.multimodal ? 1.2 : 1"), "bonus d'attractivité appliqué");
  const versions = [...html.matchAll(/\?v=(\d+)/g)].map((m) => m[1]);
  assert.equal(new Set(versions).size, 1, "tous les assets partagent la même version");
  assert.ok(Number(versions[0]) >= 37, "anti-cache bumpé (v37)");
}

console.log(JSON.stringify({ ok: true, suite: "v30-stops" }));
