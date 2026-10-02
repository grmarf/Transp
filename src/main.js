/* =====================================================================
   Vie t'Lignes — main.js
   Convention caméra (partagée avec renderer.js) :
     cameraState.x / y  = coordonnées MONDE du CENTRE de l'écran
     Tout l'input se fait en pixels CSS (canvas.clientWidth/Height)
   ===================================================================== */

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

// ---------------------------------------------------------------------------
// DOM & état global
// ---------------------------------------------------------------------------
const canvas = document.getElementById("map");
const miniMapCanvas = document.getElementById("miniMapCanvas");
const rendererState = { current: null };
let state = null;
let rng = null;
let rafId = null;
let bootCount = 0;

// ---------------------------------------------------------------------------
// Caméra
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
  const hh = Math.floor(state.time / 60) % 24;
  const mm = Math.floor(state.time % 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
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

/**
 * Recentre la caméra sur le barycentre de la ville et ajuste le zoom pour
 * que l'ensemble des arrêts tienne à l'écran.
 * INDISPENSABLE au boot, sinon la caméra reste sur (0,0) = coin du monde.
 */
function recenterCameraOnCity() {
  if (!state?.city?.stops?.length) return;

  // Force un resize du canvas d'abord pour avoir les bonnes dimensions CSS
  if (rendererState.current?.resizeCanvas) {
    rendererState.current.resizeCanvas();
  }

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
  cameraState.zoom = Math.max(
    cameraState.minZoom,
    Math.min(cameraState.maxZoom, fit || 1)
  );

  syncCameraToRenderer();
}

function resetCameraView() {
  recenterCameraOnCity();
  refreshUI();
}

// ---------------------------------------------------------------------------
// Instructions contextuelles (mode création / extension de ligne)
// ---------------------------------------------------------------------------
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
        ? `Extension de <b>${h(line?.name ?? "la ligne")}</b> : touche <b>✓ Terminer</b> pour valider.`
        : `Extension de <b>${h(line?.name ?? "la ligne")}</b> : touche <b>1 ou plusieurs arrêts</b> à ajouter.`;
    } else {
      el.innerHTML = ready
        ? "Mode création : tu peux terminer la ligne !"
        : "Mode création : touche <b>2 arrêts minimum</b> dans l'ordre pour créer la ligne.";
    }
  } else {
    el.textContent = "Crée des lignes, ajoute des véhicules, fais grandir ta ville !";
  }

  if (finish) {
    finish.hidden = !ready;
    finish.disabled = !ready;
  }

  const newLineBtn = document.getElementById("newLineBtn");
  if (newLineBtn) {
    newLineBtn.textContent = state.lineMode ? "✕ Annuler la ligne" : "✏️ Nouvelle ligne";
  }
}

// ---------------------------------------------------------------------------
// Bindings génériques (clic + toucher sans double-déclenchement)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Conversion écran → monde (DOIT être l'inverse exact du renderer)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Interaction carte (drag / clic / zoom)
// ---------------------------------------------------------------------------
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

    // Seuil de 4px pour distinguer un clic d'un drag
    if (!cameraState.moved) {
      if (Math.hypot(e.clientX - cameraState.downX, e.clientY - cameraState.downY) > 4) {
        cameraState.moved = true;
      } else {
        return;
      }
    }

    const dx = e.clientX - cameraState.lastDragX;
    const dy = e.clientY - cameraState.lastDragY;

    cameraState.x -= dx / cameraState.zoom;
    cameraState.y -= dy / cameraState.zoom;

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
    e.preventDefault?.();
    clickMap(e);
  };

  const pointerCancel = () => {
    cameraState.isDragging = false;
    cameraState.moved = false;
  };

  if (window.PointerEvent) {
    canvas.addEventListener("pointerdown", pointerDown, { passive: true });
    canvas.addEventListener("pointermove", pointerMove, { passive: true });
    canvas.addEventListener("pointerup", pointerUp, { passive: false });
    canvas.addEventListener("pointercancel", pointerCancel, { passive: true });
  } else {
    canvas.addEventListener("touchstart", pointerDown, { passive: true });
    canvas.addEventListener("touchmove", pointerMove, { passive: true });
    canvas.addEventListener("touchend", pointerUp, { passive: false });
    canvas.addEventListener("touchcancel", pointerCancel, { passive: true });
  }

  canvas.addEventListener("wheel", e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();

    const { rect, W, H } = getCanvasCssSize();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const oldZoom = cameraState.zoom;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(
      cameraState.minZoom,
      Math.min(cameraState.maxZoom, oldZoom * delta)
    );
    if (newZoom === oldZoom) return;

    // Point monde sous la souris AVANT le zoom
    const wx = (sx - W / 2) / oldZoom + cameraState.x;
    const wy = (sy - H / 2) / oldZoom + cameraState.y;

    cameraState.zoom = newZoom;

    // Après le zoom, on veut que (sx, sy) pointe toujours sur (wx, wy)
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
// Minimap
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

  // Routes des lignes
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

  // Arrêts
  for (const stop of stops) {
    const point = worldToMini(stop.x, stop.y);
    miniCtx.beginPath();
    miniCtx.fillStyle = stop.id === state.selectedStop ? "#ffffff" : "#7da7c9";
    miniCtx.arc(point.x, point.y, stop.id === state.selectedStop ? 2.5 : 2, 0, Math.PI * 2);
    miniCtx.fill();
  }

  // Rectangle de vue (camera.x/y = CENTRE monde de l'écran)
  const rectCss = canvas.getBoundingClientRect();
  const viewW = rectCss.width / cameraState.zoom;
  const viewH = rectCss.height / cameraState.zoom;
  const left = cameraState.x - viewW / 2;
  const top = cameraState.y - viewH / 2;

  miniCtx.strokeStyle = "#f6d365";
  miniCtx.lineWidth = 1.2;
  miniCtx.strokeRect(
    pad + (left - minX) * scale,
    pad + (top - minY) * scale,
    viewW * scale,
    viewH * scale
  );
}

function bindMiniMapClick() {
  if (!miniMapCanvas) return;
  miniMapCanvas.addEventListener("click", e => {
    if (!state || !state.city.stops.length) return;
    const rect = miniMapCanvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * miniMapCanvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * miniMapCanvas.height;

    const { minX, minY, pad, scale } = computeMiniMapTransform();
    if (!scale || !isFinite(scale)) return;

    const worldX = minX + (x - pad) / scale;
    const worldY = minY + (y - pad) / scale;

    // camera.x/y = CENTRE monde de l'écran → on y place directement le point
    cameraState.x = worldX;
    cameraState.y = worldY;

    syncCameraToRenderer();
    refreshUI();
  });
}

// ---------------------------------------------------------------------------
// Scénario
// ---------------------------------------------------------------------------
function populateScenarioSelect() {
  const select = document.getElementById("scenarioSelect");
  if (!select) return;
  select.innerHTML = SCENARIOS.map(
    s => `<option value="${h(s.id)}">${h(s.name)} (${h(s.difficulty)})</option>`
  ).join("");
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

// ---------------------------------------------------------------------------
// Rafraîchissement UI
// ---------------------------------------------------------------------------
function refreshUI() {
  if (!state || !rendererState.current) return;
  state.journal = cityJournal(state);
  syncCameraToRenderer();
  rendererState.current.render({
    heatmap: state.showHeatmap ? congestionHeatmap(state) : null,
    camera: cameraState,
  });
  renderMiniMap();
  updateScenarioBanner();
}

// ---------------------------------------------------------------------------
// Boucle principale — requestAnimationFrame, step à 1 Hz
// ---------------------------------------------------------------------------
const STEP_INTERVAL_MS = 1000;
let accumulator = 0;
let lastTs = 0;

function loop(ts) {
  if (!state) {
    rafId = requestAnimationFrame(loop);
    return;
  }

  if (!lastTs) lastTs = ts;
  accumulator += ts - lastTs;
  lastTs = ts;

  // Max 5 steps par frame pour éviter la spirale
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
// Boot
// ---------------------------------------------------------------------------
function boot(seed, scenarioId, restoredPayload = null) {
  bootCount += 1;
  let nextState;
  let nextRng;

  if (restoredPayload) {
    nextState = restoredPayload.state;
    nextState.network = createNetwork(nextState.city);
    const savedNetwork = restoredPayload.state.network;
    if (savedNetwork?.closedEdgeIds?.length) {
      nextState.network.closedEdgeIds = new Set(savedNetwork.closedEdgeIds);
    }
    if (savedNetwork?.roadworksReopenDay?.length) {
      nextState.network.roadworksReopenDay = new Map(savedNetwork.roadworksReopenDay);
    }
    nextState.network.pathCache.clear();
    nextState.undergroundNetwork = createUndergroundNetwork(nextState.city);
    nextRng = mulberry32(nextState.city.numericSeed ^ 0xA57E2);
    if (restoredPayload.rngState != null && nextRng.setState) {
      nextRng.setState(restoredPayload.rngState);
    }
  } else {
    const scenario = findScenario(
      scenarioId || document.getElementById("scenarioSelect")?.value || "sandbox"
    );
    const city = createCity(seed);
    nextState = createState(city, scenario.id === "sandbox" ? null : scenario);
    nextState.network = createNetwork(city);
    nextState.undergroundNetwork = createUndergroundNetwork(city);
    nextRng = mulberry32(city.numericSeed ^ 0xA57E2);
  }

  // Valeurs par défaut pour les champs optionnels
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
  nextState.pendingStops ||= [];
  nextState.logs ||= [];

  // Bascule l'état global AVANT toute fonction qui en a besoin
  state = nextState;
  rng = nextRng;

  // Création du renderer
  const nextRenderer = createRenderer(canvas, nextState);
  rendererState.current = nextRenderer;

  // Logs de bienvenue (uniquement pour une nouvelle partie)
  if (!restoredPayload) {
    log(`Bienvenue ! Ton budget de départ : ${state.money.toLocaleString("fr-FR")} €.`);
    log(`Ville générée : « ${state.ci
