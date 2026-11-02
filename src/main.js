import { createCity, createSeedFromQuery, mulberry32 } from "./city.js";
import { createState } from "./state.js";
import { SCENARIOS, findScenario, scenarioProgress, scenarioObjectives, MEDAL_EMOJI, loadScenarioRecords, recordScenarioResult, saveScenarioRecords } from "./scenarios.js";
import { createLine, cancelLineMode, finishLine, startExtendLine, finishExtendLine, editLineStops, step, STOP_RADIUS, buyVehicleForLine, sellVehicleFromLine, deleteLine, networkFinancials, congestionHeatmap, cityJournal, estimateLineCost } from "./engine.js";
import { createNetwork, routeLine, createUndergroundNetwork, createTramNetwork, roadType, roadConstructionCost, validateNetwork, ROAD_TYPES } from "./network.js";
import { createRenderer, clearRendererCaches, renderFleetPanel } from "./renderer.js";
import { saveGame, readSavedGame, SAVE_KEY, exportGameToFile, importGameFromFile } from "./persistence.js";
import { escapeHtml as h } from "./html.js";
import { invalidateRoutingCache } from "./routing.js";
import { ensureBuildingsState, addZone, removeZone, demolishBuilding, buildingStats, BUILDING_TYPES, ZONE_TYPES, seedInitialZones, traceBlockedBuildings, expropriateAbandonedAlongTrace, spawnInitialBuildings } from "./buildings.js";
import { developCityCarrefours } from "./carrefours.js";
import { refreshAllLineRoutes } from "./disruptions.js";
import { startCampaign } from "./advertising.js";
import { pruneRedundantRoads, pruneOrphanCarrefourStops } from "./pruning.js";
import { buildStop, demolishStop, upgradeStopMultimodal, STOP_BUILD_COST, MULTIMODAL_UPGRADE_COST } from "./stops.js";
import { planTotalCost, applyPlan, clearPlan } from "./planning.js";
import { TICK_MINUTES } from "./engine.js";
import { fastForwardDay } from "./worker-client.js";

const canvas = document.getElementById("map");
const miniMapCanvas = document.getElementById("miniMapCanvas");
const rendererState = { current: null };
let state = null;
let rng = null;
let rafId = null;
let bootCount = 0;

const cameraState = {
  x: 0, y: 0, zoom: 1,
  minZoom: 0.25, maxZoom: 3, // V29.6 — 0.25 : 🎯 cadre toute la ville même sur mobile
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
  // V28.2 — sur mobile la barre flottante ne porte plus que « Terminer » :
  // vide elle se réduit à rien (is-idle) et la cascade occupe le bas de
  // l'écran ; occupée, le panneau de cascade remonte au-dessus d'elle
  // (body.toolbar-busy, règles V28.2 dans style.css).
  const finishBtn = document.getElementById("finishLineBtn");
  const toolbarBusy = !!(finishBtn && !finishBtn.hidden);
  document.body.classList.toggle("toolbar-busy", toolbarBusy);
  const floatingToolbar = document.querySelector(".floating-toolbar");
  if (floatingToolbar) {
    floatingToolbar.classList.toggle("is-idle",
      !toolbarBusy && window.matchMedia("(max-width: 959px)").matches);
  }
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
  } else if (state.planMode) {
    const planCount = (state.planQueue || []).length;
    const planSum = planTotalCost(state.planQueue || []);
    const affordable = state.money >= planSum;
    el.innerHTML = "📋 <b>Planification</b> : " + planCount + " travail" + (planCount > 1 ? "s" : "") +
      " planifié" + (planCount > 1 ? "s" : "") + ", total <b" + (affordable ? "" : ' style="color:#ef476f"') + ">" +
      planSum.toLocaleString("fr-FR") + " €</b>" +
      (planCount === 0
        ? " — pose tes routes (🛣️) et tes arrêts (🚏) sans payer."
        : (affordable ? " — touche <b>✅</b> pour valider ou <b>✖</b> pour abandonner." : " (budget insuffisant à la validation)."));
  } else if (state.stopToolMode === "build") {
    el.innerHTML = "Arrêt : clique l'emplacement du <b>nouvel arrêt</b> (" + STOP_BUILD_COST.toLocaleString("fr-FR") + " €).";
  } else if (state.stopToolMode === "demolish") {
    el.innerHTML = "Suppression : clique l'<b>arrêt</b> à démolir (refusé s'il est desservi par une ligne).";
  } else if (state.stopToolMode === "multimodal") {
    el.innerHTML = "Multimodal : clique un <b>arrêt</b> à transformer en pôle (" + MULTIMODAL_UPGRADE_COST.toLocaleString("fr-FR") + " €).";
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
  updatePlanButtons();
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
    if (e && (e.type === "touchend" || e.type === "pointerup" || e.type === "pointercancel")) {
      lastTouch = Date.now();
      if (e.preventDefault) e.preventDefault();
    }
    handler(e);
  };
  if (window.PointerEvent) {
    // V39 — tap réel robuste : sur un vrai doigt, un léger glissé (quelques
    // pixels à peine) suffit au navigateur pour confier le geste à un
    // conteneur défilable de la chaîne (page, barre horizontale, panneau
    // scrollable) : il émet alors pointercancel — ni click ni pointerup —
    // et le bouton paraît inerte, par intermittence (le « Terminer ne
    // fonctionne pas toujours » du joueur). Une touche courte qui n'a fait
    // dériver AUCUN ancêtre scrollable (ou ≤ 12 px : dérapage involontaire)
    // était un tap : on annule ce mini-dérapage et on invoque le handler.
    let downAt = 0;
    let marks = null;
    el.addEventListener("pointerdown", function (e) {
      downAt = (e.pointerType !== "mouse" && e.isPrimary) ? Date.now() : 0;
      marks = [];
      let node = el;
      while (node && node !== document.documentElement) {
        marks.push([node, node.scrollLeft, node.scrollTop]);
        node = node.parentElement;
      }
    }, { passive: true });
    const scrollDrift = function () {
      if (!marks) return Infinity;
      let drift = 0;
      for (let i = 0; i < marks.length; i++) {
        drift = Math.max(drift,
          Math.abs(marks[i][0].scrollLeft - marks[i][1]),
          Math.abs(marks[i][0].scrollTop - marks[i][2]));
      }
      return drift;
    };
    el.addEventListener("pointerup", invoke, { passive: false });
    el.addEventListener("pointercancel", function (e) {
      if (!downAt || Date.now() - downAt > 600) return;
      if (scrollDrift() > 12) return;
      for (let i = 0; i < marks.length; i++) {
        if (marks[i][0].scrollLeft !== marks[i][1]) marks[i][0].scrollLeft = marks[i][1];
        if (marks[i][0].scrollTop !== marks[i][2]) marks[i][0].scrollTop = marks[i][2];
      }
      invoke(e);
    }, { passive: false });
    el.addEventListener("click", invoke);
    // V36 — click fantôme : le handler de pointerup peut changer la page du
    // menu (✕ → racine, « ▸ » → sous-page) ; le bouton tapé se masque alors
    // et le click synthétique qui suit le touchend retombe sur le bouton
    // révélé au même endroit — le ✕ rouvrait « Voirie », la navigation vers
    // Arrêts armait « Pôle multimodal ». Sur tactile, pointerup a déjà tout
    // traité : on annule ce click parasite.
    el.addEventListener("touchend", function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
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
    if (e.type === "touchend" || e.type === "pointerup" || e.type === "pointercancel") {
      lastTouch = Date.now();
      if (e.preventDefault) e.preventDefault();
    }
    handler(target, e);
  };
  if (window.PointerEvent) {
    // V39 — même récupération des taps annulés que bindTap (voir ci-dessus).
    let downAt = 0;
    let marks = null;
    container.addEventListener("pointerdown", function (e) {
      downAt = (e.pointerType !== "mouse" && e.isPrimary) ? Date.now() : 0;
      marks = [];
      let node = container;
      while (node && node !== document.documentElement) {
        marks.push([node, node.scrollLeft, node.scrollTop]);
        node = node.parentElement;
      }
    }, { passive: true });
    const scrollDrift = function () {
      if (!marks) return Infinity;
      let drift = 0;
      for (let i = 0; i < marks.length; i++) {
        drift = Math.max(drift,
          Math.abs(marks[i][0].scrollLeft - marks[i][1]),
          Math.abs(marks[i][0].scrollTop - marks[i][2]));
      }
      return drift;
    };
    container.addEventListener("pointerup", invoke, { passive: false });
    container.addEventListener("pointercancel", function (e) {
      if (!downAt || Date.now() - downAt > 600) return;
      if (scrollDrift() > 12) return;
      for (let i = 0; i < marks.length; i++) {
        if (marks[i][0].scrollLeft !== marks[i][1]) marks[i][0].scrollLeft = marks[i][1];
        if (marks[i][0].scrollTop !== marks[i][2]) marks[i][0].scrollTop = marks[i][2];
      }
      invoke(e);
    }, { passive: false });
    container.addEventListener("click", invoke);
    // V36 — click fantôme : le handler de pointerup peut changer la page du
    // menu (✕ → racine, « ▸ » → sous-page) ; le bouton tapé se masque alors
    // et le click synthétique qui suit le touchend retombe sur le bouton
    // révélé au même endroit — le ✕ rouvrait « Voirie », la navigation vers
    // Arrêts armait « Pôle multimodal ». Sur tactile, pointerup a déjà tout
    // traité : on annule ce click parasite.
    container.addEventListener("touchend", function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
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
  // Correction : sans ce recalcul, toute edition de voirie (construction,
  // demolition, amelioration, sens unique, annuler/retablir) laissait les
  // lignes existantes sur des noeuds disparus du graphe reconstruit : les
  // vehicules se figeaient silencieusement et les passagers restaient a bord.
  refreshAllLineRoutes(state, log);
  // V29 — garde-fou structurel : un graphe incohérent doit se voir dans le
  // journal de ville, jamais rester un comportement silencieux.
  reportNetworkViolations(state, log);
}

// V29 — diagnostic du garde-fou validateNetwork() : journalise plutôt qu'il ne
// lève, pour ne jamais interrompre une partie en cours. L'invariant clé en
// production : aucune arête ne peut être plus longue que la diagonale de la
// carte (le symptôme historique des nœuds fusionnés par collision d'ids).
function reportNetworkViolations(targetState, log) {
  if (!targetState || !targetState.network || !targetState.city) return;
  const diagonal = Math.hypot(targetState.city.width || 1000, targetState.city.height || 650);
  const violations = validateNetwork(targetState.network, targetState.city, { maxEdgeLength: diagonal });
  if (violations.length) {
    log("⚠️ Réseau incohérent : " + violations[0] + (violations.length > 1 ? " (+" + (violations.length - 1) + " autre" + (violations.length > 2 ? "s" : "") + ")" : ""));
  }
}

// V29.2 — déssaimage automatique de la voirie : la génération urbaine crée
// des secondes liaisons et des boucles de secours qui, à mesure que la
// ville pousse, finissent par se croiser inutilement — chaque croisement
// devient un carrefour et la carte se couvre de nœuds. Au boot (ville neuve
// comme sauvegarde restaurée), les tronçons REDONDANTS (leur retrait ne
// déconnecte aucun arrêt) sont retirés, puis les arrêts de carrefour devenus
// orphelins disparaissent. Les voiries du joueur (construites, corridors,
// tracés libres) ne sont jamais candidates ; le déssaimage est idempotent.
function rationaliseCityRoads() {
  const protectedIds = new Set();
  (state.lines || []).forEach(function (line) {
    (line.stopIds || []).forEach(function (id) { protectedIds.add(id); });
  });
  (state.pendingStops || []).forEach(function (id) { protectedIds.add(id); });
  const report = pruneRedundantRoads(state.city);
  const orphanStops = pruneOrphanCarrefourStops(state.city, protectedIds);
  if (report.removed.length || orphanStops.length) {
    rebuildNetwork();
    log("🧹 Voirie rationalisée : " + report.removed.length + " tronçon" +
      (report.removed.length > 1 ? "s" : "") + " redondant" + (report.removed.length > 1 ? "s" : "") +
      " retiré" + (report.removed.length > 1 ? "s" : "") + ", " + orphanStops.length +
      " arrêt" + (orphanStops.length > 1 ? "s" : "") + " de carrefour orphelin" + (orphanStops.length > 1 ? "s" : "") + ".");
  }
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
  const tooExpensive = !state.planMode && state.money < cost;
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

// V30 — armement d'un outil d'arrêt : les autres modes se désarment pour
// qu'un tracé de ligne, un zonage et une pose d'arrêt ne se disputent pas le tap.
function setStopToolMode(mode) {
  if (!state) return;
  state.stopToolMode = state.stopToolMode === mode ? null : mode;
  if (state.stopToolMode) {
    if (state.lineMode) cancelLineMode(state);
    state.roadEditMode = null;
    state.pendingRoadPoint = null;
    state.pendingRoadStopId = null;
    state.zoneMode = null;
    state.pendingZoneCorner = null;
  }
  updateInstructions();
  refreshUI();
}

// V30 — un tap en mode outil d'arrêt : pose, démolition ou upgrade multimodal.
function handleStopToolTap(p) {
  if (state.stopToolMode === "build") {
    // V33 — en mode planification, l'arrêt rejoint la file sans être payé.
    const free = !!state.planMode;
    const stop = buildStop(state, p.x, p.y, log, { free });
    if (stop) {
      if (free) state.planQueue.push({ kind: "stop", stopId: stop.id, cost: STOP_BUILD_COST });
      rebuildNetwork();
      hapticFeedback(10);
      state.stopToolMode = null;
    }
    return;
  }
  let nearest = null;
  let best = Infinity;
  state.city.stops.forEach(function (stop) {
    const d = Math.hypot(stop.x - p.x, stop.y - p.y);
    const HIT = Math.max(STOP_RADIUS * 2.8, 36);
    if (d <= HIT && d < best) { nearest = stop; best = d; }
  });
  if (!nearest) { log("Touche un arrêt existant sur la carte."); return; }
  if (state.stopToolMode === "demolish") {
    if (demolishStop(state, nearest.id, log)) { rebuildNetwork(); state.stopToolMode = null; }
  } else if (state.stopToolMode === "multimodal") {
    if (upgradeStopMultimodal(state, nearest.id, log)) state.stopToolMode = null;
  }
}

// V33 — mode planification : la partie se met en pause pendant que le joueur
// pose ses travaux ; ceux-ci rejoignent une file puis sont payés d'un bloc.
function setPlanMode(on) {
  if (!state) return;
  state.planMode = !!on;
  const pauseBtn = document.getElementById("pauseBtn");
  if (state.planMode) {
    state.planResumeAfter = !state.paused;
    state.paused = true;
    if (pauseBtn) pauseBtn.textContent = "▶ Reprendre";
    log("📋 Planification : partie en pause. Pose tes travaux, puis valide le plan (✅) ou abandonne-le (✖).");
  } else {
    if (state.planResumeAfter) state.paused = false;
    state.planResumeAfter = false;
    if (pauseBtn) pauseBtn.textContent = state.paused ? "▶ Reprendre" : "⏸ Pause";
  }
  updatePlanButtons();
  updateInstructions();
  refreshUI();
}

// V33 — boutons du plan : valider/abandonner n'existent qu'en mode plan.
function updatePlanButtons() {
  const modeBtn = document.getElementById("planModeBtn");
  const applyBtn = document.getElementById("planApplyBtn");
  const clearBtn = document.getElementById("planClearBtn");
  const n = (state && state.planQueue && state.planQueue.length) || 0;
  if (modeBtn) {
    modeBtn.textContent = state && state.planMode ? "📋 Quitter le plan" : "📋 Planifier";
    modeBtn.setAttribute("aria-pressed", String(!!(state && state.planMode)));
  }
  if (applyBtn) { applyBtn.hidden = !state || !state.planMode; applyBtn.disabled = n === 0; }
  if (clearBtn) { clearBtn.hidden = !state || !state.planMode; clearBtn.disabled = n === 0; }
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

  // V30 — outils d'arrêts : construire / démolir / passer en multimodal.
  if (state.stopToolMode) {
    handleStopToolTap(p);
    updateInstructions();
    refreshUI();
    return;
  }

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
      else if (!state.planMode && state.money < cost) log(`Construction impossible : il faut ${cost.toLocaleString("fr-FR")} €.`);
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
          // V28 — le nouveau segment qui croise une voirie existante se plie
          // en carrefour à 90° (sauf bâtiment occupé sur le pli), et un arrêt
          // de carrefour est posé au croisement. Avant rebuildNetwork : la
          // jonction fusionne alors dans l'arrêt (patron near() de network.js).
          developCityCarrefours(state.city, rng, { road }, function (a, b) {
            return traceBlockedBuildings(state, a, b).length > 0;
          }, log);
          if (state.planMode) {
            // V33 — en mode plan : le segment rejoint la file au lieu d'être payé
            // (pas de pile d'annulation voirie : la file pilote jusqu'à validation).
            state.planQueue.push({ kind: "road", roadId: road.id, cost });
            log(`Segment planifié (${cost.toLocaleString("fr-FR")} €) — à valider dans le plan.`);
          } else {
            state.money -= cost;
            pushRoadAction({ kind: "build", roadId: road.id, road, cost });
          }
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
      // Correction : les voiries libres (sans arrêts a/b) n'étaient jamais
      // détectées comme utilisées par une ligne ; on compare la longueur
      // d'itinéraire de chaque ligne avant/après reconstruction du réseau.
      const lengthsBefore = new Map(state.lines.map(function (line) {
        return [line.id, (line.route && line.route.totalLength) || 0];
      }));
      const refund = Math.round((nearestRoad.cost || 0) * 0.3);
      state.city.roads = state.city.roads.filter(function (road) { return road !== nearestRoad; });
      rebuildNetwork();
      pushRoadAction({ kind: "remove", road: nearestRoad, refund });
      state.money += refund;
      const rerouted = state.lines.filter(function (line) {
        return Math.abs(((line.route && line.route.totalLength) || 0) - (lengthsBefore.get(line.id) || 0)) > 0.01;
      });
      if (usedByLine) log("Attention : une ligne utilisait cette voirie, son itinéraire sera recalculé.");
      else if (rerouted.length) log("Attention : " + rerouted.length + (rerouted.length > 1 ? " lignes" : " ligne") + (rerouted.length > 1 ? " voient" : " voit") + " son itinéraire recalculé.");
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
    return '<option value="' + h(s.id) + '" title="' + h(s.description || "") + '">' + h(s.name) + " (" + h(s.difficulty) + ")</option>";
  }).join("");
}

function updateScenarioBanner() {
  const banner = document.getElementById("scenarioBanner");
  if (!banner || !state) return;
  const scenario = state.scenario;
  const objectives = scenario ? scenarioObjectives(scenario) : [];
  if (!scenario || !objectives.length) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  banner.className = "scenario-banner" + (scenario.status !== "active" ? " " + scenario.status : "");
  const progress = scenarioProgress(state, { net: networkFinancials(state).net }) || { overall: null, items: [] };
  const day = (state.elapsedDays || 0) + 1;
  const medalEmoji = scenario.medal && MEDAL_EMOJI[scenario.medal.id] ? MEDAL_EMOJI[scenario.medal.id] + " " : "";
  const statusText = scenario.status === "won"
    ? "✅ Réussi · " + medalEmoji + "jour " + day
    : scenario.status === "lost"
      ? "❌ Échoué"
      : "Jour " + day + (scenario.durationDays ? "/" + scenario.durationDays : "");
  const itemsHtml = (progress.items || []).map(function (it) {
    const mark = it.failed ? "❌" : it.done ? "✅" : it.type === "satisfactionMin" ? "🛡️" : "⏳";
    const pct = it.progress == null ? "" : " · " + Math.round(it.progress * 100) + " %";
    return '<div>' + mark + " " + h(it.label) + pct + "</div>";
  }).join("");
  // V34 — record enregistré une seule fois par fin de défi (le record vit
  // hors sauvegarde : clé localStorage dédiée, aucun impact migration).
  let recordHtml = "";
  if (scenario.status !== "active" && !scenario.recordSaved) {
    scenario.recordSaved = true;
    const records = recordScenarioResult(loadScenarioRecords(), scenario.id, {
      status: scenario.status,
      medal: scenario.medal ? scenario.medal.id : null,
      day: day
    });
    saveScenarioRecords(records);
    scenario.record = records[scenario.id] || null;
  }
  if (scenario.record && scenario.record.status === "won") {
    recordHtml = '<div>🏅 Record : ' + (MEDAL_EMOJI[scenario.record.medal] || "✅") + " jour " + scenario.record.day + "</div>";
  }
  banner.innerHTML = '<div><b>' + h(scenario.name) + '</b> (' + h(scenario.difficulty) + ') · ' + h(statusText) + '</div>' +
    itemsHtml +
    (progress.overall == null ? "" : '<div class="bar"><div style="width:' + Math.round(Math.max(0, Math.min(1, progress.overall)) * 100) + '%"></div></div>') +
    recordHtml;
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
  let carrefourReport = null;

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
    // Correction : une fois les fermetures pour travaux restaurees, les
    // itineraires doivent tenir compte des routes fermees des maintenant.
    refreshAllLineRoutes(nextState, function () {});
    nextRng = mulberry32(nextState.city.numericSeed ^ 0xA57E2);
    if (restoredPayload.rngState != null && nextRng.setState) {
      nextRng.setState(restoredPayload.rngState);
    }
  } else {
    const scenario = findScenario(scenarioId || "sandbox");
    const city = createCity(seed);
    // V28 — carrefours : les voiries générées qui se croisent loin de
    // l'angle droit sont pliées à 90°, et un arrêt est posé sur chaque
    // carrefour (avant createNetwork : la jonction fusionne dans l'arrêt).
    carrefourReport = developCityCarrefours(city, mulberry32(city.numericSeed ^ 0xCA2E), {}, null, () => {});
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
  // V33 — un boot repart toujours hors plan (une sauvegarde en cours de plan
  // est chargée vide : les travaux non validés n'ont jamais été payés).
  nextState.planMode = false;
  nextState.planQueue = [];
  nextState.planResumeAfter = false;
  nextState.logs = nextState.logs || [];

  state = nextState;
  rng = nextRng;

  // V29 — garde-fou dès le boot (ville neuve comme sauvegarde restaurée) :
  // le graphe reconstruit doit être sain, toute incohérence est journalisée.
