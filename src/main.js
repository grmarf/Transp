import { createCity, createSeedFromQuery, mulberry32 } from "./city.js";
import { createState } from "./state.js";
import { SCENARIOS, findScenario, scenarioProgress } from "./scenarios.js";
import { createLine, cancelLineMode, finishLine, startExtendLine, finishExtendLine, step, STOP_RADIUS, buyVehicleForLine, sellVehicleFromLine, deleteLine, networkFinancials, congestionHeatmap, cityJournal, intermodalStats } from "./engine.js";
import { createNetwork, routeLine, createUndergroundNetwork } from "./network.js";
import { createRenderer } from "./renderer.js";
import { saveGame, readSavedGame, SAVE_KEY, exportGameToFile, importGameFromFile } from "./persistence.js";
import { escapeHtml as h } from "./html.js";

const canvas = document.getElementById("map");
const rendererState = { current: null };
let state = null;
let rng = null;
let timer = null;
let bootCount = 0;

function log(msg) {
  state.logs.unshift(`[${formatTime()}] ${msg}`);
  state.logs = state.logs.slice(0, 30);
}

function formatTime() {
  const h = Math.floor(state.time / 60) % 24;
  const m = Math.floor(state.time % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// UI only: never initializes/restarts the game.
function updateInstructions() {
  const el = document.getElementById("instructions");
  const finish = document.getElementById("finishLineBtn");
  const extending = !!state.extendingLineId;
  const minStops = extending ? 1 : 2;
  const ready = state.lineMode && state.pendingStops.length >= minStops;

  if (state.lineMode) {
    if (extending) {
      const line = state.lines.find(l => l.id === state.extendingLineId);
      el.innerHTML = ready
        ? `Extension de ${h(line?.name ?? "la ligne")} : touchez ✓ pour valider les nouveaux arrêts.`
        : `Extension de ${h(line?.name ?? "la ligne")} : touchez <b>1 ou plusieurs arrêts</b> à ajouter en fin de ligne.`;
    } else {
      el.innerHTML = ready
        ? "Mode création : plusieurs arrêts sélectionnés. Vous pouvez terminer la ligne."
        : "Mode création : touchez <b>2 arrêts minimum</b> dans l'ordre pour créer la ligne.";
    }
  } else {
    el.textContent = "V3.0 : créez des lignes et ajoutez des véhicules pour augmenter leur fréquence. V4.0 : chaque ligne a ses propres recettes et dépenses.";
  }

  finish.hidden = !ready;
  finish.disabled = !ready;
  document.getElementById("newLineBtn").textContent = state.lineMode ? "✕ Annuler la ligne" : "＋ Nouvelle ligne";
}

function bindTap(el, handler) {
  if (!el) return;
  let lastTouch = 0;
  const invoke = e => {
    if (e?.type === "click" && Date.now() - lastTouch < 700) return;
    if (e?.type === "touchend" || e?.type === "pointerup") {
      lastTouch = Date.now();
      e.preventDefault?.();
    }
    handler(e);
  };

  if (window.PointerEvent) {
    el.addEventListener("pointerup", invoke, { passive: false });
    el.addEventListener("click", invoke);
  } else {
    el.addEventListener("touchend", invoke, { passive: false });
    el.addEventListener("click", invoke);
  }
}

function screenPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const source = e?.changedTouches?.[0] || e?.touches?.[0] || e;
  if (!source || !rect.width || !rect.height) return null;
  return {
    x: (source.clientX - rect.left) * (canvas.width / rect.width),
    y: (source.clientY - rect.top) * (canvas.height / rect.height)
  };
}

function clickMap(e) {
  const p = screenPoint(e);
  if (!p || !state) return;

  let nearest = null;
  let best = Infinity;
  // Use the logical Canvas coordinate system, so CSS scaling/Android DPR does not matter.
  for (const stop of state.city.stops) {
    const d = Math.hypot(stop.x - p.x, stop.y - p.y);
    if (d <= STOP_RADIUS * 2.8 && d < best) {
      nearest = stop;
      best = d;
    }
  }
  if (!nearest) return;

  state.selectedStop = nearest.id;
  if (state.lineMode && !state.pendingStops.includes(nearest.id)) {
    state.pendingStops.push(nearest.id);
  }

  updateInstructions();
  refreshUI();
}

function bindMap() {
  let lastTap = 0;
  const handle = e => {
    const now = Date.now();
    if (now - lastTap < 500) return;
    lastTap = now;
    e.preventDefault?.();
    clickMap(e);
  };

  if (window.PointerEvent) {
    canvas.addEventListener("pointerup", handle, { passive: false });
    canvas.addEventListener("click", handle);
  } else {
    canvas.addEventListener("touchend", handle, { passive: false });
    canvas.addEventListener("click", handle);
  }
  canvas.addEventListener("contextmenu", e => e.preventDefault());
  canvas.addEventListener("dragstart", e => e.preventDefault());
}

// V3.0 — line rows (and their "+ véhicule" buttons) are re-rendered on every
// tick, so a plain bindTap (which attaches once to a specific element) would
// stop working after the first render. Delegate from the stable container
// instead, keeping the same touch/click dedupe as bindTap.
function bindDelegatedTap(container, selector, handler) {
  if (!container) return;
  let lastTouch = 0;
  const invoke = e => {
    const target = e.target.closest?.(selector);
    if (!target || !container.contains(target)) return;
    if (e.type === "click" && Date.now() - lastTouch < 700) return;
    if (e.type === "touchend" || e.type === "pointerup") {
      lastTouch = Date.now();
      e.preventDefault?.();
    }
    handler(target, e);
  };

  if (window.PointerEvent) {
    container.addEventListener("pointerup", invoke, { passive: false });
    container.addEventListener("click", invoke);
  } else {
    container.addEventListener("touchend", invoke, { passive: false });
    container.addEventListener("click", invoke);
  }
}

function populateScenarioSelect() {
  const select = document.getElementById("scenarioSelect");
  select.innerHTML = SCENARIOS.map(s => `<option value="${h(s.id)}">${h(s.name)} (${h(s.difficulty)})</option>`).join("");
}

function refreshUI() {
  if (!state || !rendererState.current) return;
  state.journal = cityJournal(state);
  rendererState.current.render({ heatmap: state.showHeatmap ? congestionHeatmap(state) : null });
  updateScenarioBanner();
}

function updateScenarioBanner() {
  const banner = document.getElementById("scenarioBanner");
  const scenario = state.scenario;
  if (!scenario || !scenario.objective) { banner.hidden = true; return; }

  banner.hidden = false;
  banner.className = "scenario-banner" + (scenario.status !== "active" ? ` ${scenario.status}` : "");
  const progress = scenarioProgress(state, { net: networkFinancials(state).net }) ?? 0;
  const statusText = scenario.status === "won" ? "✅ Réussi"
    : scenario.status === "lost" ? "❌ Échoué"
    : `Jour ${(state.elapsedDays || 0) + 1}${scenario.durationDays ? `/${scenario.durationDays}` : ""}`;
  banner.innerHTML = `<div><b>${h(scenario.name)}</b> (${h(scenario.difficulty)}) — ${h(scenario.objective.label)} · ${h(statusText)}</div><div class="bar"><div style="width:${Math.round(progress * 100)}%"></div></div>`;
}

function boot(seed, scenarioId, restoredPayload = null) {
  bootCount += 1;
  let nextState;
  let nextRng;
  if (restoredPayload) {
    // Rebuild everything in a candidate state first. The current game keeps
    // running unchanged if a validated save still fails during reconstruction
    // or rendering.
    nextState = restoredPayload.state;
    nextState.network = createNetwork(nextState.city);
    const savedNetwork = restoredPayload.state.network;
    if (savedNetwork?.closedEdgeIds?.length) nextState.network.closedEdgeIds = new Set(savedNetwork.closedEdgeIds);
    if (savedNetwork?.roadworksReopenDay?.length) nextState.network.roadworksReopenDay = new Map(savedNetwork.roadworksReopenDay);
    nextState.network.pathCache.clear();
    // V13.0: rebuilt fresh from the current city (a complete graph over its
    // stops, no closures/roadworks ever apply to it) — nothing to restore.
    nextState.undergroundNetwork = createUndergroundNetwork(nextState.city);
    nextRng = mulberry32(nextState.city.numericSeed ^ 0xA57E2);
    if (restoredPayload.rngState != null && nextRng.setState) nextRng.setState(restoredPayload.rngState);
  } else {
    const scenario = findScenario(scenarioId || document.getElementById("scenarioSelect").value);
    const city = createCity(seed);
    nextState = createState(city, scenario.id === "sandbox" ? null : scenario);
    nextState.network = createNetwork(city);
    nextState.undergroundNetwork = createUndergroundNetwork(city);
    nextRng = mulberry32(city.numericSeed ^ 0xA57E2);
    // The initial game is trusted and the log helper writes to the new state.
    state = nextState;
    rng = nextRng;
    log(`Bienvenue. Votre budget initial est de ${state.money.toLocaleString("fr-FR")} €.`);
    log(`Ville générée avec la seed « ${city.seed} ».`);
    if (state.scenario?.objective) log(`Scénario : ${state.scenario.name} — ${state.scenario.objective.label}.`);
    log("V3.0 : fréquence, attente réelle et congestion actives.");
    log("V4.0 : bilan financier par ligne.");
    log("V5.0 : demande pilotée par population, emplois et commerces.");
    log("V6.0 : la ville évolue selon la qualité du réseau.");
    log("V8.0 : pannes et travaux routiers.");
    log("V9.0 : scénarios et difficulté.");
    log("V7.0 : bus, tramway ou métro.");
    log("V10.0 : sauvegarde locale versionnée et reprise déterministe.");
    log("V13.0 : le métro tunnelle indépendamment des routes de surface.");
    log("V14.1 : cache de routage et nettoyage des passagers terminés.");
    log("V14.2 : interface contrôlable et diagnostic heatmap.");
    log("V15.0 : événements urbains et demande dynamique.");
    log("V16.0 : progression, réputation et objectifs récompensés.");
  }

  nextState.eventsEnabled = true;
  nextState.activeEvents ||= [];
  nextState.eventHistory ||= [];
  nextState.nextEventId ||= 1;
  nextState.completedGoals ||= [];
  nextState.progressionHistory ||= [];
  nextState.reputation ||= 0;
  nextState.progressionEnabled = true;
  nextState.contractsEnabled = true;
  nextState.activeContracts ||= [];
  nextState.contractHistory ||= [];
  nextState.dailyReports ||= [];
  nextState.latestReport ||= null;
  nextState.seasonsEnabled = true;

  const nextRenderer = createRenderer(canvas, nextState);
  // Render before committing global state. A renderer-level failure therefore
  // cannot leave the application pointing at a half-loaded save.
  nextRenderer.render({ heatmap: nextState.showHeatmap ? congestionHeatmap(nextState) : null });

  if (timer) clearInterval(timer);
  timer = null;
  state = nextState;
  rng = nextRng;
  document.getElementById("seedInput").value = state.city.seed;
  document.getElementById("scenarioSelect").value = state.scenario?.id || "sandbox";
  document.getElementById("pauseBtn").textContent = state.paused ? "▶ Reprendre" : "⏸ Pause";
  document.getElementById("speedBtn").textContent = `▶ ${state.speed}×`;
  rendererState.current = nextRenderer;
  updateInstructions();
  document.getElementById("toggleHeatmapBtn")?.setAttribute("aria-pressed", String(!!state.showHeatmap));
  refreshUI();
  updateSaveStatus();

  timer = setInterval(() => {
    step(state, rng, log);
    refreshUI();
  }, 1000);
}

function updateSaveStatus(message = null) {
  const el = document.getElementById("saveStatus");
  const text = document.getElementById("saveStatusText");
  if (!el) return;
  if (message) { (text || el).textContent = message; return; }
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { (text || el).textContent = "Aucune sauvegarde locale."; return; }
    const payload = JSON.parse(raw);
    const date = payload.savedAt ? new Date(payload.savedAt).toLocaleString("fr-FR") : "date inconnue";
    (text || el).textContent = `Sauvegarde locale : ${date}`;
  } catch { (text || el).textContent = "Sauvegarde locale indisponible."; }
}

function setSaveActivity(active, label = "Sauvegarde…") {
  const activity = document.getElementById("saveActivity");
  if (!activity) return;
  activity.hidden = !active;
  activity.setAttribute("aria-hidden", String(!active));
  activity.textContent = label;
}

function saveCurrentGame() {
  try {
    saveGame(state, rng?.getState?.() ?? null);
    updateSaveStatus("Partie sauvegardée localement.");
    log("Partie sauvegardée.");
    refreshUI();
  } catch (error) {
    updateSaveStatus("Échec de la sauvegarde.");
    log(`Sauvegarde impossible : ${error.message}`);
  }
}

function loadCurrentGame() {
  try {
    const payload = readSavedGame();
    if (!payload) { updateSaveStatus("Aucune sauvegarde locale."); return; }
    boot(payload.state.city.seed, payload.state.scenario?.id || "sandbox", payload);
    updateSaveStatus("Partie chargée.");
  } catch (error) {
    updateSaveStatus("Sauvegarde invalide.");
    log(`Chargement impossible : ${error.message}`);
  }
}

bindTap(document.getElementById("newLineBtn"), () => {
  if (state.lineMode) cancelLineMode(state);
  else createLine(state);
  updateInstructions();
  refreshUI();
});

bindTap(document.getElementById("finishLineBtn"), () => {
  const minStops = state.extendingLineId ? 1 : 2;
  if (state.pendingStops.length < minStops) return;
  if (state.extendingLineId) finishExtendLine(state, log, routeLine);
  else finishLine(state, log, routeLine, document.getElementById("modeSelect").value);
  updateInstructions();
  refreshUI();
});

bindTap(document.getElementById("pauseBtn"), () => {
  state.paused = !state.paused;
  document.getElementById("pauseBtn").textContent = state.paused ? "▶ Reprendre" : "⏸ Pause";
  refreshUI();
});

bindTap(document.getElementById("speedBtn"), () => {
  state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 4 : state.speed === 4 ? 1000 : 1;
  document.getElementById("speedBtn").textContent = `▶ ${state.speed}×`;
  refreshUI();
});

bindTap(document.getElementById("saveBtn"), saveCurrentGame);
bindTap(document.getElementById("loadBtn"), loadCurrentGame);

bindTap(document.getElementById("newCityBtn"), () => {
  const input = document.getElementById("seedInput");
  const seed = input.value.trim() || `CITY-${Date.now()}`;
  boot(seed, document.getElementById("scenarioSelect").value);
});

bindMap();

bindDelegatedTap(document.getElementById("lines"), "[data-buy-vehicle]", target => {
  const lineId = Number(target.dataset.buyVehicle);
  buyVehicleForLine(state, lineId, log);
  refreshUI();
});

// V11.0 — line management: sell one vehicle off a line, or scrap the whole line.
bindDelegatedTap(document.getElementById("lines"), "[data-sell-vehicle]", target => {
  const lineId = Number(target.dataset.sellVehicle);
  const vehicleId = Number(target.dataset.vehicleId);
  sellVehicleFromLine(state, lineId, vehicleId, log);
  refreshUI();
});

bindDelegatedTap(document.getElementById("lines"), "[data-delete-line]", target => {
  const lineId = Number(target.dataset.deleteLine);
  const line = state.lines.find(l => l.id === lineId);
  if (line && !window.confirm?.(`Supprimer ${line.name} ? Les véhicules seront revendus.`)) return;
  deleteLine(state, lineId, log);
  refreshUI();
});

// V12.0 — line editing: start extend-mode, then reuse the normal map-tap /
// finishLineBtn flow (branched above) to pick and confirm the new stops.
bindDelegatedTap(document.getElementById("lines"), "[data-extend-line]", target => {
  const lineId = Number(target.dataset.extendLine);
  startExtendLine(state, lineId);
  updateInstructions();
  refreshUI();
});

bindTap(document.getElementById("toggleHeatmapBtn"), () => {
  state.showHeatmap = !state.showHeatmap;
  const button = document.getElementById("toggleHeatmapBtn");
  button?.setAttribute("aria-pressed", String(state.showHeatmap));
  refreshUI();
});

bindTap(document.getElementById("exportBtn"), () => {
  setSaveActivity(true, "Export…");
  try { exportGameToFile(state, rng?.getState?.() ?? null); }
  finally { setSaveActivity(false); }
});

document.getElementById("importFile")?.addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  setSaveActivity(true, "Import…");
  try {
    const payload = await importGameFromFile(file);
    boot(payload.state.city.seed, payload.state.scenario?.id || "sandbox", payload);
    log("Partie importée avec succès.");
    refreshUI();
  } catch (error) {
    log(`Échec de l'import : ${error.message}`);
  } finally {
    setSaveActivity(false);
    event.target.value = "";
  }
});

const initialSeed = createSeedFromQuery();
document.getElementById("seedInput").value = initialSeed;
populateScenarioSelect();
boot(initialSeed, "sandbox");

// Debug-only readout useful in automated/browser diagnostics.
window.__transportTycoon = {
  getState: () => state,
  getBootCount: () => bootCount,
  clickMap
};
