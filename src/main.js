import { createCity, createSeedFromQuery, mulberry32 } from "./city.js";
import { createState } from "./state.js";
import { SCENARIOS, findScenario, scenarioProgress } from "./scenarios.js";
import { createLine, cancelLineMode, finishLine, startExtendLine, finishExtendLine, editLineStops, step, STOP_RADIUS, buyVehicleForLine, sellVehicleFromLine, deleteLine, networkFinancials, congestionHeatmap, cityJournal, estimateLineCost } from "./engine.js";
import { createNetwork, routeLine, createUndergroundNetwork, createTramNetwork, roadType, roadConstructionCost, ROAD_TYPES } from "./network.js";
import { createRenderer, clearRendererCaches, renderFleetPanel } from "./renderer.js";
import { saveGame, readSavedGame, SAVE_KEY, exportGameToFile, importGameFromFile } from "./persistence.js";
import { escapeHtml as h } from "./html.js";
import { invalidateRoutingCache } from "./routing.js";
import { ensureBuildingsState, addZone, removeZone, demolishBuilding, buildingStats, BUILDING_TYPES, ZONE_TYPES, seedInitialZones, traceBlockedBuildings, expropriateAbandonedAlongTrace, spawnInitialBuildings } from "./buildings.js";
import { startCampaign } from "./advertising.js";

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

// V26 — retour haptique discret (mobile). L'appel n'est émis que si le
// navigateur reconnaît une interaction utilisateur active : sans
// activation (clics synthétiques du smoke test, arrière-plan), Chromium
// journalise une erreur « Blocked call to navigator.vibrate » et pollue
// la console du jeu.
function hapticFeedback(durationMs) {
  try {
    if (typeof navigator === "undefined" || !navigator.vibrate) return;
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    navigator.vibrate(durationMs);
  } catch (error) {
    /* le retour haptique ne doit jamais casser le jeu */
  }
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

function updateToolbarVisibility() {
  const voirieGroup = document.getElementById("voirieGroup");
  if (voirieGroup && state) {
    const active = state.roadEditMode !== null || voirieGroup.dataset.open === "true";
    voirieGroup.classList.toggle("is-active", active);
    const button = document.getElementById("voirieBtn");
    if (button) button.setAttribute("aria-expanded", String(active));
  }
  const modeGroup = document.getElementById("modeGroup");
  if (modeGroup && state) modeGroup.classList.toggle("is-active", state.lineMode === true);
  // V27 — groupe urbanisme : actif tant qu'un outil de zonage est armé.
  const urbanismeGroup = document.getElementById("urbanismeGroup");
  if (urbanismeGroup && state) {
    const active = state.zoneMode !== null || urbanismeGroup.dataset.open === "true";
    urbanismeGroup.classList.toggle("is-active", active);
    const button = document.getElementById("urbanismeBtn");
    if (button) button.setAttribute("aria-expanded", String(active));
  }
  const menu = document.getElementById("gameMenuDropdown");
  const menuButton = document.getElementById("gameMenuBtn");
  if (menuButton) menuButton.setAttribute("aria-expanded", String(!!(menu && menu.classList.contains("is-open"))));
}
function toggleGameMenu(force) {
  const menu = document.getElementById("gameMenuDropdown");
  if (!menu) return;
  const open = force === undefined ? !menu.classList.contains("is-open") : force;
  menu.classList.toggle("is-open", open);
  updateToolbarVisibility();
}
function updateInstructions() {
  const el = document.getElementById("instructions");
  const finish = document.getElementById("finishLineBtn");
  if (!el || !state) return;
  const extending = !!state.extendingLineId;
  const minStops = extending ? 1 : 2;
  const ready = state.lineMode && state.pendingStops.length >= minStops;
  if (state.roadEditMode === "build") {
    el.innerHTML = state.pendingRoadPoint
      ? "Construction : clique le <b>point suivant</b> (chaîne de segments, <b>Entrée</b> ou double-clic pour terminer, <b>Échap</b> pour annuler)."
      : "Construction : clique le <b>premier point</b>.";
  } else if (state.roadEditMode === "remove") {
    el.innerHTML = "Suppression : clique une <b>route</b> (remboursement de 30&nbsp;%).";
  } else if (state.roadEditMode === "upgrade") {
    el.innerHTML = "Amélioration : clique une <b>route</b> pour la convertir vers le type sélectionné.";
  } else if (state.roadEditMode === "oneWay") {
    el.innerHTML = "Sens unique : clique une <b>route</b> pour inverser son sens de circulation.";
  } else if (state.zoneMode === "zone") {
    el.innerHTML = state.pendingZoneCorner
      ? "Zonage : clique le <b>coin opposé</b> (la zone doit longer une route, sinon elle est refusée)."
      : "Zonage : clique le <b>premier coin</b> de la zone à peindre.";
  } else if (state.zoneMode === "unzone") {
    el.innerHTML = "Dézonage : clique une <b>zone</b> pour la retirer (les bâtiments restent).";
  } else if (state.zoneMode === "inspect") {
    el.innerHTML = "Inspection : clique un <b>bâtiment</b> pour afficher ses statistiques.";
  } else if (state.lineMode) {
    if (extending) {
      const line = state.lines.find(function (l) { return l.id === state.extendingLineId; });
      const name = h((line && line.name) || "la ligne");
      el.innerHTML = ready
        ? "Extension de <b>" + name + "</b> : touche <b>✓ Terminer</b> pour valider."
        : "Extension de <b>" + name + "</b> : touche <b>1 ou plusieurs arrêts</b> à ajouter.";
    } else {
      // V25 — estimation du coût de la ligne candidate pendant la sélection.
      let costHint = "";
      if (state.pendingStops.length >= 2) {
        const modeSelect = document.getElementById("modeSelect");
        const estimate = estimateLineCost(state, state.pendingStops, (modeSelect && modeSelect.value) || "bus");
        const affordable = state.money >= estimate;
        costHint = '<br>Coût estimé : <b' + (affordable ? "" : ' style="color:#ef476f"') + '>' +
          estimate.toLocaleString("fr-FR") + ' €</b>' + (affordable ? "" : " (budget insuffisant)");
      }
      el.innerHTML = ready
        ? "Mode création : tu peux terminer la ligne !" + costHint
        : "Mode création : touche <b>2 arrêts minimum</b> dans l'ordre pour créer la ligne." + costHint;
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
  if (roadTypeSelect) roadTypeSelect.value = state.roadType || "street";
  if (buildRoadBtn) {
    buildRoadBtn.textContent = state.roadEditMode === "build" ? "✕ Annuler construction" : "🛣️ Construire une route";
    buildRoadBtn.setAttribute("aria-pressed", String(state.roadEditMode === "build"));
  }
  if (removeRoadBtn) {
    removeRoadBtn.textContent = state.roadEditMode === "remove" ? "✕ Annuler suppression" : "🧹 Supprimer une route";
    removeRoadBtn.setAttribute("aria-pressed", String(state.roadEditMode === "remove"));
  }
  const upgradeRoadBtn = document.getElementById("upgradeRoadBtn");
  if (upgradeRoadBtn) {
    upgradeRoadBtn.setAttribute("aria-pressed", String(state.roadEditMode === "upgrade"));
  }
  const oneWayRoadBtn = document.getElementById("oneWayRoadBtn");
  // V27 — boutons urbanisme : l'état armé se lit sur le bouton.
  const zoneBtn = document.getElementById("zoneBtn");
  const unzoneBtn = document.getElementById("unzoneBtn");
  const inspectBtn = document.getElementById("inspectBtn");
  if (zoneBtn) {
    zoneBtn.textContent = state.zoneMode === "zone" ? "✕ Annuler le zonage" : "🖍️ Zoner";
    zoneBtn.setAttribute("aria-pressed", String(state.zoneMode === "zone"));
  }
  if (unzoneBtn) unzoneBtn.setAttribute("aria-pressed", String(state.zoneMode === "unzone"));
  if (inspectBtn) inspectBtn.setAttribute("aria-pressed", String(state.zoneMode === "inspect"));
  if (oneWayRoadBtn) {
    oneWayRoadBtn.setAttribute("aria-pressed", String(state.roadEditMode === "oneWay"));
  }
  const undoRoadBtn = document.getElementById("undoRoadBtn");
  if (undoRoadBtn) undoRoadBtn.disabled = !(state.roadUndoStack || []).length;
  const redoRoadBtn = document.getElementById("redoRoadBtn");
  if (redoRoadBtn) redoRoadBtn.disabled = !(state.roadRedoStack || []).length;
  updateToolbarVisibility();
  // V27.6 — le menu reflète l'état armé (surlignage du trio racine).
  setMapMenu(mapMenuLevel);
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

function roadDegree(stopId, ignoredRoad = null) {
  if (!state || !stopId) return 0;
  return state.city.roads.reduce(function (degree, road) {
    if (road === ignoredRoad) return degree;
    return degree + (road.a === stopId || road.b === stopId ? 1 : 0);
  }, 0);
}

function roadEndpoints(road) {
  if (road.start && road.end) return { start: road.start, end: road.end };
  const startStop = state.city.stops.find(function (stop) { return stop.id === (road.a || road.startStopId); });
  const endStop = state.city.stops.find(function (stop) { return stop.id === (road.b || road.endStopId); });
  return startStop && endStop
    ? { start: { x: startStop.x, y: startStop.y }, end: { x: endStop.x, y: endStop.y } }
    : null;
}

// === V27 — actions de voirie : reconstruction réseau + undo/redo ============

function rebuildNetwork() {
  const closedEdgeIds = state.network && state.network.closedEdgeIds;
  const roadworksReopenDay = state.network && state.network.roadworksReopenDay;
  state.network = createNetwork(state.city);
  if (closedEdgeIds) state.network.closedEdgeIds = new Set(closedEdgeIds);
  if (roadworksReopenDay) state.network.roadworksReopenDay = new Map(roadworksReopenDay);
  state.network.pathCache.clear();
  invalidateRoutingCache(state);
  clearRendererCaches();
}

const ROAD_UNDO_MAX = 20;

function roadTypeSelectValue() {
  const select = document.getElementById("roadTypeSelect");
  return roadType(select && select.value ? select.value : (state && state.roadType) || "street").id;
}

function pushRoadAction(action) {
  if (!Array.isArray(state.roadUndoStack)) state.roadUndoStack = [];
  state.roadUndoStack.push(action);
  if (state.roadUndoStack.length > ROAD_UNDO_MAX) state.roadUndoStack.shift();
  state.roadRedoStack = [];
}

function undoRoadAction() {
  if (!state || !(state.roadUndoStack || []).length) return;
  const action = state.roadUndoStack.pop();
  if (action.kind === "build") {
    state.city.roads = state.city.roads.filter(function (road) { return road.id !== action.roadId; });
    state.money += action.cost;
    rebuildNetwork();
    log(`Construction annulée (remboursement ${action.cost.toLocaleString("fr-FR")} €).`);
  } else if (action.kind === "remove") {
    state.city.roads.push(action.road);
    state.money -= action.refund;
    rebuildNetwork();
    log("Suppression annulée : la route est restaurée.");
  } else if (action.kind === "upgrade") {
    const road = state.city.roads.find(function (r) { return r.id === action.roadId; });
    if (road) {
      road.type = action.fromType;
      if (action.fromOneWay !== undefined) road.oneWay = action.fromOneWay;
      state.money += action.cost;
      rebuildNetwork();
      log("Amélioration annulée.");
    }
  } else if (action.kind === "oneWay") {
    const road = state.city.roads.find(function (r) { return r.id === action.roadId; });
    if (road) {
      road.oneWay = action.fromOneWay;
      rebuildNetwork();
      log("Sens unique annulé.");
    }
  }
  state.roadRedoStack.push(action);
  refreshUI();
}

function redoRoadAction() {
  if (!state || !(state.roadRedoStack || []).length) return;
  const action = state.roadRedoStack.pop();
  if (action.kind === "build") {
    state.city.roads.push(action.road);
    state.money -= action.cost;
    rebuildNetwork();
    log("Construction rétablie.");
  } else if (action.kind === "remove") {
    state.city.roads = state.city.roads.filter(function (road) { return road !== action.road; });
    state.money += action.refund;
    rebuildNetwork();
    log("Suppression rétablie.");
  } else if (action.kind === "upgrade") {
    const road = state.city.roads.find(function (r) { return r.id === action.roadId; });
    if (road) {
      road.type = action.toType;
      state.money -= action.cost;
      rebuildNetwork();
      log("Amélioration rétablie.");
    }
  } else if (action.kind === "oneWay") {
    const road = state.city.roads.find(function (r) { return r.id === action.roadId; });
    if (road) {
      road.oneWay = !action.fromOneWay;
      rebuildNetwork();
      log("Sens unique rétabli.");
    }
  }
  state.roadUndoStack.push(action);
  refreshUI();
}

// V27 — snapping du tracé : arrêts (< 40 px), nœuds du graphe (< 8 px),
// et maintien de Shift pour contraindre l'angle à des multiples de 45°.
function snappedTracePoint(p, anchor, e) {
  let point = { x: Math.round(p.x), y: Math.round(p.y) };
  let stopId = null;
  const snappedStop = findNearestStop(p, 40);
  if (snappedStop) {
    point = { x: snappedStop.x, y: snappedStop.y };
    stopId = snappedStop.id;
  } else if (state.network && state.network.nodes) {
    let best = 8;
    for (const node of state.network.nodes.values()) {
      const d = Math.hypot(node.x - p.x, node.y - p.y);
      if (d <= best) { best = d; point = { x: node.x, y: node.y }; }
    }
  }
  if (anchor && e && (e.shiftKey || e.metaKey)) {
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    const angle = Math.atan2(dy, dx);
    const step = Math.PI / 4;
    const snappedAngle = Math.round(angle / step) * step;
    const length = Math.hypot(dx, dy);
    point = {
      x: Math.round(anchor.x + Math.cos(snappedAngle) * length),
      y: Math.round(anchor.y + Math.sin(snappedAngle) * length)
    };
  }
  return { point, stopId };
}

function updateRoadTracePreview(e) {
  if (!state || state.roadEditMode !== "build" || !state.pendingRoadPoint) {
    if (state) state.roadTrace = null;
    return;
  }
  const p = screenPoint(e);
  if (!p) return;
  const anchor = state.pendingRoadPoint;
  const { point, stopId } = snappedTracePoint(p, anchor, e);
  const length = Math.hypot(point.x - anchor.x, point.y - anchor.y);
  const selectedType = roadType(state.roadType || "street");
  const cost = roadConstructionCost(selectedType.id, length);
  const tooShort = length < 24;
  const tooExpensive = state.money < cost;
  state.roadTrace = {
    from: anchor,
    to: point,
    toStopId: stopId,
    type: selectedType.id,
    cost,
    valid: !tooShort && !tooExpensive,
    tooShort,
    tooExpensive
  };
}

function endRoadTrace() {
  if (!state) return;
  state.pendingRoadPoint = null;
  state.pendingRoadStopId = null;
  state.roadTrace = null;
  updateInstructions();
  refreshUI();
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

  // V27 — outils d'urbanisme : zonage (deux coins), dézonage, inspection.
  if (state.zoneMode === "zone") {
    const corner = state.pendingZoneCorner;
    if (!corner) {
      state.pendingZoneCorner = p;
      log("Premier coin posé. Clique le coin opposé pour peindre la zone.");
    } else {
      const zone = addZone(state, zoneTypeSelectValue(),
        Math.min(corner.x, p.x), Math.min(corner.y, p.y),
        Math.abs(p.x - corner.x), Math.abs(p.y - corner.y), log);
      state.pendingZoneCorner = null;
      if (zone) log("Zone peinte : les bâtiments émergeront au fil du temps le long de la voirie.");
    }
    updateInstructions();
    refreshUI();
    return;
  }
  if (state.zoneMode === "unzone") {
    const zone = (state.city.zones || []).find(function (z) {
      return p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;
    });
    if (zone) {
      removeZone(state, zone.id);
      log("Zone retirée : les bâtiments existants restent en place.");
    } else log("Aucune zone sous le curseur.");
    updateInstructions();
    refreshUI();
    return;
  }
  if (state.zoneMode === "inspect") {
    const building = buildingAtPoint(p);
    state.selectedBuildingId = building ? building.id : null;
    renderBuildingPanel();
    updateInstructions();
    refreshUI();
    return;
  }

  if (state.roadEditMode === "build") {
    // V27 — outil de tracé multi-points : chaque clic pose un point, chaque
    // segment est construit et payé immédiatement (la chaîne continue depuis
    // le point posé). Entrée / double-clic terminent, Échap annule.
    const anchor = state.pendingRoadPoint;
    const anchorStopId = state.pendingRoadStopId || null;
    const { point, stopId } = snappedTracePoint(p, anchor, e);
    if (!anchor) {
      state.pendingRoadPoint = point;
      state.pendingRoadStopId = stopId;
      if (stopId) {
        const stop = state.city.stops.find(function (s) { return s.id === stopId; });
        if (stop) log(`Départ accroché à « ${stop.name} ».`);
      }
      log("Point de départ choisi. Chaîne les segments, Entrée pour terminer.");
    } else {
      const start = anchor;
      const end = point;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const selectedType = roadType(state.roadType || "street");
      const cost = roadConstructionCost(selectedType.id, length);
      if (length < 24) log("Segment trop court : éloigne le point suivant.");
      else if (state.money < cost) log(`Construction impossible : il faut ${cost.toLocaleString("fr-FR")} €.`);
      else {
        if (!Number.isInteger(state.nextRoadId)) state.nextRoadId = 1;
        const road = { id: `built-road-${state.nextRoadId++}`, start, end,
          points: [{ x: start.x, y: start.y }, { x: end.x, y: end.y }],
          type: selectedType.id, lanes: selectedType.lanes, speed: selectedType.speed,
          speedLimit: selectedType.speedLimit, capacity: selectedType.capacity,
          allowStops: selectedType.allowStops, built: true, cost,
          builtAtTick: Math.round((state.time || 0) + (state.elapsedDays || 0) * 1440) };
        if (anchorStopId) road.startStopId = anchorStopId;
        if (stopId) road.endStopId = stopId;
        if (road.startStopId && road.endStopId) {
          road.a = road.startStopId;
          road.b = road.endStopId;
        }
        const overCapacity = (road.a && roadDegree(road.a) >= 3) || (road.b && roadDegree(road.b) >= 3);
        const blockers = traceBlockedBuildings(state, start, end);
        if (overCapacity) {
          log("Construction impossible : un arrêt ne peut pas être relié à plus de 3 routes.");
        } else if (blockers.length) {
          // V27.3 — dette §7 : une voirie ne traverse pas un bâtiment occupé.
          log("Tracé impossible : il traverse " + blockers.length + " bâtiment" + (blockers.length > 1 ? "s" : "") + " — démolis-le" + (blockers.length > 1 ? "s" : "") + " ou contourne-le" + (blockers.length > 1 ? "s" : "") + ".");
        } else {
          expropriateAbandonedAlongTrace(state, start, end, log);
          state.city.roads.push(road);
          state.money -= cost;
          pushRoadAction({ kind: "build", roadId: road.id, road, cost });
          rebuildNetwork();
          state.pendingRoadPoint = end;
          state.pendingRoadStopId = stopId;
          state.roadTrace = null;
          log(`Segment construit (${cost.toLocaleString("fr-FR")} €). Continue, ou Entrée pour terminer.`);
        }
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
      const endpoints = roadEndpoints(road);
      if (!endpoints) return;
      const dx = endpoints.end.x - endpoints.start.x;
      const dy = endpoints.end.y - endpoints.start.y;
      const lengthSquared = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - endpoints.start.x) * dx + (p.y - endpoints.start.y) * dy) / lengthSquared));
      const distanceToRoad = Math.hypot(p.x - (endpoints.start.x + t * dx), p.y - (endpoints.start.y + t * dy));
      const inDetourBounds = p.x >= Math.min(endpoints.start.x, endpoints.end.x) - 30 &&
        p.x <= Math.max(endpoints.start.x, endpoints.end.x) + 30 &&
        p.y >= Math.min(endpoints.start.y, endpoints.end.y) - 30 &&
        p.y <= Math.max(endpoints.start.y, endpoints.end.y) + 30;
      const hitDistance = inDetourBounds ? Math.min(distanceToRoad, 30) : distanceToRoad;
      if (hitDistance < nearestDistance) {
        nearestDistance = hitDistance;
        nearestRoad = road;
      }
    });
    if (nearestRoad) {
      // V27 — refus si une ligne dépend de la voirie : on avertit, on ne
      // bloque pas (le réseau est recalculé, la ligne se recalcule à la volée).
      const usedByLine = (nearestRoad.a && nearestRoad.b && state.lines.some(function (line) {
        return line.route && Array.isArray(line.route.nodeIds)
          && line.route.nodeIds.includes(nearestRoad.a) && line.route.nodeIds.includes(nearestRoad.b);
      })) || false;
      const refund = Math.round((nearestRoad.cost || 0) * 0.3);
      state.city.roads = state.city.roads.filter(function (road) { return road !== nearestRoad; });
      rebuildNetwork();
      pushRoadAction({ kind: "remove", road: nearestRoad, refund });
      state.money += refund;
      if (usedByLine) log("Attention : une ligne utilisait cette voirie, son itinéraire sera recalculé.");
      log(refund > 0
        ? `Route démolie (remboursement ${refund.toLocaleString("fr-FR")} €).`
        : "Route démolie.");
    } else log("Aucune route sous le curseur.");
    updateInstructions();
    refreshUI();
    return;
  }

  if (state.roadEditMode === "upgrade" || state.roadEditMode === "oneWay") {
    // Réutilise la même détection de voirie que la démolition.
    let nearestRoad = null;
    let nearestDistance = 100 / cameraState.zoom;
    state.city.roads.forEach(function (road) {
      const endpoints = roadEndpoints(road);
      if (!endpoints) return;
      const dx = endpoints.end.x - endpoints.start.x;
      const dy = endpoints.end.y - endpoints.start.y;
      const lengthSquared = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - endpoints.start.x) * dx + (p.y - endpoints.start.y) * dy) / lengthSquared));
      const distanceToRoad = Math.hypot(p.x - (endpoints.start.x + t * dx), p.y - (endpoints.start.y + t * dy));
      if (distanceToRoad < nearestDistance) {
        nearestDistance = distanceToRoad;
        nearestRoad = road;
      }
    });
    if (!nearestRoad) log("Aucune route sous le curseur.");
    else if (state.roadEditMode === "oneWay") {
      const fromOneWay = nearestRoad.oneWay === true;
      nearestRoad.oneWay = !fromOneWay;
      pushRoadAction({ kind: "oneWay", roadId: nearestRoad.id, fromOneWay });
      rebuildNetwork();
      log(fromOneWay ? "Sens unique retiré : la voirie redevient bidirectionnelle." : "Sens unique activé sur la voirie.");
    } else {
      const targetType = roadTypeSelectValue();
      const fromType = nearestRoad.type;
      if (fromType === targetType) log("Cette voirie est déjà de ce type.");
      else {
        const endpoints = roadEndpoints(nearestRoad);
        const length = endpoints ? Math.hypot(endpoints.end.x - endpoints.start.x, endpoints.end.y - endpoints.start.y) : 0;
        const diff = Math.round(length * (roadType(targetType).costPerPixel - roadType(fromType).costPerPixel));
        if (diff > 0 && state.money < diff) {
          log(`Amélioration impossible : il faut ${diff.toLocaleString("fr-FR")} €.`);
        } else {
          const fromOneWay = nearestRoad.oneWay === true;
          nearestRoad.type = targetType;
          const spec = roadType(targetType);
          nearestRoad.lanes = spec.lanes;
          nearestRoad.speed = spec.speed;
          nearestRoad.speedLimit = spec.speedLimit;
          nearestRoad.capacity = spec.capacity;
          nearestRoad.allowStops = spec.allowStops;
          if (diff > 0) state.money -= diff;
          else state.money += Math.round(-diff * 0.5); // rétrogradation : remboursement partiel
          pushRoadAction({ kind: "upgrade", roadId: nearestRoad.id, fromType, toType: targetType, fromOneWay, cost: diff });
          rebuildNetwork();
          log(diff > 0
            ? `Voirie convertie en ${spec.name} (${diff.toLocaleString("fr-FR")} €).`
            : `Voirie convertie en ${spec.name} (remboursement ${Math.round(-diff * 0.5).toLocaleString("fr-FR")} €).`);
        }
      }
    }
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
    // V26 — retour haptique discret à la pose d'un arrêt (mobile).
    hapticFeedback(10);
  }
  updateInstructions();
  refreshUI();
}

// V26 — zoom autour d'un point écran (partagé molette / pincement /
// double-tap) : la tuile située sous le doigt reste à sa place.
function zoomAtScreenPoint(sx, sy, targetZoom) {
  const newZoom = Math.max(cameraState.minZoom, Math.min(cameraState.maxZoom, targetZoom));
  const oldZoom = cameraState.zoom;
  if (newZoom === oldZoom) return false;
  const size = getCanvasCssSize();
  if (!size.W || !size.H) return false;
  const wx = (sx - size.W / 2) / oldZoom + cameraState.x;
  const wy = (sy - size.H / 2) / oldZoom + cameraState.y;
  cameraState.zoom = newZoom;
  cameraState.x = wx - (sx - size.W / 2) / newZoom;
  cameraState.y = wy - (sy - size.H / 2) / newZoom;
  syncCameraToRenderer();
  refreshUI();
  return true;
}

function bindMap() {
  // V26 — pincement à deux doigts (pinch-zoom) : suivi multi-pointeurs.
  const activePointers = new Map();
  let pinchState = null;
  const pinchUpdate = function () {
    const pts = Array.from(activePointers.values());
    if (pts.length < 2) { pinchState = null; return false; }
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (!pinchState || dist <= 0) {
      pinchState = {
        dist: dist,
        zoom: cameraState.zoom,
        sx: pts[0].x + (pts[1].x - pts[0].x) / 2,
        sy: pts[0].y + (pts[1].y - pts[0].y) / 2
      };
      return true;
    }
    const size = getCanvasCssSize();
    if (!size.W || !size.H) return true;
    zoomAtScreenPoint(pinchState.sx - size.rect.left, pinchState.sy - size.rect.top, pinchState.zoom * dist / pinchState.dist);
    return true;
  };
  // V26 — double-tap : zoom avant sur le point tapé (±320 ms, ±40 px).
  let lastTap = null;

  const pointerDown = function (e) {
    if (e.pointerId !== undefined) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size >= 2) {
      cameraState.isDragging = false;
      cameraState.moved = true; // un pincement ne doit jamais déclencher un clic
      pinchUpdate();
      return;
    }
    cameraState.isDragging = true;
    cameraState.lastDragX = e.clientX;
    cameraState.lastDragY = e.clientY;
    cameraState.downX = e.clientX;
    cameraState.downY = e.clientY;
    cameraState.moved = false;
  };
  const pointerMove = function (e) {
    if (e.pointerId !== undefined && activePointers.has(e.pointerId)) {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (activePointers.size >= 2) { pinchUpdate(); return; }
    // V27 — aperçu du tracé de route en direct (coût + validité).
    if (state && state.roadEditMode === "build") updateRoadTracePreview(e);
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
    if (e.pointerId !== undefined) activePointers.delete(e.pointerId);
    if (activePointers.size < 2) pinchState = null;
    const wasDragging = cameraState.isDragging;
    cameraState.isDragging = false;
    if (!wasDragging) return;
    if (cameraState.moved) return;
    if (e.preventDefault) e.preventDefault();
    // V26 — double-tap : zoom avant au lieu d'un second clic carte.
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (lastTap && now - lastTap.t <= 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) <= 40) {
      const size = getCanvasCssSize();
      lastTap = null;
      if (size.W && size.H) {
        zoomAtScreenPoint(e.clientX - size.rect.left, e.clientY - size.rect.top, cameraState.zoom * 1.6);
      }
      return;
    }
    lastTap = { x: e.clientX, y: e.clientY, t: now };
    clickMap(e);
  };
  const pointerCancel = function (e) {
    if (e && e.pointerId !== undefined) activePointers.delete(e.pointerId);
    if (activePointers.size < 2) pinchState = null;
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
    zoomAtScreenPoint(e.clientX - size.rect.left, e.clientY - size.rect.top, cameraState.zoom * (e.deltaY > 0 ? 0.9 : 1.1));
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
    renderFleetPanel(state);
    renderMiniMap();
    updateScenarioBanner();
    // V27 — HUD urbanisme : demande par type + panneau du bâtiment sélectionné.
    updateDemandBars();
    renderBuildingPanel();
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
  clearRendererCaches();
  let nextState;
  let nextRng;

  if (restoredPayload) {
    nextState = restoredPayload.state;
    // Correction : les fermetures pour travaux (closedEdgeIds /
    // roadworksReopenDay) doivent etre lues AVANT de reconstruire le reseau
    // depuis la ville, sinon elles etaient definitivement perdues au
    // chargement d'une sauvegarde (les travaux rouvraient en silence).
    const savedNetwork = restoredPayload.state.network;
    nextState.network = createNetwork(nextState.city);
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
  nextState.roadType = roadType(nextState.roadType || "street").id;
  nextState.roadUndoStack = [];
  nextState.roadRedoStack = [];
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
  // V27 — la génération OD depuis les bâtiments est active au boot
  // navigateur ; les sauvegardes antérieures récupèrent des structures vides.
  state.buildingsEnabled = true;
  ensureBuildingsState(state);
  // V27 — amorçage d'une nouvelle partie : quelques zones le long de la
  // voirie générée pour que des bâtiments émergent dès les premières heures.
  // Sans elles, la ville resterait grise et l'OD sans origines.
  seedInitialZones(state, nextRng, log);
  spawnInitialBuildings(state, nextRng, log);
  state.advertisingEnabled = true;
  state.staffCostsEnabled = true;
  const fareLevelSelect = document.getElementById("fareLevelSelect");
  if (fareLevelSelect) fareLevelSelect.value = String(state.fareLevel ?? 1);
  const wageLevelSelect = document.getElementById("wageLevelSelect");
  if (wageLevelSelect) wageLevelSelect.value = String(state.wageLevel ?? 1);
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

let editingLineId = null;
let editingStopIds = [];
function renderLineEditor() {
  const list = document.getElementById("lineEditorStops");
  const select = document.getElementById("lineEditorAddStop");
  if (!list || !select || !state) return;
  const line = state.lines.find(function (item) { return item.id === editingLineId; });
  if (!line) return;
  list.innerHTML = editingStopIds.map(function (id, index) {
    const stop = state.city.stops.find(function (item) { return item.id === id; });
    return '<div class="editor-stop-row"><span class="stop-index">' + (index + 1) + '</span><b>' + h(stop ? stop.name : id) + '</b>' +
      '<button type="button" data-editor-action="up" data-editor-index="' + index + '"' + (index === 0 ? ' disabled' : '') + '>↑</button>' +
      '<button type="button" data-editor-action="down" data-editor-index="' + index + '"' + (index === editingStopIds.length - 1 ? ' disabled' : '') + '>↓</button>' +
      '<button type="button" data-editor-action="remove" data-editor-index="' + index + '"' + (editingStopIds.length <= 2 ? ' disabled' : '') + '>✕</button></div>';
  }).join("");
  const available = state.city.stops.filter(function (stop) { return editingStopIds.indexOf(stop.id) < 0; });
  select.innerHTML = available.length
    ? available.map(function (stop) { return '<option value="' + h(stop.id) + '">' + h(stop.name) + '</option>'; }).join("")
    : '<option value="">Tous les arrêts sont déjà dans la ligne</option>';
  select.disabled = !available.length;
}
function openLineEditor(lineId) {
  if (!state) return;
  const line = state.lines.find(function (item) { return item.id === lineId; });
  if (!line) return;
  editingLineId = lineId;
  editingStopIds = [...line.stopIds];
  renderLineEditor();
  const modal = document.getElementById("lineEditorModal");
  if (modal && typeof modal.showModal === "function") modal.showModal();
  else if (modal) modal.setAttribute("open", "true");
}
function closeLineEditor() {
  const modal = document.getElementById("lineEditorModal");
  if (modal && typeof modal.close === "function") modal.close();
  else if (modal) modal.removeAttribute("open");
  editingLineId = null;
  editingStopIds = [];
}
function applyEditorAction(action, index) {
  if (!Number.isInteger(index) || index < 0 || index >= editingStopIds.length) return;
  if (action === "up" && index > 0) {
    [editingStopIds[index - 1], editingStopIds[index]] = [editingStopIds[index], editingStopIds[index - 1]];
  } else if (action === "down" && index < editingStopIds.length - 1) {
    [editingStopIds[index + 1], editingStopIds[index]] = [editingStopIds[index], editingStopIds[index + 1]];
  } else if (action === "remove" && editingStopIds.length > 2) {
    editingStopIds.splice(index, 1);
  }
  renderLineEditor();
}
bindTap(document.getElementById("newLineBtn"), function () {
  if (!state) return;
  if (state.lineMode) cancelLineMode(state);
  else createLine(state);
  updateInstructions();
  refreshUI();
});

bindTap(document.getElementById("gameMenuBtn"), function () { toggleGameMenu(); });
bindTap(document.getElementById("voirieBtn"), function () {
  const group = document.getElementById("voirieGroup");
  if (group) group.dataset.open = group.dataset.open === "true" ? "false" : "true";
  updateToolbarVisibility();
});
document.addEventListener("click", function (event) {
  const menu = document.getElementById("gameMenuDropdown");
  const button = document.getElementById("gameMenuBtn");
  if (menu && button && !menu.contains(event.target) && event.target !== button) toggleGameMenu(false);
});

const roadTypeSelectEl = document.getElementById("roadTypeSelect");
if (roadTypeSelectEl) roadTypeSelectEl.addEventListener("change", function () {
  if (!state) return;
  // V27 — les quatre types officiels, plus les alias historiques.
  state.roadType = roadType(roadTypeSelectEl.value || "street").id;
  updateInstructions();
});

function enterRoadMode(mode) {
  if (!state) return;
  if (state.lineMode) cancelLineMode(state);
  // V27 — un outil d'urbanisme remplace l'outil de voirie armé.
  state.zoneMode = null;
  state.pendingZoneCorner = null;
  state.roadEditMode = state.roadEditMode === mode ? null : mode;
  state.pendingRoadPoint = null;
  state.pendingRoadStopId = null;
  state.roadTrace = null;
  updateInstructions();
  refreshUI();
}

// V27 — urbanisme -----------------------------------------------------------

function zoneTypeSelectValue() {
  const select = document.getElementById("zoneTypeSelect");
  const value = select && select.value;
  return ZONE_TYPES[value] ? value : "residential";
}

/** Outil de zonage armé : "zone", "unzone", "inspect" ; re-clic = désarme. */
function enterZoneMode(mode) {
  if (!state) return;
  if (state.lineMode) cancelLineMode(state);
  // Un outil de voirie remplace l'outil d'urbanisme armé.
  state.roadEditMode = null;
  state.pendingRoadPoint = null;
  state.roadTrace = null;
  state.zoneMode = state.zoneMode === mode ? null : mode;
  state.pendingZoneCorner = null;
  if (!state.zoneMode && state.selectedBuildingId) state.selectedBuildingId = null;
  if (!state.zoneMode) renderBuildingPanel();
  updateInstructions();
  refreshUI();
}

/** Bâtiment sous le point (marge de tolérance 6 px). */
function buildingAtPoint(p) {
  const buildings = (state && state.city && state.city.buildings) || [];
  for (const b of buildings) {
    if (p.x >= b.x - 6 && p.x <= b.x + b.w + 6 && p.y >= b.y - 6 && p.y <= b.y + b.h + 6) return b;
  }
  return null;
}

/** Panneau latéral du bâtiment sélectionné (couverture, valeur, habitants…).
 *  Ne reconstruit le DOM que si la sélection ou les stats changent. */
let buildingPanelSignature = "";
function renderBuildingPanel() {
  const panel = document.getElementById("buildingPanel");
  if (!panel || !state) return;
  const building = ((state.city && state.city.buildings) || []).find(function (b) {
    return b.id === state.selectedBuildingId;
  });
  if (!building) {
    panel.hidden = true;
    panel.innerHTML = "";
    buildingPanelSignature = "";
    return;
  }
  const signature = [building.id, building.residents, building.jobs, building.occupants,
    building.landValue, building.abandoned, building.level, building.density].join("|");
  if (signature === buildingPanelSignature && !panel.hidden) return;
  buildingPanelSignature = signature;
  const spec = BUILDING_TYPES[building.type] || BUILDING_TYPES.residential;
  const zone = ((state.city && state.city.zones) || []).find(function (z) { return z.id === building.zoneId; });
  const zoneLabel = zone ? (ZONE_TYPES[zone.type] || { label: zone.type }).label : "—";
  const days = Math.floor((building.age || 0) / 24);
  panel.hidden = false;
  panel.innerHTML =
    '<div class="building-panel-head"><span>' + (spec.icon || "🏠") + "</span><b>" + h(spec.label) + "</b>" +
    '<button type="button" class="building-panel-close" data-building-close aria-label="Fermer le panneau du bâtiment">✕</button></div>' +
    '<dl class="building-panel-stats">' +
    "<dt>Densité</dt><dd>" + h(building.density || "low") + " · niveau " + (building.level || 1) + "</dd>" +
    "<dt>Habitants</dt><dd>" + (building.residents || 0) + "</dd>" +
    "<dt>Emplois</dt><dd>" + (building.jobs || 0) + "</dd>" +
    "<dt>Occupation</dt><dd>" + Math.round((building.occupants || 0) * 100) + " %</dd>" +
    "<dt>Valeur foncière</dt><dd>" + Math.round((building.landValue || 0) * 100) + " %</dd>" +
    "<dt>Zone</dt><dd>" + h(zoneLabel) + "</dd>" +
    "<dt>Âge</dt><dd>" + days + " jour" + (days > 1 ? "s" : "") + "</dd>" +
    "</dl>" +
    (building.abandoned ? '<p class="building-panel-warn">⚠️ Bâtiment abandonné : il ne génère plus de passagers.</p>' : "") +
    '<button type="button" class="btn btn-warn" data-building-demolish="' + h(building.id) + '">🧨 Démolir</button>';
}

/** Démolition depuis le panneau : les résidents non relogés pèsent sur la satisfaction. */
document.addEventListener("click", function (event) {
  const target = event.target;
  if (!target || !target.getAttribute) return;
  if (target.getAttribute("data-building-close")) {
    if (state) state.selectedBuildingId = null;
    renderBuildingPanel();
  } else if (target.getAttribute("data-building-demolish")) {
    if (state) {
      demolishBuilding(state, target.getAttribute("data-building-demolish"), log);
      state.selectedBuildingId = null;
      renderBuildingPanel();
      refreshUI();
    }
  }
});

/** HUD — mini-barres verticales de demande par type de zone (0–100 %). */
function updateDemandBars() {
  const el = document.getElementById("demandBars");
  if (!el || !state || !state.buildingsEnabled) return;
  const stats = buildingStats(state);
  const rows = [
    { key: "residential", label: "Résidentiel", color: "#55b878" },
    { key: "commercial", label: "Commercial", color: "#f4a261" },
    { key: "industrial", label: "Industriel", color: "#8d6e63" },
    { key: "service", label: "Services", color: "#4f8fc0" }
  ];
  el.innerHTML = rows.map(function (row) {
    const pct = Math.round(Math.max(0, Math.min(1, (stats.demand && stats.demand[row.key]) || 0)) * 100);
    return '<span class="demand-item" title="' + row.label + " : " + pct + ' %"><i class="demand-mini" aria-hidden="true">' +
      '<b style="height:' + Math.max(4, pct * 0.16) + 'px;background:' + row.color + '"></b></i>' +
      '<span class="demand-label">' + row.label + "</span></span>";
  }).join("");
}

bindTap(document.getElementById("buildRoadBtn"), function () { enterRoadMode("build"); });
bindTap(document.getElementById("removeRoadBtn"), function () { enterRoadMode("remove"); });
bindTap(document.getElementById("upgradeRoadBtn"), function () { enterRoadMode("upgrade"); });
bindTap(document.getElementById("oneWayRoadBtn"), function () { enterRoadMode("oneWay"); });
bindTap(document.getElementById("undoRoadBtn"), function () { undoRoadAction(); });
bindTap(document.getElementById("redoRoadBtn"), function () { redoRoadAction(); });

// V27 — urbanisme : zonage, dézonage, inspection, affichages.
bindTap(document.getElementById("urbanismeBtn"), function () {
  const group = document.getElementById("urbanismeGroup");
  if (group) group.dataset.open = group.dataset.open === "true" ? "false" : "true";
  updateToolbarVisibility();
});
bindTap(document.getElementById("zoneBtn"), function () { enterZoneMode("zone"); });
bindTap(document.getElementById("unzoneBtn"), function () { enterZoneMode("unzone"); });
bindTap(document.getElementById("inspectBtn"), function () { enterZoneMode("inspect"); });
bindTap(document.getElementById("toggleLandValueBtn"), function () {
  if (!state) return;
  state.showLandValue = !state.showLandValue;
  const button = document.getElementById("toggleLandValueBtn");
  if (button) button.setAttribute("aria-pressed", String(state.showLandValue));
  refreshUI();
});
bindTap(document.getElementById("toggleZonesBtn"), function () {
  if (!state) return;
  state.showZones = !state.showZones;
  const button = document.getElementById("toggleZonesBtn");
  if (button) button.setAttribute("aria-pressed", String(state.showZones));
  refreshUI();
});

// V27 — clavier du tracé : Échap annule le tracé / le mode, Entrée termine la
// chaîne de segments, Ctrl+Z / Ctrl+Shift+Z pilotent l'annulation voirie.
document.addEventListener("keydown", function (e) {
  if (!state) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName || "");
  if (e.key === "Escape") {
    setMapMenu("std");
    if (state.pendingRoadPoint) { endRoadTrace(); e.preventDefault(); return; }
    if (state.roadEditMode) { enterRoadMode(state.roadEditMode); e.preventDefault(); return; }
    if (state.zoneMode) { enterZoneMode(state.zoneMode); e.preventDefault(); }
    return;
  }
  if (typing) return;
  if (e.key === "Enter" && state.roadEditMode === "build" && state.pendingRoadPoint) {
    endRoadTrace();
    e.preventDefault();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
    if (e.shiftKey) redoRoadAction(); else undoRoadAction();
    e.preventDefault();
  }
});

// Double-clic : termine la chaîne de tracé de route.
canvas.addEventListener("dblclick", function (e) {
  if (state && state.roadEditMode === "build" && state.pendingRoadPoint) {
    e.preventDefault();
    endRoadTrace();
  }
});

bindTap(document.getElementById("finishLineBtn"), function () {
  if (!state) return;
  const minStops = state.extendingLineId ? 1 : 2;
  if (state.pendingStops.length < minStops) return;
  const modeSelect = document.getElementById("modeSelect");
  const created = state.extendingLineId
    ? finishExtendLine(state, log, routeLine)
    : finishLine(state, log, routeLine, (modeSelect && modeSelect.value) || "bus");
  // V26 — retour haptique à la validation d'une ligne (mobile).
  if (created) hapticFeedback(15);
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
  const seed = "CITY-" + Date.now() + "-" + Math.floor(Math.random() * 1000000);
  const scenarioSelect = document.getElementById("scenarioSelect");
  boot(seed, (scenarioSelect && scenarioSelect.value) || "sandbox");
  toggleGameMenu(false);
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

bindDelegatedTap(document.getElementById("lines"), "[data-edit-line]", function (target) {
  openLineEditor(Number(target.dataset.editLine));
});
bindDelegatedTap(document.getElementById("advertisingPanel"), "[data-campaign]", function (target) {
  if (!state) return;
  startCampaign(state, target.dataset.campaign, log);
  refreshUI();
});
bindTap(document.getElementById("advertisingBtn"), function () {
  const panel = document.getElementById("advertisingPanel");
  const details = panel && panel.closest("details");
  if (details) details.open = true;
  if (panel) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
});
const editorStopsEl = document.getElementById("lineEditorStops");
if (editorStopsEl) {
  bindDelegatedTap(editorStopsEl, "[data-editor-action]", function (target) {
    applyEditorAction(target.dataset.editorAction, Number(target.dataset.editorIndex));
  });
}
bindTap(document.getElementById("lineEditorAddBtn"), function () {
  const select = document.getElementById("lineEditorAddStop");
  if (!select || !select.value || editingStopIds.indexOf(select.value) >= 0) return;
  editingStopIds.push(select.value);
  renderLineEditor();
});
bindTap(document.getElementById("lineEditorCancelBtn"), closeLineEditor);
bindTap(document.getElementById("lineEditorSaveBtn"), function () {
  if (!state || editingLineId == null) return;
  if (editLineStops(state, editingLineId, editingStopIds, routeLine, log)) {
    closeLineEditor();
    refreshUI();
  }
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
// V26 — panneau coulissant mobile : replié par défaut, ouvert d'un tap au pouce.
function bindSheet() {
  const handle = document.getElementById("sheetHandle");
  const dashboard = document.querySelector(".dashboard");
  if (!handle || !dashboard) return;
  handle.addEventListener("click", function () {
    const open = dashboard.classList.toggle("sheet-open");
    handle.setAttribute("aria-expanded", String(open));
    // V27.4 — le panneau ouvert devient une vue plein écran : la classe
    // body.sheet-open retire la barre d'outils flottante (elle recouvrait
    // le bas du tableau de bord, z-index 130 > 120) et libère l'écran.
    document.body.classList.toggle("sheet-open", open);
    const label = document.getElementById("sheetHandleLabel");
    if (label) label.textContent = open ? "✕ Fermer" : "📊 Tableau de bord";
    // V27.2 — à l'ouverture, déplier le premier onglet si aucun ne l'est :
    // sinon le tableau de bord paraît vide et inutile.
    if (open) {
      const tabs = dashboard.querySelectorAll("details.dashboard-tab");
      const anyOpen = Array.prototype.some.call(tabs, function (tab) { return tab.open; });
      if (!anyOpen && tabs.length) tabs[0].open = true;
    }
  });
  // V27.4 — accordéon exclusif sur smartphone : ouvrir un onglet referme
  // les autres (une pile de 6 onglets dépliés est illisible sur petit
  // écran). Sur desktop, le comportement multi-onglets est inchangé.
  const sheetTabs = dashboard.querySelectorAll("details.dashboard-tab");
  Array.prototype.forEach.call(sheetTabs, function (tab) {
    tab.addEventListener("toggle", function () {
      if (!tab.open || !window.matchMedia("(max-width: 700px)").matches) return;
      Array.prototype.forEach.call(sheetTabs, function (other) {
        if (other !== tab) other.open = false;
      });
    });
  });
}

// V26 — installation PWA quand le navigateur propose sa bannière native.
function bindInstallPrompt() {
  const btn = document.getElementById("installBtn");
  if (!btn) return;
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    btn.hidden = false;
  });
  btn.addEventListener("click", function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () {
      deferredPrompt = null;
      btn.hidden = true;
    }).catch(function () { btn.hidden = true; });
  });
  window.addEventListener("appinstalled", function () { btn.hidden = true; });
}


// === V27.5 — Menu en cascade dans la carte : 3 boutons par niveau =========
// std affiche 3 boutons ; chaque clic remplace le trio affiché (n1, n2,
// pages annexes) ; ✕ revient à std. Les actions pilotent les contrôles
// historiques, cachés mais présents (tests statiques + smoke test).
const MAP_MENU = {
  "std": [
    { label: "🛣️ Voirie", goto: "voirie" },
    { label: "🏙️ Urbanisme", goto: "urbanisme" },
    { label: "🚌 Ligne", goto: "ligne" }
  ],
  "voirie": [
    { label: "🛣️ Construire ▸", goto: "voirie-types" },
    { label: "🧹 Supprimer", act: "removeRoadBtn" },
    { label: "🧰 Éditer ▸", goto: "voirie-edits" }
  ],
  "voirie-types": [
    { label: "🏘️ Rue", select: "roadTypeSelect", value: "street", act: "buildRoadBtn" },
    { label: "🔗 Avenue", select: "roadTypeSelect", value: "avenue", act: "buildRoadBtn" },
    { label: "▸ Autres types", goto: "voirie-types-2" }
  ],
  "voirie-types-2": [
    { label: "🛣️ Boulevard", select: "roadTypeSelect", value: "boulevard", act: "buildRoadBtn" },
    { label: "🏎️ Voie rapide", select: "roadTypeSelect", value: "highway", act: "buildRoadBtn" },
    { label: "◂ Retour", goto: "voirie-types" }
  ],
  "voirie-edits": [
    { label: "⬆️ Améliorer", act: "upgradeRoadBtn" },
    { label: "➡️ Sens unique", act: "oneWayRoadBtn" },
    { label: "↩️ Historique ▸", goto: "voirie-history" }
  ],
  "voirie-history": [
    { label: "↩️ Annuler", act: "undoRoadBtn" },
    { label: "↪️ Rétablir", act: "redoRoadBtn" },
    { label: "◂ Retour", goto: "voirie-edits" }
  ],
  "urbanisme": [
    { label: "🖍️ Zoner ▸", goto: "urbanisme-zones" },
    { label: "🚫 Dézoner", act: "unzoneBtn" },
    { label: "🔍 Inspecter", act: "inspectBtn" }
  ],
  "urbanisme-zones": [
    { label: "🏘️ Résidentiel", select: "zoneTypeSelect", value: "residential", act: "zoneBtn" },
    { label: "🛍️ Commercial", select: "zoneTypeSelect", value: "commercial", act: "zoneBtn" },
    { label: "▸ Autres zones", goto: "urbanisme-zones-2" }
  ],
  "urbanisme-zones-2": [
    { label: "🏭 Industriel", select: "zoneTypeSelect", value: "industrial", act: "zoneBtn" },
    { label: "🏫 Services", select: "zoneTypeSelect", value: "service", act: "zoneBtn" },
    { label: "◂ Retour", goto: "urbanisme-zones" }
  ],
  "ligne": [
    { label: "✏️ Nouvelle ligne", act: "newLineBtn" },
    { label: "🚊 Mode ▸", goto: "ligne-modes" },
    { label: "🎯 Recentrer", act: "resetZoomBtn" }
  ],
  "ligne-modes": [
    { label: "🚌 Bus", select: "modeSelect", value: "bus" },
    { label: "🚊 Tramway", select: "modeSelect", value: "tram" },
    { label: "🚇 Métro", select: "modeSelect", value: "metro" }
  ]
};

let mapMenuLevel = "std";

function setMapMenu(level) {
  const container = document.getElementById("mapMenu");
  if (!container) return;
  mapMenuLevel = MAP_MENU[level] ? level : "std";
  container.textContent = "";
  const items = MAP_MENU[mapMenuLevel];
  // ✕ uniquement hors niveau std : revient au menu racine.
  if (mapMenuLevel !== "std") {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn btn-map-back";
    back.setAttribute("aria-label", "Revenir au menu principal de la carte");
    back.textContent = "✕";
    bindTap(back, function () { setMapMenu("std"); });
    container.appendChild(back);
  }
  // V27.6 — retour visuel : la branche racine liée à l'outil armé
  // (voirie / urbanisme / ligne) reste surlignée sur le trio std.
  const armed = state && state.roadEditMode ? "voirie"
    : state && state.zoneMode ? "urbanisme"
    : state && (state.lineMode || (state.pendingStops && state.pendingStops.length)) ? "ligne"
    : null;
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    if (mapMenuLevel === "std" && armed && item.goto === armed) btn.classList.add("is-active");
    btn.textContent = item.label;
    if (item.goto) {
      bindTap(btn, function () { setMapMenu(item.goto); });
    } else {
      bindTap(btn, function () {
        if (item.select) {
          const sel = document.getElementById(item.select);
          if (sel) { sel.value = item.value; sel.dispatchEvent(new Event("change")); }
        }
        const target = item.act && document.getElementById(item.act);
        if (target) target.click();
        // Après une action, retour à la racine : la carte reprend la main.
        setMapMenu("std");
      });
    }
    container.appendChild(btn);
  }
}

// Les contrôles historiques restent dans le DOM (branchés et testables) mais
// cèdent la place au menu en cascade. « Terminer » garde sa logique propre.
(function initMapMenu() {
  // Robustesse cache : si le shell HTML vient d'une version antérieure sans
  // conteneur #mapMenu, on le crée — sinon les boutons historiques seraient
  // cachés sans aucun menu pour les remplacer (barre vide).
  let container = document.getElementById("mapMenu");
  if (!container) {
    const toolbar = document.querySelector(".floating-toolbar");
    if (!toolbar) return;
    container = document.createElement("div");
    container.id = "mapMenu";
    container.className = "map-menu";
    container.setAttribute("aria-label", "Menu de la carte");
    toolbar.insertBefore(container, toolbar.firstChild);
  }
  const legacy = document.querySelectorAll(".floating-toolbar > button:not(#finishLineBtn), .floating-toolbar > .tool-group");
  Array.prototype.forEach.call(legacy, function (el) { el.hidden = true; });
  setMapMenu("std");
})();

bindSheet();
bindInstallPrompt();
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













