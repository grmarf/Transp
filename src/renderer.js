import { STOP_RADIUS, vehiclePosition, satisfaction, lineHeadwayMinutes, networkFinancials, lineOccupancyRate, serviceLevel, networkOpportunities, intermodalStats } from "./engine.js";
import { vehicleMode } from "./vehicles.js";
import { eventSummary } from "./events.js";
import { progressionSummary } from "./progression.js";
import { contractSummary } from "./contracts.js";
import { latestReport } from "./reports.js";
import { seasonSummary } from "./seasons.js";

// V11.0 — shared red/amber/green read on a 0-1 service level, used both on
// the map (stop ring) and in the sidebar (stop info, line rows).
function serviceLevelColor(level) {
  if (level >= 0.6) return "#4caf6a";
  if (level >= 0.3) return "#e0a83b";
  return "#e05a5a";
}
import { passengerStats, waitStats, PASSENGER_STATES } from "./passengers.js";
import { escapeHtml as h } from "./html.js";

// V11.0 — last few days' net result, so the player can read a trend
// ("improving" / "declining") instead of only ever seeing the cumulative
// all-time total, which barely moves once a game has run for a while.
function renderCashFlowTrend(state) {
  const days = state.dailyStats || [];
  if (!days.length) return "";
  const recent = days.slice(-7);
  const bars = recent.map(d => {
    const color = d.net >= 0 ? "#4caf6a" : "#e05a5a";
    return `<span title="${h(`Jour ${d.day} : ${d.net >= 0 ? "+" : ""}${Math.round(d.net).toLocaleString("fr-FR")} €`)}" style="display:inline-block;width:10px;height:${Math.min(24, 4 + Math.abs(d.net) / 100)};background:${color};margin:0 1px" aria-hidden="true"></span>`;
  }).join("");
  const last = days[days.length - 1];
  return `<div class="stat" style="margin-top:8px;"><small>Tendance (7 derniers jours)</small><br>${bars}<br><small>Dernier jour : <span style="color:${last.net >= 0 ? "#4caf6a" : "#e05a5a"}">${last.net >= 0 ? "+" : ""}${Math.round(last.net).toLocaleString("fr-FR")} €</span></small></div>`;
}

// V12.0 — decision-support panel: turns networkOpportunities' raw findings
// into short, actionable lines instead of making the player notice a
// problem by scanning every line/stop themselves.
function renderOpportunities(state) {
  const { unprofitableLine, saturatedLine, underservedStop } = networkOpportunities(state);
  if (!unprofitableLine && !saturatedLine && !underservedStop) {
    return '<div class="muted">Rien à signaler pour l\'instant.</div>';
  }
  const items = [];
  if (unprofitableLine) {
    items.push(`<div class="opportunity">📉 <strong style="color:${h(unprofitableLine.line.color)}">${h(unprofitableLine.line.name)}</strong> est déficitaire (${Math.round(unprofitableLine.net).toLocaleString("fr-FR")} €)</div>`);
  }
  if (saturatedLine) {
    items.push(`<div class="opportunity">🚦 <strong style="color:${h(saturatedLine.line.color)}">${h(saturatedLine.line.name)}</strong> est saturée (${Math.round(saturatedLine.occupancy * 100)}%)</div>`);
  }
  if (underservedStop) {
    items.push(`<div class="opportunity">📍 <strong>${h(underservedStop.stop.name)}</strong> a une forte demande non couverte (niveau de service ${Math.round(underservedStop.level * 100)}%) — proposer des lignes</div>`);
  }
  return items.join("");
}

// V12.0 — city-wide table (population, growth engine's service level) so
// the player can read the whole network's health at a glance instead of
// only ever seeing one stop's detail at a time.
function renderCityOverview(state) {
  const rows = [...state.city.stops]
    .sort((a, b) => b.population - a.population)
    .map(s => {
      const level = serviceLevel(state, s);
      return `<div class="overview-row"><span>${h(s.name)}</span><span>${s.population.toLocaleString("fr-FR")} hab.</span><span style="color:${h(serviceLevelColor(level))}">${Math.round(level * 100)}%</span></div>`;
    }).join("");
  return `<div class="overview-header"><span>Arrêt</span><span>Population</span><span>Service</span></div>${rows}`;
}

// V20.3 — procedural city rendering with building textures and zoom support
export function createRenderer(canvas, state) {
  const ctx = canvas.getContext("2d");
  
  // Camera state for zoom/pan
  const camera = {
    x: 0,
    y: 0,
    zoom: 1,
    minZoom: 0.5,
    maxZoom: 3
  };

  // Generate deterministic building texture for a stop based on population
  function generateBuildingTexture(stop, size = 8) {
    const offscreenCanvas = new OffscreenCanvas(size, size);
    const offCtx = offscreenCanvas.getContext("2d");
    
    // Seed pseudo-random from stop ID for determinism
    const seed = stop.id * 73856093;
    function seededRandom() {
      const x = Math.sin(seed * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    }
    
    // Background: density-based color
    const density = Math.min(stop.population / 5000, 1);
    const baseColor = Math.round(200 - density * 80);
    offCtx.fillStyle = `rgb(${baseColor}, ${baseColor + 20}, ${baseColor - 20})`;
    offCtx.fillRect(0, 0, size, size);
    
    // Windows/building detail
    offCtx.fillStyle = `rgba(255, 250, 200, ${0.3 + density * 0.4})`;
    for (let i = 0; i < size * density * 1.5; i++) {
      const px = Math.floor(seededRandom() * size);
      const py = Math.floor(seededRandom() * size);
      const w = Math.max(1, Math.floor(seededRandom() * 2));
      const h = Math.max(1, Math.floor(seededRandom() * 2));
      offCtx.fillRect(px, py, w, h);
    }
    
    return offscreenCanvas;
  }

  function drawCity(heatmap = null) {
    ctx.save();
    
    // Apply camera transform
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-canvas.width / (2 * camera.zoom) + camera.x, -canvas.height / (2 * camera.zoom) + camera.y);
    
    // Background
    ctx.fillStyle = "#e8ecf0";
    ctx.fillRect(0, 0, canvas.width / camera.zoom, canvas.height / camera.zoom);

    // Subtle grid at zoom > 1
    if (camera.zoom > 1.2) {
      ctx.strokeStyle = "rgba(192, 199, 203, 0.3)";
      ctx.lineWidth = 0.5 / camera.zoom;
      const step = 50;
      for (let x = 0; x < canvas.width / camera.zoom; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height / camera.zoom); ctx.stroke();
      }
      for (let y = 0; y < canvas.height / camera.zoom; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width / camera.zoom, y); ctx.stroke();
      }
    }

    // V20.3: Draw buildings/city blocks based on population density
    for (const stop of state.city.stops) {
      const radius = Math.max(3, Math.sqrt(stop.population / 100));
      ctx.fillStyle = `rgba(200, 210, 220, ${Math.min(0.8, stop.population / 3000)})`;
      ctx.beginPath();
      ctx.arc(stop.x, stop.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Roads
    for (const road of state.city.roads) {
      const a = state.city.stops.find(s => s.id === road.a);
      const b = state.city.stops.find(s => s.id === road.b);
      const edge = state.network.edges.find(e => (e.a === road.a && e.b === road.b) || (e.a === road.b && e.b === road.a));
      const closed = edge && state.network.closedEdgeIds?.has(edge.id);
      ctx.strokeStyle = closed ? "#f5b041" : (road.type === "arterial" ? "#9db3bd" : "#b8c5ce");
      ctx.lineWidth = road.type === "arterial" ? 8 : 4;
      if (closed) ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (closed) ctx.setLineDash([]);
    }

    // Heatmap (congestion overlay)
    if (heatmap?.length) {
      for (const segment of heatmap) {
        ctx.save();
        ctx.strokeStyle = `rgba(255, 40, 0, ${Math.min(0.8, 0.2 + segment.congestion * 0.6)})`;
        ctx.lineWidth = 10 + Math.min(10, segment.load * 2);
        ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(segment.a.x, segment.a.y); ctx.lineTo(segment.b.x, segment.b.y); ctx.stroke();
        ctx.restore();
      }
    }

    // Transit lines
    for (const line of state.lines) {
      const ids = line.route?.nodeIds || [];
      if (ids.length < 2) continue;
      ctx.strokeStyle = line.color; ctx.lineWidth = 5; ctx.lineJoin = "round";
      if (line.mode === "metro") ctx.setLineDash([2, 6]); else ctx.setLineDash([]);
      ctx.beginPath();
      ids.forEach((id, i) => {
        const node = state.network.nodes.get(id);
        if (!node) return;
        if (i === 0) ctx.moveTo(node.x, node.y); else ctx.lineTo(node.x, node.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Pending stops
    if (state.pendingStops.length) {
      ctx.strokeStyle = "#333"; ctx.setLineDash([8, 6]); ctx.lineWidth = 4;
      ctx.beginPath();
      state.pendingStops.forEach((id, i) => {
        const s = state.city.stops.find(x => x.id === id);
        if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke(); ctx.setLineDash([]);
    }

    // Vehicles
    for (const v of state.vehicles) {
      const p = vehiclePosition(state, v);
      if (!p) continue;
      const line = state.lines.find(l => l.id === v.lineId);
      const broken = v.brokenTicksLeft > 0;
      ctx.fillStyle = broken ? "#6b6f73" : line.color; 
      ctx.fillRect(p.x - 7, p.y - 7, 14, 14);
      ctx.strokeStyle = broken ? "#f5b041" : (v.congestion ?? 1) < 0.85 ? "#e03b3b" : "#fff";
      ctx.lineWidth = 2; ctx.strokeRect(p.x - 7, p.y - 7, 14, 14);
    }

    // Stops
    for (const s of state.city.stops) {
      const selected = state.selectedStop === s.id;
      const pending = state.pendingStops.includes(s.id);
      const served = state.lines.some(l => l.stopIds.includes(s.id));
      
      ctx.beginPath(); 
      ctx.arc(s.x, s.y, pending ? 15 : selected ? 13 : STOP_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = pending ? "#ffe082" : selected ? "#fff" : "#26333d"; 
      ctx.fill();
      ctx.strokeStyle = served ? serviceLevelColor(serviceLevel(state, s)) : "#fff";
      ctx.lineWidth = 2; 
      ctx.stroke();
      
      ctx.fillStyle = "#172027"; 
      ctx.font = `${Math.max(8, 12 / camera.zoom)}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText(s.name, s.x, s.y - 17);
      
      const waiting = Object.values(s.waitingByDestination || {}).reduce((a, v) => a + v, 0);
      if (waiting > 1) {
        ctx.fillStyle = "#a33"; 
        ctx.font = `${Math.max(7, 10 / camera.zoom)}px system-ui`;
        ctx.fillText(Math.floor(waiting), s.x + 17, s.y + 4);
      }
    }
    
    ctx.restore();
  }

  function render(options = {}) {
    drawCity(options.heatmap || null);
    const served = state.city.stops.filter(s => state.lines.some(l => l.stopIds.includes(s.id))).length;
    const moneyEl = document.getElementById("money");
    moneyEl.textContent = Math.round(state.money).toLocaleString("fr-FR") + " €";
    moneyEl.parentElement?.classList.toggle("is-critical", state.money <= 0);
    document.getElementById("passengers").textContent = state.transported.toLocaleString("fr-FR");
    const satisfactionValue = satisfaction(state);
    const satisfactionEl = document.getElementById("satisfaction");
    satisfactionEl.textContent = Math.round(satisfactionValue) + "%";
    satisfactionEl.parentElement?.classList.toggle("is-critical", satisfactionValue < 40);
    document.getElementById("clock").textContent = formatTime(state.time);
    document.getElementById("cityName").textContent = state.city.name;
    const seedEl = document.getElementById("seedInput");
    if (seedEl) seedEl.value = state.city.seed;

    const pStats = passengerStats(state);
    const wStats = waitStats(state);
    const fin = networkFinancials(state);
    const dayIncome = fin.income - (state.dailyBaseline?.income || 0);
    const dayExpenses = fin.expenses - (state.dailyBaseline?.expenses || 0);
    const dayNet = dayIncome - dayExpenses;
    document.getElementById("networkStats").innerHTML = `
      <div class="stat-grid">
        <div class="stat"><small>Lignes</small><strong>${state.lines.length}</strong></div>
        <div class="stat"><small>Véhicules</small><strong>${state.vehicles.length}</strong></div>
        <div class="stat"><small>Arrêts</small><strong>${served}/${state.city.stops.length}</strong></div>
        <div class="stat"><small>Attente moyenne</small><strong>${Math.round(wStats.avgWaitMinutes)} min</strong></div>
        <div class="stat"><small>Transportés</small><strong>${state.totalArrived}</strong></div>
        <div class="stat"><small>Passagers actifs</small><strong>${pStats.WAITING + pStats.BOARDING + pStats.ON_VEHICLE + pStats.TRANSFERRING}</strong></div>
        <div class="stat"><small>Réseau</small><strong>${state.network.edges.length} routes</strong></div>
        <div class="stat"><small>Jour</small><strong>${(state.elapsedDays || 0) + 1}</strong></div>
        <div class="stat"><small>Abandons</small><strong>${state.totalAbandoned || 0}</strong></div>
        <div class="stat"><small>Service demande</small><strong>${state.totalDemand > 0 ? Math.round((state.totalArrived / state.totalDemand) * 100) : 0}%</strong></div>
        <div class="stat"><small>Demande générée</small><strong>${Math.round(state.totalGenerated).toLocaleString("fr-FR")}</strong></div>
        <div class="stat"><small>Recettes cumulées</small><strong>${Math.round(fin.income).toLocaleString("fr-FR")} €</strong></div>
        <div class="stat"><small>Dépenses cumulées</small><strong>${Math.round(fin.expenses).toLocaleString("fr-FR")} €</strong></div>
        <div class="stat"><small>Bilan net</small><strong style="color:${h(fin.net >= 0 ? "#4caf6a" : "#e05a5a")}">${fin.net >= 0 ? "+" : ""}${Math.round(fin.net).toLocaleString("fr-FR")} €</strong></div>
        <div class="stat financial-highlight ${dayNet >= 0 ? "positive" : "negative"}"><small>Aujourd'hui · revenus / coûts / marge</small><strong>${dayIncome >= 0 ? "+" : ""}${Math.round(dayIncome).toLocaleString("fr-FR")} / -${Math.round(dayExpenses).toLocaleString("fr-FR")} / ${dayNet >= 0 ? "+" : ""}${Math.round(dayNet).toLocaleString("fr-FR")} €</strong></div>
      </div>
      ${renderCashFlowTrend(state)}`;

    const linesEl = document.getElementById("lines");
    linesEl.innerHTML = state.lines.length ? state.lines.map(l => {
      const headway = lineHeadwayMinutes(state, l);
      const net = (l.income || 0) - (l.expenses || 0);
      const occupancy = lineOccupancyRate(state, l);
      const occColor = occupancy == null ? "#999" : occupancy >= 0.85 ? "#e0a83b" : occupancy <= 0.2 ? "#999" : "#4caf6a";
      const lastVehicleId = l.vehicles[l.vehicles.length - 1];
      return `
      <div class="line-row">
        <div class="line-head"><strong style="color:${h(l.color)}">${h(l.name)}</strong><span class="pill">${l.riders} passagers</span></div>
        <div>${l.stopIds.map(id => h(state.city.stops.find(s=>s.id===id).name)).join(" → ")}</div>
        <div class="muted">${l.vehicles.length} véhicule${l.vehicles.length > 1 ? "s" : ""}${headway ? ` · ~${Math.round(headway)} min d'intervalle` : ""}${occupancy != null ? ` · <span style="color:${h(occColor)}">${Math.round(occupancy * 100)}%</span>` : ""}</div>
        <div class="muted">+${Math.round(l.income).toLocaleString("fr-FR")} € recettes · -${Math.round(l.expenses || 0).toLocaleString("fr-FR")} € dépenses · <span style="color:${h(net >= 0 ? "#4caf6a" : "#e05a5a")}">${net >= 0 ? "+" : ""}${Math.round(net).toLocaleString("fr-FR")} €</span></div>
        <div class="muted">Mode : ${h(vehicleMode(l.mode).name)}</div>
        <div class="line-actions">
          <button type="button" class="small" data-buy-vehicle="${h(l.id)}">+ véhicule (${vehicleMode(l.mode).purchaseCost.toLocaleString("fr-FR")} €)</button>
          <button type="button" class="small" data-extend-line="${h(l.id)}">↔ Étendre la ligne</button>
          ${l.vehicles.length > 1 ? `<button type="button" class="small" data-sell-vehicle="${h(l.id)}" data-vehicle-id="${h(lastVehicleId)}">- véhicule (+${Math.round(vehicleMode(l.mode).purchaseCost / 2).toLocaleString("fr-FR")} €)</button>` : ""}
          <button type="button" class="small danger" data-delete-line="${h(l.id)}">✕ Supprimer la ligne</button>
        </div>
      </div>`;
    }).join("") :
      '<div class="muted">Aucune ligne. Créez votre première ligne.</div>';

    const stopEl = document.getElementById("stopInfo");
    if (!state.selectedStop) stopEl.textContent = "Aucun arrêt sélectionné.";
    else {
      const s = state.city.stops.find(x => x.id === state.selectedStop);
      const lines = state.lines.filter(l => l.stopIds.includes(s.id));
      const od = Object.entries(s.waitingByDestination || {})
        .map(([id, n]) => ({ stop: state.city.stops.find(x => x.id === id), n }))
        .filter(x => x.stop && x.n >= 0.5)
        .sort((a, b) => b.n - a.n)
        .slice(0, 5);
      const waitingHere = state.passengers.filter(p =>
        p.currentStopId === s.id &&
        (p.state === PASSENGER_STATES.WAITING || p.state === PASSENGER_STATES.TRANSFERRING)
      ).length;
      const level = serviceLevel(state, s);
      stopEl.innerHTML = `<b>${h(s.name)}</b><br>Population : ${s.population.toLocaleString("fr-FR")} · Emplois : ${s.jobs.toLocaleString("fr-FR")} · Commerces : ${s.commerce.toLocaleString("fr-FR")}<br>Service : ${Math.round(level * 100)}% · Attente réelle : ${waitingHere} passagers${lines.length ? `<br>Lignes : ${lines.map(l => h(l.name)).join(", ")}` : ""}<br>${od.length ? `Top destinations : ${od.map(o => `${h(o.stop.name)} (${Math.round(o.n)})`).join(", ")}` : ""}`;
    }

    document.getElementById("log").innerHTML = state.logs.map(x => `<div class="log-entry">${h(x)}</div>`).join("");
    document.getElementById("opportunities").innerHTML = renderOpportunities(state);
    document.getElementById("cityOverview").innerHTML = renderCityOverview(state);

    const journalEl = document.getElementById("journal");
    if (journalEl) {
      const entries = state.journal || [];
      journalEl.innerHTML = entries.map(e => `<div class="journal-entry journal-${h(e.type)}">${h(e.text)}</div>`).join("");
    }
    const seasonEl = document.getElementById("seasonPanel");
    if (seasonEl) {
      const season = seasonSummary(state);
      seasonEl.innerHTML = `<div class="season-header"><b>${h(season.icon)} ${h(season.label)}</b><span>Jour ${season.dayInSeason}/7</span></div><div class="season-effects">Demande ×${season.demandMultiplier.toFixed(2)} · Tarif ×${season.fareMultiplier.toFixed(2)} · Croissance ×${season.growthMultiplier.toFixed(2)}</div>`;
    }

    const reportEl = document.getElementById("reportPanel");
    if (reportEl) {
      const report = latestReport(state);
      reportEl.innerHTML = report ? `<div class="report-header"><b>Jour ${report.day}</b><span class="${h(report.net >= 0 ? "positive" : "negative")}">${report.net >= 0 ? "+" : ""}${Math.round(report.net).toLocaleString("fr-FR")} €</span></div><div class="report-metrics"><div>Revenus : ${Math.round(report.income).toLocaleString("fr-FR")} €</div><div>Dépenses : ${Math.round(report.expenses).toLocaleString("fr-FR")} €</div><div>Satisfaction : ${Math.round(report.satisfaction)}%</div><div>Attente moyenne : ${Math.round(report.avgWait)} min</div><div>Abandons : ${report.abandoned}</div></div>` : '<div class="muted">Le premier rapport sera disponible à la fin du jour 1.</div>';
    }

    const contractsEl = document.getElementById("contractsPanel");
    if (contractsEl) {
      const coverage = state.city.stops.length ? state.lines.reduce((sum, line) => sum + new Set(line.stopIds || []).size, 0) / state.city.stops.length : 0;
      const contracts = contractSummary(state, { satisfaction: satisfaction(state), transferShare: intermodalStats(state).shareWithTransfer, coverage });
      contractsEl.innerHTML = contracts.length ? `<div class="muted">Renouvellement dans ${contracts[0].remainingDays} jour(s)</div>` + contracts.map(contract => `<div class="contract-row ${contract.status}"><b>${h(contract.label)}</b><span>${contract.progress}%</span></div>`).join("") : '<div class="muted">Les contrats seront proposés au prochain jour.</div>';
    }

    const progressionEl = document.getElementById("progressionPanel");
    if (progressionEl) {
      const transferShare = intermodalStats(state).shareWithTransfer;
      const progression = progressionSummary(state, { satisfaction: satisfaction(state), transferShare });
      progressionEl.innerHTML = `<div class="progression-header"><b>${h(progression.rank)}</b><span>${progression.reputation} réputation · ${progression.completed}/${progression.total} objectifs</span></div>`;
    }

    const eventsEl = document.getElementById("eventPanel");
    if (eventsEl) {
      const events = eventSummary(state);
      eventsEl.innerHTML = events.length
        ? events.map(event => `<div class="event-row"><b>${h(event.icon)} ${h(event.label)}</b><span>${event.remainingDays} j · demande ×${event.demandMultiplier.toFixed(2)}</span></div>`).join("")
        : '<div class="muted">Aucun événement en cours.</div>';
    }

    const intermodalEl = document.getElementById("intermodalStats");
    if (intermodalEl) {
      const stats = intermodalStats(state);
      intermodalEl.innerHTML = `<div>Correspondances moyennes : ${stats.avgTransfersPerTrip.toFixed(2)}</div><div>Voyages avec correspondance : ${(stats.shareWithTransfer * 100).toFixed(1)}%</div>`;
    }
    const heatmapLegend = document.getElementById("heatmapLegend");
    if (heatmapLegend) {
      const active = Array.isArray(options.heatmap) && options.heatmap.length > 0;
      heatmapLegend.hidden = !active;
      heatmapLegend.setAttribute("aria-hidden", String(!active));
      if (active) heatmapLegend.querySelector(".heatmap-count")?.replaceChildren(document.createTextNode(`${options.heatmap.length} segment${options.heatmap.length > 1 ? "s" : ""}`));
    }

    const chart = document.getElementById("financialChart");
    if (chart?.getContext) {
      const c = chart.getContext("2d"); c.clearRect(0, 0, chart.width, chart.height);
      const days = (state.dailyStats || []).slice(-14);
      const max = Math.max(1, ...days.map(d => Math.abs(d.net)));
      const mid = chart.height / 2;
      c.strokeStyle = "#68727a"; c.beginPath(); c.moveTo(0, mid); c.lineTo(chart.width, mid); c.stroke();
      days.forEach((d, i) => { const x = (i + 0.5) * chart.width / Math.max(1, days.length); const h = Math.min(mid - 4, Math.abs(d.net) / max * (mid - 8)); c.fillStyle = d.net >= 0 ? "#4caf6a" : "#e05a5a"; c.fillRect(x - chart.width / (2 * Math.max(1, days.length)), mid - (d.net >= 0 ? h : -h), chart.width / Math.max(1, days.length), h); });
    }
  }

  function formatTime(minutes) {
    const h = Math.floor(minutes / 60) % 24, m = Math.floor(minutes % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  return { render, camera };
}
