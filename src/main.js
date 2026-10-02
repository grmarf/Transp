import { createCity, createSeedFromQuery, mulberry32 } from "./city.js";
import { createState } from "./state.js";
import { SCENARIOS, findScenario, scenarioProgress } from "./scenarios.js";
import {
  createLine,
  cancelLineMode,
  finishLine,
  startExtendLine,
  finishExtendLine,
  step,
  STOP_RADIUS,
  buyVehicleForLine,
  sellVehicleFromLine,
  deleteLine,
  networkFinancials,
  congestionHeatmap,
  cityJournal,
} from "./engine.js";
import { createNetwork, routeLine, createUndergroundNetwork } from "./network.js";
import { createRenderer } from "./renderer.js";
import { saveGame, readSavedGame, SAVE_KEY, exportGameToFile, importGameFromFile } from "./persistence.js";
import { escapeHtml as h } from "./html.js";

const canvas = document.getElementById("map");
const miniMapCanvas = document.getElementById("miniMapCanvas");
const rendererState = { current: null };
let state = null;
let rng = null;
let rafId = null;
let bootCount = 0;

// ---------------------------------------------------------------------------
// CAMERA
// cameraState.x / cameraState.y = coordonnées MONDE du CENTRE de l'écran.
// Tous les calculs d'input se font en pixels CSS (canvas.clientWidth/Height).
// ---------------------------------------------------------------------------
const cameraState = {
  x: 0,
  y: 0,
  zoom: 1,
  minZoom: 0.5,
  maxZoom: 3,
  isDragging: false,
  lastDragX: 0,
  lastDragY: 0,
  downX: 0,
  downY: 0,
  moved: false,
};

function log(msg) {
  if (!state) return;
  state.logs.unshift(`[${formatTime()}] ${msg}`);
  state.logs = state.logs.slice(0, 30);
}

function formatTime() {
  if (!state) return "00:00";
  const h = Math.floor(state.time / 60) % 24;
  const m = Math.floor(state.time % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function syncCameraToRenderer() {
  const renderer = rendererState.current;
  if (!renderer || !renderer.camera) return;
  renderer.camera.x = cameraState.x;
  renderer.camera.y = cameraState.y;
  renderer.camera.zoom = cameraState.zoom;
}

function getCanvasCssSize() {
  const rect = canvas.getBoundingClientRect();
  return { W: rect.width, H: rect.height, rect };
}

// Recentre la caméra sur le barycentre de la ville et ajuste le zoom pour
// que l'ensemble des arrêts tienne à l'écran. Corrige le "bloqué dans un coin".
function recenterCameraOnCity() {
  if (!state?.city?.stops?.length) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of state.city.stops) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  }
  cameraState.x = (minX + maxX) / 2;
  cameraState.y = (minY + maxY) / 2;

  const { W, H } = getCanvasCssSize();
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const fit = Math.min(W / spanX, H / spanY) * 0.85;
  cameraState.zoom = Math.max(cameraState.minZoom, Math.min(cameraState.maxZoom, fit));

  syncCameraToRenderer();
}

function resetCameraView() {
  recenterCameraOnCity();
  refreshUI();
}

function updateInstructions() {
  const el = document.getElementById("instructions");
  const finish = document.getElementById("finishLineBtn");
  if (!el || !state) return;

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

// Convertit un événement souris/tactile en coordonnées MONDE.
// sx, sy sont en pixels CSS relatifs au canvas.
function screenPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const source = e?.changedTouches?.[0] || e?.touches?.[0] || e;
  if (!source || !rect.width || !rect.height) return null;

  const sx = source.clientX - rect.left;
  const sy = source.clientY - rect.top;

  const W = rect.width;
  const H = rect.height;

  const worldX = (sx - W / 2) / cameraState.zoom + cameraState.x;
  const worldY = (sy - H / 2) / cameraState.zoom + cameraState.y;

  return { x: worldX, y: worldY };
}

function clickMap(e) {
  const p = screenPoint(e);
  if (!p || !state) return;

  let nearest = null;
  let best = Infinity;
  for (const stop of state.city.stops) {
    const d = Math.hypot(stop.x - p.x, stop.y - p.y);
    const HIT_RADIUS = Math.max(STOP_RADIUS * 2.8, 36);
    if (d <= HIT_RADIUS && d < best) {
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
  const pointerDown = e => {
    cameraState.isDragging = true;
    cameraState.lastDragX = e.clientX;
    cameraState.lastDragY = e.clientY;
    cameraState.downX = e.clientX;
    cameraState.downY = e.clientY;
    cameraState.moved = false;
  };

  const pointerMove = e => {
    if (!cameraState.isDragging) return;

    if (!cameraState.moved) {
      if (Math.hypot(e.clientX - cameraState.downX, e.clientY - cameraState.downY) > 4) {
        cameraState.moved = true;
      } else {
        return;
      }
    }

    const deltaX = e.clientX - cameraState.lastDragX;
    const deltaY = e.clientY - cameraState.lastDragY;

    cameraState.x -= deltaX / cameraState.zoom;
    cameraState.y -= deltaY / cameraState.zoom;

    cameraState.lastDragX = e.clientX;
    cameraState.lastDragY = e.clientY;

    syncCameraToRenderer();
    refreshUI();
  };

  const pointerUp = e => {
    const wasDragging = cameraState.isDragging;
    cameraState.isDragging = false;
    if (!wasDragging) return;
    if (cameraState.moved) return; // c'était un pan, pas un clic
    // Clic sans déplacement → sélection d'arrêt
    e.preventDefault?.();
    clickMap(e);
  };

  if (window.PointerEvent) {
    canvas.addEventListener("pointerdown", pointerDown, { passive: true });
    canvas.addEventListener("pointermove", pointerMove, { passive: true });
    canvas.addEventListener("pointerup", pointerUp, { passive: false });
    canvas.addEventListener("pointercancel", () => { cameraState.isDragging = false; }, { passive: true });
  } else {
    canvas.addEventListener("touchstart", pointerDown, { passive: true });
    canvas.addEventListener("touchmove", pointerMove, { passive: true });
    canvas.addEventListener("touchend", pointerUp, { passive: false });
    canvas.addEventListener("touchcancel", () => { cameraState.isDragging = false; }, { passive: true });
  }

  canvas.addEventListener("wheel", e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();

    const { rect, W, H } = getCanvasCssSize();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const oldZoom = cameraState.zoom;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(cameraState.minZoom, Math.min(cameraState.maxZoom, oldZoom * delta));
    if (newZoom === oldZoom) return;

    // Point monde sous la souris AVANT le zoom
    const wx = (sx - W / 2) / oldZoom + cameraState.x;
    const wy = (sy - H / 2) / oldZoom + cameraState.y;

    cameraState.zoom = newZoom;

    // On veut que (sx, sy) pointe encore sur (wx, wy) après le zoom
    cameraState.x = wx - (sx - W / 2) / newZoom;
    cameraState.y = wy - (sy - H / 2) / newZoom;

    syncCameraToRenderer();
    refreshUI();
  }, { passive: false });

  canvas.addEventListener("contextmenu", e => e.preventDefault());
  canvas.addEventListener("dragstart", e => e.preventDefault());
}

function bindZoomReset() {
  const resetBtn = document.getElementById("resetZoomBtn");
  if (!resetBtn) return;
  bindTap(resetBtn, resetCameraView);
}

// ---------------------------------------------------------------------------
// MINI MAP
// ---------------------------------------------------------------------------
function computeMiniMapTransform() {
  const stops = state.city.stops;
  const minX = Math.min(...stops.map(s => s.x));
  const maxX = Math.max(...stops.map(s => s.x));
  const minY = Math.min(...stops.map(s => s.y));
  const maxY = Math.max(...stops.map(s => s.y));
  const pad = 10;
  const scale = Math.min(
    (miniMapCanvas.width - pad * 2) / Math.max(1, maxX - minX),
    (miniMapCanvas.height - pad * 2) / Math.max(1, maxY - minY)
  );
  return { minX, maxX, minY, maxY, pad, scale };
}

function renderMiniMap() {
  if (!miniMapCanvas || !state) return;
  const stops = state.city.stops;
  if (!stops.length) return;

  const miniCtx = miniMapCanvas.getContext("2d");
  const { minX, minY, pad, scale } = computeMiniMapTransform();

  miniCtx.clearRect(0, 0, miniMapCanvas.width, miniMapCanvas.height);
  miniCtx.fillStyle = "#101a22";
  miniCtx.fillRect(0, 0, miniMapCanvas.width, miniMapCanvas.height);

  const worldToMini = (x, y) => ({
    x: pad + (x - minX) * scale,
    y: pad + (y - minY) * scale,
  });

  for (const line of state.lines) {
    if (!Array.isArray(line.route?.nodeIds) || line.route.nodeIds.length < 2) continue;
    miniCtx.beginPath();
    let first = true;
    for (const id of line.route.nodeIds) {
      const node = state.network.nodes.get(id);
      if (!node) continue;
      const point = worldToMini(node.x, node.y);
      if (first) {
        miniCtx.moveTo(point.x, point.y);
        first = false;
      } else {
        miniCtx.lineTo(point.x, point.y);
      }
    }
    miniCtx.strokeStyle = line.color || "#ffffff";
    miniCtx.lineWidth = 1.5;
    miniCtx.stroke();
  }

  for (const stop of stops) {
    const point = worldToMini(stop.x, stop.y);
    miniCtx.beginPath();
    miniCtx.fillStyle = stop.id === state.selectedStop ? "#ffffff" : "#7da7c9";
    miniCtx.arc(point.x, point.y, stop.id === state.selectedStop ? 2.5 : 2, 0, Math.PI * 2);
    miniCtx.fill();
  }

  // Rectangle de vue : camera.x/y = CENTRE monde de l'écran.
  const rectCss = canvas.getBoundingClientRect();
  const viewWidth = rectCss.width / cameraState.zoom;
  const viewHeight = rectCss.height / cameraState.zoom;
  const left = cameraState.x - viewWidth / 2;
  const top = cameraState.y - viewHeight / 2;
  const rect = {
    x: pad + (left - minX) * scale,
    y: pad + (top - minY) * scale,
    w: viewWidth * scale,
    h: viewHeight * scale,
  };

  miniCtx.strokeStyle = "#f6d365";
  miniCtx.lineWidth = 1.2;
  miniCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);
}

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
  if (!select) return;
  select.innerHTML = SCENARIOS.map(s => `<option value="${h(s.id)}">${h(s.name)} (${h(s.difficulty)})</option>`).join("");
}

function updateScenarioBanner() {
  const banner = document.getElementById("scenarioBanner");
  if (!banner || !state) return;

  const scenario = state.scenario;
  if (!scenario || !scenario.objective) {
    banner.hidden = true;
    return;
  }

  banner.hidden = false;
  banner.className = "scenario-banner" + (scenario.status !== "active" ? ` ${scenario.status}` : "");
  const progress = scenarioProgress(state, { net: networkFinancials(state).net }) ?? 0;
  const statusText = scenario.status === "won"
    ? "✅ Réussi"
    : scenario.status === "lost"
      ? "❌ Échoué"
      : `Jour ${(state.elapsedDays || 0) + 1}${scenario.durationDays ? `/${scenario.durationDays}` : ""}`;

  banner.innerHTML = `<div><b>${h(scenario.name)}</b> (${h(scenario.difficulty)}) — ${h(scenario.objective.label)} · ${h(statusText)}</div><div class="bar"><div style="width:${Math.round(progress * 100)}%"></div></div>`;
}

function refreshUI() {
  if (!state || !rendererState.current) return;
  state.journal = cityJournal(state);
  syncCameraToRenderer();
  rendererState.current.render({ heatmap: state.showHeatmap ? congestionHeatmap(state) : null, camera: cameraState });
  renderMiniMap();
  updateScenarioBanner();
}

// ---------------------------------------------------------------------------
// BOUCLE PRINCIPALE — requestAnimationFrame, step simulé à 1 Hz.
// ---------------------------------------------------------------------------
const STEP_INTERVAL_MS = 1000;
let accumulator = 0;
let lastTs = 0;

function loop(ts) {
  if (!state) { rafId = requestAnimationFrame(loop); return; }

  if (!lastTs) lastTs = ts;
  accumulator += ts - lastTs;
  lastTs = ts;

  // Rattrape jusqu'à 5 steps max par frame pour éviter la spirale de la mort
  let steps = 0;
  while (accumulator >= STEP_INTERVAL_MS && steps < 5) {
    accumulator -= STEP_INTERVAL_MS;
    steps++;
    if (!state.paused) {
      step(state, rng, log);
    }
  }
  if (accumulator > STEP_INTERVAL_MS * 5) accumulator = 0;

  refreshUI();
  rafId = requestAnimationFrame(loop);
}

function startLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  accumulator = 0;
  lastTs = 0;
  rafId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// BOOT
// ---------------------------------------------------------------------------
function boot(seed, scenarioId, restoredPayload = null) {
  bootCount += 1;
  let nextState;
  let nextRng;

  if (restoredPayload) {
    nextState = restoredPayload.state;
    nextState.network = createNetwork(nextState.city);
    const savedNetwork = restoredPayload.state.network;
    if (savedNetwork?.closedEdgeIds?.length) nextState.network.closedEdgeIds = new Set(savedNetwork.closedEdgeIds);
    if (savedNetwork?.roadworksReopenDay?.length) nextState.network.roadworksReopenDay = new Map(savedNetwork.roadworksReopenDay);
    nextState.network.pathCache.clear();
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

  state = nextState;
  rng = nextRng;
  rendererState.current = nextRenderer;

  // Recentre la caméra AVANT le premier rendu.
  recenterCameraOnCity();
  nextRenderer.render({
    heatmap: nextState.showHeatmap ? congestionHeatmap(nextState) : null,
    camera: cameraState,
  });

  const seedInput = document.getElementById("seedInput");
  if (seedInput) seedInput.value = state.city.seed;

  const scenarioSelect = document.getElementById("scenarioSelect");
  if (scenarioSelect) scenarioSelect.value = state.scenario?.id || "sandbox";

  const pauseBtn = document.getElementById("pauseBtn");
  if (pauseBtn) pauseBtn.textContent = state.paused ? "▶ Reprendre" : "⏸ Pause";

  const speedBtn = document.getElementById("speedBtn");
  if (speedBtn) speedBtn.textContent = `▶ ${state.speed}×`;

  syncCameraToRenderer();
  updateInstructions();
  const toggle = document.getElementById("toggleHeatmapBtn");
  if (toggle) toggle.setAttribute("aria-pressed", String(!!state.showHeatmap));
  refreshUI();
  updateSaveStatus();

  startLoop();
}

function updateSaveStatus(message = null) {
  const el = document.getElementById("saveStatus");
  const text = document.getElementById("saveStatusText");
  if (!el || !text) return;

  if (message) {
    text.textContent = message;
    return;
  }

  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) {
      text.textContent = "Aucune sauvegarde locale.";
      return;
    }
    const payload = JSON.parse(raw);
    const date = payload.savedAt ? new Date(payload.savedAt).toLocaleString("fr-FR") : "date inconnue";
    text.textContent = `Sauvegarde locale : ${date}`;
  } catch {
    text.textContent = "Sauvegarde locale indisponible.";
  }
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
    if (!payload) {
      updateSaveStatus("Aucune sauvegarde locale.");
      return;
    }
    boot(payload.state.city.seed, payload.state.scenario?.id || "sandbox", payload);
    updateSaveStatus("Partie chargée.");
  } catch (error) {
    updateSaveStatus("Sauvegarde invalide.");
    log(`Chargement impossible : ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// BINDINGS UI
// ---------------------------------------------------------------------------
bindTap(document.getElementById("newLineBtn"), () => {
  if (!state) return;
  if (state.lineMode) cancelLineMode(state);
  else createLine(state);
  updateInstructions();
  refreshUI();
});

bindTap(document.getElementById("finishLineBtn"), () => {
  if (!state) return;
  const minStops = state.extendingLineId ? 1 : 2;
  if (state.pendingStops.length < minStops) return;
  if (state.extendingLineId) finishExtendLine(state, log, routeLine);
  else finishLine(state, log, routeLine, document.getElementById("modeSelect").value);
  updateInstructions();
  refreshUI();
});

bindTap(document.getElementById("pauseBtn"), () => {
  if (!state) return;
  state.paused = !state.paused;
  document.getElementById("pauseBtn").textContent = state.paused ? "▶ Reprendre" : "⏸ Pause";
  refreshUI();
});

bindTap(document.getElementById("speedBtn"), () => {
  if (!state) return;
  state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 4 : state.speed === 4 ? 1000 : 1;
  document.getElementById("speedBtn").textContent = `▶ ${state.speed}×`;
  refreshUI();
});

bindTap(document.getElementById("resetZoomBtn"), resetCameraView);

bindTap(document.getElementById("saveBtn"), saveCurrentGame);
bindTap(document.getElementById("loadBtn"), loadCurrentGame);

bindTap(document.getElementById("newCityBtn"), () => {
  const input = document.getElementById("seedInput");
  const seed = input.value.trim() || `CITY-${Date.now()}`;
  boot(seed, document.getElementById("scenarioSelect").value);
});

bindMap();
bindZoomReset();

bindDelegatedTap(document.getElementById("lines"), "[data-buy-vehicle]", target => {
  const lineId = Number(target.dataset.buyVehicle);
  buyVehicleForLine(state, lineId, log);
  refreshUI();
});

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

bindDelegatedTap(document.getElementById("lines"), "[data-extend-line]", target => {
  const lineId = Number(target.dataset.extendLine);
  startExtendLine(state, lineId);
  updateInstructions();
  refreshUI();
});

bindTap(document.getElementById("toggleHeatmapBtn"), () => {
  if (!state) return;
  state.showHeatmap = !state.showHeatmap;
  const button = document.getElementById("toggleHeatmapBtn");
  button?.setAttribute("aria-pressed", String(state.showHeatmap));
  refreshUI();
});

bindTap(document.getElementById("exportBtn"), () => {
  setSaveActivity(true, "Export…");
  try {
    exportGameToFile(state, rng?.getState?.() ?? null);
  } finally {
    setSaveActivity(false);
  }
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

if (miniMapCanvas) {
  miniMapCanvas.addEventListener("click", e => {
    if (!state || !state.city.stops.length) return;
    const rect = miniMapCanvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * miniMapCanvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * miniMapCanvas.height;

    const { minX, minY, pad, scale } = computeMiniMapTransform();
    if (!scale || !isFinite(scale)) return;

    const worldX = minX + (x - pad) / scale;
    const worldY = minY + (y - pad) / scale;

    // camera.x/y = CENTRE monde de l'écran → on y place directement le point.
    cameraState.x = worldX;
    cameraState.y = worldY;

    syncCameraToRenderer();
    refreshUI();
  });
}

// ---------------------------------------------------------------------------
// AMORÇAGE
// ---------------------------------------------------------------------------
const initialSeed = createSeedFromQuery();
const seedInput = document.getElementById("seedInput");
if (seedInput) seedInput.value = initialSeed;

populateScenarioSelect();
boot(initialSeed, "sandbox");

window.__transportTycoon = {
  getState: () => state,
  getBootCount: () => bootCount,
  clickMap,
  cameraState,
  recenterCameraOnCity,
};
