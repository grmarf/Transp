import { createCity, createSeedFromQuery, mulberry32 } from "./city.js";
import { createState } from "./state.js";
import { SCENARIOS, findScenario, scenarioProgress } from "./scenarios.js";
import { createLine, cancelLineMode, finishLine, startExtendLine, finishExtendLine, step, STOP_RADIUS, buyVehicleForLine, sellVehicleFromLine, deleteLine, networkFinancials, congestionHeatmap, cityJournal } from "./engine.js";
import { createNetwork, routeLine, createUndergroundNetwork, createTramNetwork, roadType } from "./network.js";
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

const cameraState = {
  x: 0, y: 0, zoom: 1,
  minZoom: 0.5, maxZoom: 3,
  isDragging: false,
  lastDragX: 0, lastDragY: 0,
  downX: 0, downY: 0,
  moved: false,
};

function log(msg) {
  if (!state) return;
  state.logs.unshift("[" + formatTime() + "] " + msg);
  state.logs = state.logs.slice(0, 30);
}

function formatTime() {
  if (!state) return "00:00";
  const hh = Math.floor(state.time / 60) % 24;
  const mm = Math.floor(state.time % 60);
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

function syncCameraToRenderer() {
  const r = rendererState.current;
  if (!r || !r.camera) return;
  r.camera.x = cameraState.x;
  r.camera.y = cameraState.y;
  r.camera.zoom = cameraState.zoom;
}

function getCanvasCssSize() {
  const rect = canvas.getBoundingClientRect();
  return { W: rect.width, H: rect.height, rect: rect };
}

function recenterCameraOnCity() {
  if (!state || !state.city || !state.city.stops || !state.city.stops.length) return;
  if (rendererState.current && rendererState.current.resizeCanvas) {
    rendererState.current.resizeCanvas();
  }
  const size = getCanvasCssSize();
  if (!size.W || !size.H) {
    requestAnimationFrame(recenterCameraOnCity);
    return;
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  state.city.stops.forEach(function (s) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  });
  cameraState.x = (minX + maxX) / 2;
  cameraState.y = (minY + maxY) / 2;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  let zoom = Math.min(size.W / spanX, size.H / spanY) * 0.85;
  if (!isFinite(zoom) || zoom <= 0) zoom = 1;
  cameraState.zoom = Math.max(cameraState.minZoom, Math.min(cameraState.maxZoom, zoom));
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
  if (state.roadEditMode === "build") {
    el.innerHTML = state.pendingRoadPoint ? "Construction : clique le <b>second point</b>." : "Construction : clique le <b>premier point</b>.";
  } else if (state.roadEditMode === "remove") {
    el.innerHTML = "Suppression : clique une <b>route construite</b>.";
  } else if (state.lineMode) {
    if (extending) {
      const line = state.lines.find(function (l) { return l.id === state.extendingLineId; });
      const name = h((line && line.name) || "la ligne");
      el.innerHTML = ready
        ? "Extension de <b>" + name + "</b> : touche <b>✓ Terminer</b> pour valider."
        : "Extension de <b>" + name + "</b> : touche <b>1 ou plusieurs arrêts</b> à ajouter.";
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
  const buildRoadBtn = document.getElementById("buildRoadBtn");
  const roadTypeSelect = document.getElementById("roadTypeSelect");
  const removeRoadBtn = document.getElementById("removeRoadBtn");
  if (roadTypeSelect) roadTypeSelect.value = state.roadType || "local";
  if (buildRoadBtn) {
    buildRoadBtn.textContent = state.roadEditMode === "build" ? "✕ Annuler construction" : "🛣️ Construire une route";
    buildRoadBtn.setAttribute("aria-pressed", String(state.roadEditMode === "build"));
  }
  if (removeRoadBtn) {
    removeRoadBtn.textContent = state.roadEditMode === "remove" ? "✕ Annuler suppression" : "🧹 Supprimer une route";
    removeRoadBtn.setAttribute("aria-pressed", String(state.roadEditMode === "remove"));
  }
}

function findNearestStop(point, threshold = 40) {
  let nearest = null;
  let best = Infinity;
  state.city.stops.forEach(function (stop) {
    const distance = Math.hypot(stop.x - point.x, stop.y - point.y);
    if (distance <= threshold && distance < best) {
      nearest = stop;
      best = distance;
    }
  });
  return nearest;
}

function findLineAtPoint(point, threshold = 25) {
  let closest = null;
  let best = threshold;
  const nodes = state.network && state.network.nodes;
  (state.lines || []).forEach(function (line) {
    const ids = (line.route && line.route.nodeIds) || [];
    for (let i = 0; i < ids.length - 1; i++) {
      const a = nodes && nodes.get(ids[i]);
      const b = nodes && nodes.get(ids[i + 1]);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
      const distance = Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
      if (distance < best) {
        best = distance;
        closest = line;
      }
    }
  });
  return closest;
}

function toggleLineFocus(lineId) {
  state.focusedLineId = state.focusedLineId === lineId ? null : lineId;
  let exitButton = document.getElementById("exitFocusBtn");
  if (state.focusedLineId && !exitButton) {
    const toolbar = document.querySelector(".toolbar");
    if (toolbar) {
      exitButton = document.createElement("button");
      exitButton.id = "exitFocusBtn";
      exitButton.type = "button";
      exitButton.className = "btn btn-warning";
      exitButton.textContent = "🔦 Quitter le focus";
      exitButton.setAttribute("aria-label", "Quitter le mode focus");
      exitButton.addEventListener("click", function () { toggleLineFocus(null); });
      toolbar.appendChild(exitButton);
    }
  } else if (!state.focusedLineId && exitButton) {
    exitButton.remove();
  }
  refreshUI();
}

function bindTap(el, handler) {
  if (!el) return;
  let lastTouch = 0;
  const invoke = function (e) {
    if (e && e.type === "click" && Date.now() - lastTouch < 700) return;
    if (e && (e.type === "touchend" || e.type === "pointerup")) {
      lastTouch = Date.now();
      if (e.preventDefault) e.preventDefault();
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
  const invoke = function (e) {
    const target = e.target && e.target.closest ? e.target.closest(selector) : null;
    if (!target || !container.contains(target)) return;
    if (e.type === "click" && Date.now() - lastTouch < 700) return;
    if (e.type === "touchend" || e.type === "pointerup") {
      lastTouch = Date.now();
      if (e.preventDefault) e.preventDefault();
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

function screenPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const source = (e && e.changedTouches && e.changedTouches[0]) || (e && e.touches && e.touches[0]) || e;
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
  // L’API publique historique reçoit des coordonnées dans le repère monde
  // du canvas (sans type d’événement). Les vrais pointer events passent par
  // la caméra et restent convertis par screenPoint().
  let p = screenPoint(e);
  if (e && !e.type && Number.isFinite(e.clientX) && canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    p = { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }
  if (!p || !state) return;

  if (state.roadEditMode === "build") {
    const snappedStop = findNearestStop(p, 40);
    const targetPoint = snappedStop ? { x: snappedStop.x, y: snappedStop.y } : { x: Math.round(p.x), y: Math.round(p.y) };
    if (!state.pendingRoadPoint) {
      state.pendingRoadPoint = targetPoint;
      state.pendingRoadStopId = snappedStop ? snappedStop.id : null;
      if (snappedStop) log(`Départ accroché à « ${snappedStop.name} ».`);
      log("Point de départ choisi. Clique un second point pour construire la route.");
    } else {
      const start = state.pendingRoadPoint;
      const end = targetPoint;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const selectedType = roadType(state.roadType || "local");
      const cost = Math.max(25, Math.round(length * selectedType.cost));
      if (length < 24) log("Route trop courte : éloigne le second point.");
      else if (state.money < cost) log(`Construction impossible : il faut ${cost.toLocaleString("fr-FR")} €.`);
      else {
        if (!Number.isInteger(state.nextRoadId)) state.nextRoadId = 1;
        const road = { id: `built-road-${state.nextRoadId++}`, start, end,
          type: selectedType.id, lanes: selectedType.lanes, speed: selectedType.speed,
          allowStops: selectedType.allowStops, built: true };
        if (state.pendingRoadStopId) road.startStopId = state.pendingRoadStopId;
        if (snappedStop) road.endStopId = snappedStop.id;
        if (road.startStopId && road.endStopId) {
          road.a = road.startStopId;
          road.b = road.endStopId;
        }
        state.city.roads.push(road);
        if (road.a && road.b) {
          const closedEdgeIds = state.network && state.network.closedEdgeIds;
          const roadworksReopenDay = state.network && state.network.roadworksReopenDay;
          state.network = createNetwork(state.city);
          if (closedEdgeIds) state.network.closedEdgeIds = new Set(closedEdgeIds);
          if (roadworksReopenDay) state.network.roadworksReopenDay = new Map(roadworksReopenDay);
        }
        state.money -= cost;
        state.pendingRoadPoint = null;
        state.pendingRoadStopId = null;
        log(`Route construite (${cost.toLocaleString("fr-FR")} €).`);
      }
    }
    updateInstructions();
    refreshUI();
    return;
  }

  if (state.roadEditMode === "remove") {
    let nearestRoad = null;
    let nearestDistance = 100 / cameraState.zoom;
    state.city.roads.forEach(function (road) {
      if (!road.built || !road.start || !road.end) return;
      const dx = road.end.x - road.start.x;
      const dy = road.end.y - road.start.y;
      const lengthSquared = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - road.start.x) * dx + (p.y - road.start.y) * dy) / lengthSquared));
      const distanceToRoad = Math.hypot(p.x - (road.start.x + t * dx), p.y - (road.start.y + t * dy));
      const inDetourBounds = p.x >= Math.min(road.start.x, road.end.x) - 30 &&
        p.x <= Math.max(road.start.x, road.end.x) + 30 &&
        p.y >= Math.min(road.start.y, road.end.y) - 30 &&
        p.y <= Math.max(road.start.y, road.end.y) + 30;
      const hitDistance = inDetourBounds ? Math.min(distanceToRoad, 30) : distanceToRoad;
      if (hitDistance < nearestDistance) {
        nearestDistance = hitDistance;
        nearestRoad = road;
      }
    });
    if (nearestRoad) {
      state.city.roads = state.city.roads.filter(function (road) { return road !== nearestRoad; });
      log("Route construite supprimée.");
    } else log("Aucune route construite sous le curseur.");
    updateInstructions();
    refreshUI();
    return;
  }

  let nearest = null;
  let best = Infinity;
  state.city.stops.forEach(function (stop) {
    const d = Math.hypot(stop.x - p.x, stop.y - p.y);
    const HIT = Math.max(STOP_RADIUS * 2.8, 36);
    if (d <= HIT && d < best) {
      nearest = stop;
      best = d;
    }
  });
  if (!nearest && state.lines && state.lines.length) {
    const clickedLine = findLineAtPoint(p, 28);
    if (clickedLine) {
      toggleLineFocus(clickedLine.id);
      log(`${clickedLine.name}${state.focusedLineId ? " : focus activé" : " : focus désactivé"}.`);
      return;
    }
  }
  if (!nearest) return;
  state.selectedStop = nearest.id;
  if (state.lineMode && state.pendingStops.indexOf(nearest.id) < 0) {
    state.pendingStops.push(nearest.id);
  }
  updateInstructions();
  refreshUI();
}

function bindMap() {
  const pointerDown = function (e) {
    cameraState.isDragging = true;
    cameraState.lastDragX = e.clientX;
    cameraState.lastDragY = e.clientY;
    cameraState.downX = e.clientX;
    cameraState.downY = e.clientY;
    cameraState.moved = false;
  };
  const pointerMove = function (e) {
    if (!cameraState.isDragging) return;
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
  const pointerUp = function (e) {
    const wasDragging = cameraState.isDragging;
    cameraState.isDragging = false;
    if (!wasDragging) return;
    if (cameraState.moved) return;
    if (e.preventDefault) e.preventDefault();
    clickMap(e);
  };
  const pointerCancel = function () {
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
  canvas.addEventListener("wheel", function (e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const size = getCanvasCssSize();
    if (!size.W || !size.H) return;
    const sx = e.clientX - size.rect.left;
    const sy = e.clientY - size.rect.top;
    const oldZoom = cameraState.zoom;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(cameraState.minZoom, Math.min(cameraState.maxZoom, oldZoom * delta));
    if (newZoom === oldZoom) return;
    const wx = (sx - size.W / 2) / oldZoom + cameraState.x;
    const wy = (sy - size.H / 2) / oldZoom + cameraState.y;
    cameraState.zoom = newZoom;
    cameraState.x = wx - (sx - size.W / 2) / newZoom;
    cameraState.y = wy - (sy - size.H / 2) / newZoom;
    syncCameraToRenderer();
    refreshUI();
  }, { passive: false });
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  canvas.addEventListener("dragstart", function (e) { e.preventDefault(); });
}

function bindZoomReset() {
  const btn = document.getElementById("resetZoomBtn");
  if (btn) bindTap(btn, resetCameraView);
}

function computeMiniMapTransform() {
  const stops = state.city.stops;
  const minX = Math.min.apply(null, stops.map(function (s) { return s.x; }));
  const maxX = Math.max.apply(null, stops.map(function (s) { return s.x; }));
  const minY = Math.min.apply(null, stops.map(function (s) { return s.y; }));
  const maxY = Math.max.apply(null, stops.map(function (s) { return s.y; }));
  const pad = 10;
  const scale = Math.min(
    (miniMapCanvas.width - pad * 2) / Math.max(1, maxX - minX),
    (miniMapCanvas.height - pad * 2) / Math.max(1, maxY - minY)
  );
  return { minX: minX, maxX: maxX, minY: minY, maxY: maxY, pad: pad, scale: scale };
}

function renderMiniMap() {
  if (!miniMapCanvas || !state) return;
  const stops = state.city.stops;
  if (!stops.length) return;
  const miniCtx = miniMapCanvas.getContext("2d");
  const t = computeMiniMapTransform();
  miniCtx.clearRect(0, 0, miniMapCanvas.width, miniMapCanvas.height);
  miniCtx.fillStyle = "#101a22";
  miniCtx.fillRect(0, 0, miniMapCanvas.width, miniMapCanvas.height);
  const worldToMini = function (x, y) {
    return { x: t.pad + (x - t.minX) * t.scale, y: t.pad + (y - t.minY) * t.scale };
  };
  state.lines.forEach(function (line) {
    if (!line.route || !Array.isArray(line.route.nodeIds) || line.route.nodeIds.length < 2) return;
    miniCtx.beginPath();
    let first = true;
    line.route.nodeIds.forEach(function (id) {
      const node = state.network.nodes.get(id);
      if (!node) return;
      const p = worldToMini(node.x, node.y);
      if (first) { miniCtx.moveTo(p.x, p.y); first = false; }
      else miniCtx.lineTo(p.x, p.y);
    });
    miniCtx.strokeStyle = line.color || "#ffffff";
    miniCtx.lineWidth = 1.5;
    miniCtx.stroke();
  });
  stops.forEach(function (stop) {
    const p = worldToMini(stop.x, stop.y);
    miniCtx.beginPath();
    miniCtx.fillStyle = stop.id === state.selectedStop ? "#ffffff" : "#7da7c9";
    miniCtx.arc(p.x, p.y, stop.id === state.selectedStop ? 2.5 : 2, 0, Math.PI * 2);
    miniCtx.fill();
  });
  const rectCss = canvas.getBoundingClientRect();
  if (!rectCss.width || !rectCss.height) return;
  const viewW = rectCss.width / cameraState.zoom;
  const viewH = rectCss.height / cameraState.zoom;
  const left = cameraState.x - viewW / 2;
  const top = cameraState.y - viewH / 2;
  miniCtx.strokeStyle = "#f6d365";
  miniCtx.lineWidth = 1.2;
  miniCtx.strokeRect(
    t.pad + (left - t.minX) * t.scale,
    t.pad + (top - t.minY) * t.scale,
    viewW * t.scale,
    viewH * t.scale
  );
}

function bindMiniMapClick() {
  if (!miniMapCanvas) return;
  miniMapCanvas.addEventListener("click", function (e) {
    if (!state || !state.city.stops.length) return;
    const rect = miniMapCanvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * miniMapCanvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * miniMapCanvas.height;
    const t = computeMiniMapTransform();
    if (!t.scale || !isFinite(t.scale)) return;
    cameraState.x = t.minX + (x - t.pad) / t.scale;
    cameraState.y = t.minY + (y - t.pad) / t.scale;
    syncCameraToRenderer();
    refreshUI();
  });
}

function populateScenarioSelect() {
  const select = document.getElementById("scenarioSelect");
  if (!select) return;
  select.innerHTML = SCENARIOS.map(function (s) {
    return '<option value="' + h(s.id) + '">' + h(s.name) + " (" + h(s.difficulty) + ")</option>";
  }).join("");
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
  banner.className = "scenario-banner" + (scenario.status !== "active" ? " " + scenario.status : "");
  const progress = scenarioProgress(state, { net: networkFinancials(state).net }) || 0;
  const statusText = scenario.status === "won"
    ? "✅ Réussi"
    : scenario.status === "lost"
      ? "❌ Échoué"
      : "Jour " + ((state.elapsedDays || 0) + 1) + (scenario.durationDays ? "/" + scenario.durationDays : "");
  banner.innerHTML = '<div><b>' + h(scenario.name) + '</b> (' + h(scenario.difficulty) + ') — ' + h(scenario.objective.label) + ' · ' + h(statusText) + '</div>' +
    '<div class="bar"><div style="width:' + Math.round(progress * 100) + '%"></div></div>';
}

function refreshUI() {
  if (!state || !rendererState.current) return;
  try {
    state.journal = cityJournal(state);
    syncCameraToRenderer();
    rendererState.current.render({
      heatmap: state.showHeatmap ? congestionHeatmap(state) : null,
      camera: cameraState,
    });
    renderMiniMap();
    updateScenarioBanner();
  } catch (err) {
    console.error("[Vie t'Lignes] refreshUI :", err);
  }
}

const STEP_INTERVAL_MS = 1000;
let accumulator = 0;
let lastTs = 0;
let firstFrameDone = false;

function loop(ts) {
  if (!state) {
    rafId = requestAnimationFrame(loop);
    return;
  }
  if (!lastTs) lastTs = ts;
  accumulator += ts - lastTs;
  lastTs = ts;
  let steps = 0;
  while (accumulator >= STEP_INTERVAL_MS && steps < 5) {
    accumulator -= STEP_INTERVAL_MS;
    steps++;
    if (!state.paused) step(state, rng, log);
  }
  if (accumulator > STEP_INTERVAL_MS * 5) accumulator = 0;
  refreshUI();
  if (!firstFrameDone) {
    firstFrameDone = true;
    requestAnimationFrame(function () {
      if (rendererState.current && rendererState.current.resizeCanvas) rendererState.current.resizeCanvas();
      recenterCameraOnCity();
      refreshUI();
    });
  }
  rafId = requestAnimationFrame(loop);
}

function startLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  accumulator = 0;
  lastTs = 0;
  firstFrameDone = false;
  rafId = requestAnimationFrame(loop);
}

function boot(seed, scenarioId, restoredPayload) {
  bootCount += 1;
  let nextState;
  let nextRng;

  if (restoredPayload) {
    nextState = restoredPayload.state;
    nextState.network = createNetwork(nextState.city);
    const savedNetwork = restoredPayload.state.network;
    if (savedNetwork && savedNetwork.closedEdgeIds && savedNetwork.closedEdgeIds.length) {
      nextState.network.closedEdgeIds = new Set(savedNetwork.closedEdgeIds);
    }
    if (savedNetwork && savedNetwork.roadworksReopenDay && savedNetwork.roadworksReopenDay.length) {
      nextState.network.roadworksReopenDay = new Map(savedNetwork.roadworksReopenDay);
    }
    nextState.network.pathCache.clear();
    nextState.undergroundNetwork = createUndergroundNetwork(nextState.city);
    nextState.tramNetwork = createTramNetwork(nextState.city);
    nextRng = mulberry32(nextState.city.numericSeed ^ 0xA57E2);
    if (restoredPayload.rngState != null && nextRng.setState) {
      nextRng.setState(restoredPayload.rngState);
    }
  } else {
    const scenario = findScenario(scenarioId || "sandbox");
    const city = createCity(seed);
    nextState = createState(city, scenario);
    nextState.network = createNetwork(city);
    nextState.undergroundNetwork = createUndergroundNetwork(city);
    nextState.tramNetwork = createTramNetwork(city);
    nextRng = mulberry32(city.numericSeed ^ 0xA57E2);
  }

  nextState.eventsEnabled = true;
  nextState.activeEvents = nextState.activeEvents || [];
  nextState.eventHistory = nextState.eventHistory || [];
  nextState.nextEventId = nextState.nextEventId || 1;
  nextState.completedGoals = nextState.completedGoals || [];
  nextState.progressionHistory = nextState.progressionHistory || [];
  nextState.reputation = nextState.reputation || 0;
  nextState.progressionEnabled = true;
  nextState.contractsEnabled = true;
  nextState.activeContracts = nextState.activeContracts || [];
  nextState.contractHistory = nextState.contractHistory || [];
  nextState.dailyReports = nextState.dailyReports || [];
  nextState.latestReport = nextState.latestReport || null;
  nextState.seasonsEnabled = true;
  nextState.pendingStops = nextState.pendingStops || [];
  nextState.roadType = nextState.roadType || "local";
  nextState.logs = nextState.logs || [];

  state = nextState;
  rng = nextRng;

  const nextRenderer = createRenderer(canvas, nextState);
  rendererState.current = nextRenderer;

  if (!restoredPayload) {
    log("Bienvenue ! Ton budget de départ : " + state.money.toLocaleString("fr-FR") + " €.");
    log("Ville générée : « " + state.city.name + " ».");
    if (state.scenario && state.scenario.objective) {
      log("Scénario : " + state.scenario.name + " — " + state.scenario.objective.label + ".");
    }
    log("Touche la carte pour sélectionner un arrêt !");
  }

  recenterCameraOnCity();
  nextRenderer.render({
    heatmap: nextState.showHeatmap ? congestionHeatmap(nextState) : null,
    camera: cameraState,
  });

  state.demographicsEnabled = true;
  state.advertisingEnabled = true;
  state.staffCostsEnabled = true;
  const fareLevelSelect = document.getElementById("fareLevelSelect");
  if (fareLevelSelect) fareLevelSelect.value = String(state.fareLevel ?? 1);
  const wageLevelSelect = document.getElementById("wageLevelSelect");
  if (wageLevelSelect) wageLevelSelect.value = String(state.wageLevel ?? 1);
  const seedInput = document.getElementById("seedInput");
  if (seedInput) seedInput.value = state.city.seed;
  const scenarioSelect = document.getElementById("scenarioSelect");
  if (scenarioSelect) scenarioSelect.value = (state.scenario && state.scenario.id) || "sandbox";
  const pauseBtn = document.getElementById("pauseBtn");
  if (pauseBtn) pauseBtn.textContent = state.paused ? "▶ Reprendre" : "⏸ Pause";
  const speedBtn = document.getElementById("speedBtn");
  if (speedBtn) speedBtn.textContent = "▶ " + state.speed + "×";
  const toggle = document.getElementById("toggleHeatmapBtn");
  if (toggle) toggle.setAttribute("aria-pressed", String(!!state.showHeatmap));

  updateInstructions();
  refreshUI();
  updateSaveStatus();

  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      if (rendererState.current && rendererState.current.resizeCanvas) rendererState.current.resizeCanvas();
      recenterCameraOnCity();
      refreshUI();
    });
  });

  startLoop();
}

function updateSaveStatus(message) {
  const el = document.getElementById("saveStatus");
  const text = document.getElementById("saveStatusText");
  if (!el || !text) return;
  if (message) { text.textContent = message; return; }
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { text.textContent = "Aucune sauvegarde locale."; return; }
    const payload = JSON.parse(raw);
    const date = payload.savedAt ? new Date(payload.savedAt).toLocaleString("fr-FR") : "date inconnue";
    text.textContent = "Sauvegarde locale : " + date;
  } catch (e) {
    text.textContent = "Sauvegarde locale indisponible.";
  }
}

function setSaveActivity(active, label) {
  const activity = document.getElementById("saveActivity");
  if (!activity) return;
  activity.hidden = !active;
  activity.setAttribute("aria-hidden", String(!active));
  activity.textContent = label || "Sauvegarde…";
}

function saveCurrentGame() {
  try {

    saveGame(state, rng && rng.getState ? rng.getState() : null);
    updateSaveStatus("Partie sauvegardée localement.");
    log("Partie sauvegardée.");
    refreshUI();
  } catch (error) {
    updateSaveStatus("Échec de la sauvegarde.");
    log("Sauvegarde impossible : " + error.message);
  }
}

function loadCurrentGame() {
  try {
    const payload = readSavedGame();
    if (!payload) { updateSaveStatus("Aucune sauvegarde locale."); return; }
    boot(payload.state.city.seed, (payload.state.scenario && payload.state.scenario.id) || "sandbox", payload);
    updateSaveStatus("Partie chargée.");
  } catch (error) {
    updateSaveStatus("Sauvegarde invalide.");
    log("Chargement impossible : " + error.message);
  }
}

bindTap(document.getElementById("newLineBtn"), function () {
  if (!state) return;
  if (state.lineMode) cancelLineMode(state);
  else createLine(state);
  updateInstructions();
  refreshUI();
});

const roadTypeSelectEl = document.getElementById("roadTypeSelect");
if (roadTypeSelectEl) roadTypeSelectEl.addEventListener("change", function () {
  if (!state) return;
  if (roadTypeSelectEl.value === "local" || roadTypeSelectEl.value === "secondary" || roadTypeSelectEl.value === "arterial") {
    state.roadType = roadTypeSelectEl.value;
    updateInstructions();
  }
});

bindTap(document.getElementById("buildRoadBtn"), function () {
  if (!state) return;
  if (state.lineMode) cancelLineMode(state);
  state.roadEditMode = state.roadEditMode === "build" ? null : "build";
  state.pendingRoadPoint = null;
  updateInstructions();
  refreshUI();
});

bindTap(document.getElementById("removeRoadBtn"), function () {
  if (!state) return;
  if (state.lineMode) cancelLineMode(state);
  state.roadEditMode = state.roadEditMode === "remove" ? null : "remove";
  state.pendingRoadPoint = null;
  updateInstructions();
  refreshUI();
});

bindTap(document.getElementById("finishLineBtn"), function () {
  if (!state) return;
  const minStops = state.extendingLineId ? 1 : 2;
  if (state.pendingStops.length < minStops) return;
  const modeSelect = document.getElementById("modeSelect");
  if (state.extendingLineId) finishExtendLine(state, log, routeLine);
  else finishLine(state, log, routeLine, (modeSelect && modeSelect.value) || "bus");
  updateInstructions();
  refreshUI();
});

bindTap(document.getElementById("pauseBtn"), function () {
  if (!state) return;
  state.paused = !state.paused;
  const btn = document.getElementById("pauseBtn");
  if (btn) btn.textContent = state.paused ? "▶ Reprendre" : "⏸ Pause";
  refreshUI();
});

bindTap(document.getElementById("speedBtn"), function () {
  if (!state) return;
  state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 4 : state.speed === 4 ? 1000 : 1;
  const btn = document.getElementById("speedBtn");
  if (btn) btn.textContent = "▶ " + state.speed + "×";
  refreshUI();
});

bindTap(document.getElementById("resetZoomBtn"), resetCameraView);
bindTap(document.getElementById("saveBtn"), saveCurrentGame);
bindTap(document.getElementById("loadBtn"), loadCurrentGame);

bindTap(document.getElementById("newCityBtn"), function () {
  const input = document.getElementById("seedInput");
  const seed = (input && input.value.trim()) || ("CITY-" + Date.now());
  const scenarioSelect = document.getElementById("scenarioSelect");
  boot(seed, (scenarioSelect && scenarioSelect.value) || "sandbox");
});

bindMap();
bindZoomReset();
bindMiniMapClick();

bindDelegatedTap(document.getElementById("lines"), "[data-buy-vehicle]", function (target) {
  if (!state) return;
  buyVehicleForLine(state, Number(target.dataset.buyVehicle), log);
  refreshUI();
});

bindDelegatedTap(document.getElementById("lines"), "[data-sell-vehicle]", function (target) {
  if (!state) return;
  sellVehicleFromLine(state, Number(target.dataset.sellVehicle), Number(target.dataset.vehicleId), log);
  refreshUI();
});

bindDelegatedTap(document.getElementById("lines"), "[data-delete-line]", function (target) {
  if (!state) return;
  const lineId = Number(target.dataset.deleteLine);
  const line = state.lines.find(function (l) { return l.id === lineId; });
  if (line && window.confirm && !window.confirm("Supprimer " + line.name + " ?")) return;
  deleteLine(state, lineId, log);
  refreshUI();
});

bindDelegatedTap(document.getElementById("lines"), "[data-extend-line]", function (target) {
  if (!state) return;
  startExtendLine(state, Number(target.dataset.extendLine));
  updateInstructions();
  refreshUI();
});

bindTap(document.getElementById("toggleHeatmapBtn"), function () {
  if (!state) return;
  state.showHeatmap = !state.showHeatmap;
  const button = document.getElementById("toggleHeatmapBtn");
  if (button) button.setAttribute("aria-pressed", String(state.showHeatmap));
  refreshUI();
});

bindTap(document.getElementById("toggleCoverageBtn"), function () {
  if (!state) return;
  state.showCoverage = !state.showCoverage;
  const button = document.getElementById("toggleCoverageBtn");
  if (button) button.setAttribute("aria-pressed", String(state.showCoverage));
  refreshUI();
});

const fareLevelSelectEl = document.getElementById("fareLevelSelect");
if (fareLevelSelectEl) fareLevelSelectEl.addEventListener("change", function () {
  if (!state) return;
  const value = Number(fareLevelSelectEl.value);
  if (Number.isFinite(value) && value >= 0.8 && value <= 1.5) state.fareLevel = value;
});

const wageLevelSelectEl = document.getElementById("wageLevelSelect");
if (wageLevelSelectEl) wageLevelSelectEl.addEventListener("change", function () {
  if (!state) return;
  const value = Number(wageLevelSelectEl.value);
  if (Number.isFinite(value) && value >= 0.8 && value <= 1.2) state.wageLevel = value;
});

bindTap(document.getElementById("exportBtn"), function () {
  setSaveActivity(true, "Export…");
  try { exportGameToFile(state, rng && rng.getState ? rng.getState() : null); }
  finally { setSaveActivity(false); }
});

const importFileEl = document.getElementById("importFile");
if (importFileEl) {
  importFileEl.addEventListener("change", async function (event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    setSaveActivity(true, "Import…");
    try {
      const payload = await importGameFromFile(file);
      boot(payload.state.city.seed, (payload.state.scenario && payload.state.scenario.id) || "sandbox", payload);
      log("Partie importée avec succès.");
      refreshUI();
    } catch (error) {
      log("Échec de l'import : " + error.message);
    } finally {
      setSaveActivity(false);
      event.target.value = "";
    }
  });
}

let resizeTimer = null;
window.addEventListener("resize", function () {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function () {
    if (rendererState.current && rendererState.current.resizeCanvas) rendererState.current.resizeCanvas();
    recenterCameraOnCity();
    refreshUI();
  }, 200);
});

const initialSeed = createSeedFromQuery();
const seedInputEl = document.getElementById("seedInput");
if (seedInputEl) seedInputEl.value = initialSeed;
const cityNameInputEl = document.getElementById("cityNameInput");
if (cityNameInputEl) {
  cityNameInputEl.addEventListener("input", function () {
    if (!state) return;
    const value = cityNameInputEl.value.trim();
    if (value) state.city.name = value;
  });
  cityNameInputEl.addEventListener("blur", function () {
    if (!state) return;
    if (!cityNameInputEl.value.trim()) cityNameInputEl.value = state.city.name;
  });
}
populateScenarioSelect();
boot(initialSeed, "sandbox");

const publicGameApi = {
  getState: function () { return state; },
  cameraState: cameraState,
  recenterCameraOnCity: recenterCameraOnCity,
  clickMap: clickMap,
};
window.__vieTLignes = publicGameApi;

// === FIN DU FICHIER main.js ===
