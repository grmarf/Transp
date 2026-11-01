// V31 — Web Worker : avance rapide d'un jour.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCity, mulberry32 } from "../src/city.js";
import { createState } from "../src/state.js";
import { createNetwork } from "../src/network.js";
import { fastForwardState } from "../src/worker-core.js";
import { fastForwardDay, workerSupported } from "../src/worker-client.js";
// Le module du worker doit rester importable hors navigateur (garde typeof).
import "../src/engine-worker.js";

const makeState = () => {
  const city = createCity("V31-WORKER");
  const state = createState(city);
  state.network = createNetwork(city);
  return state;
};

// --- 1. Une avance rapide simule exactement une journée ---------------------
{
  const state = makeState();
  const day0 = state.elapsedDays;
  const res = fastForwardState(state, 1234, 144);
  assert.equal(res.ticks, 144, "144 ticks = 1 jour (TICK_MINUTES = 10)");
  assert.equal(state.elapsedDays, day0 + 1, "exactement un jour écoulé");
  assert.ok(state.time >= 0 && state.time < 1440, "heure ramenée dans la journée");
  // Le résultat doit être transférable (structured clone = ce que fait postMessage).
  const clone = structuredClone(state);
  assert.equal(clone.elapsedDays, day0 + 1, "l'état reste clonable après simulation");
}

// --- 2. Déterminisme : même état initial + même graine -> même résultat ------
{
  const a = makeState();
  const b = structuredClone(a);
  fastForwardState(a, 42, 144);
  fastForwardState(b, 42, 144);
  assert.equal(a.money, b.money, "même graine, même budget");
  assert.equal(a.elapsedDays, b.elapsedDays, "même graine, même jour");
}

// --- 3. Les drapeaux paused/speed du joueur sont restaurés -----------------
{
  const state = makeState();
  state.paused = true;
  state.speed = 1000;
  fastForwardState(state, 7, 144);
  assert.equal(state.paused, true, "pause restaurée");
  assert.equal(state.speed, 1000, "vitesse restaurée");
  assert.equal(state.elapsedDays, 1, "les ticks ont tourné malgré la pause d'origine");
}

// --- 4. Client : repli synchrone propre quand Worker est absent (Node) ------
{
  const state = makeState();
  assert.equal(workerSupported(), false, "pas de Worker sous Node");
  let done = null;
  const mode = fastForwardDay(state, 99, 144, function (r, m) { done = { r, m }; });
  assert.equal(mode, "sync", "repli synchrone signalé");
  assert.ok(done && done.r && done.r.state === state, "l'état simulé est renvoyé");
  assert.equal(done.m, "sync", "mode rapporté au rappel");
  assert.equal(state.elapsedDays, 1, "la simulation a bien tourné");

  let threw = false;
  try { fastForwardDay(state, 1, 1, null); } catch (e) { threw = true; }
  assert.ok(threw, "rappel manquant -> erreur explicite");
}

// --- 5. Câblage statique : bouton, worker module, anti-cache ----------------
{
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const mainjs = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const clientjs = readFileSync(new URL("../src/worker-client.js", import.meta.url), "utf8");
  const workerjs = readFileSync(new URL("../src/engine-worker.js", import.meta.url), "utf8");
  const changes = readFileSync(new URL("../CHANGES.md", import.meta.url), "utf8");
  assert.ok(html.includes('id="ffBtn"'), "bouton avance rapide dans le shell");
  for (const m of ["./src/worker-core.js", "./src/engine-worker.js", "./src/worker-client.js"]) {
    assert.ok(html.includes(m), "module " + m + " vérifié par le shell");
  }
  assert.ok(mainjs.includes("fastForwardOneDay"), "gestionnaire d'avance rapide câblé");
  assert.ok(mainjs.includes("fastForwardDay"), "appel au client worker");
  assert.ok(clientjs.includes('new Worker("./engine-worker.js", { type: "module" })'), "worker ES module");
  assert.ok(clientjs.includes("typeof Worker") && clientjs.includes('"sync"'), "repli synchrone prévu");
  assert.ok(workerjs.includes("fastForwardState") && workerjs.includes("typeof self"), "protocole worker gardé");
  const versions = [...html.matchAll(/\?v=(\d+)/g)].map((m) => m[1]);
  assert.equal(new Set(versions).size, 1, "anti-cache uniforme");
  assert.ok(Number(versions[0]) >= 38, "anti-cache bumpé (v38)");
  assert.ok(changes.includes("## V31"), "CHANGES documente la V31");
}

console.log(JSON.stringify({ ok: true, suite: "v31-worker" }));
