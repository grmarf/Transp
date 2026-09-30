import { STOP_RADIUS, vehiclePosition, satisfaction, lineHeadwayMinutes, networkFinancials, lineOccupancyRate, serviceLevel, networkOpportunities, intermodalStats } from "./engine.js";
import { vehicleMode } from "./vehicles.js";
import { eventSummary } from "./events.js";

// V11.0 — shared red/amber/green read on a 0-1 service level, used both on
// the map (stop ring) and in the sidebar (stop info, line rows).
function serviceLevelColor(level) {
  if (level >= 0.6) return "#4caf6a";
  if (level >= 0.3) return "#e0a83b";
  return "#e05a5a";
}
import { passengerStats, waitStats, PASSENGER_STATES } from "./passengers.js";

// V11.0 — last few days' net result, so the player can read a trend
// ("improving" / "declining") instead of only ever seeing the cumulative
// all-time total, which barely moves once a game has run for a while.
function renderCashFlowTrend(state) {
  const days = state.dailyStats || [];
  if (!days.length) return "";
  const recent = days.slice(-7);
  const bars = recent.map(d => {
    const color = d.net >= 0 ? "#4caf6a" : "#e05a5a";
    return `<span title="Jour ${d.day} : ${d.net >= 0 ? "+" : ""}${Math.round(d.net).toLocaleString("fr-FR")} €" style="display:inline-block;width:10px;height:${Math.min(24, 4 + Math.abs(d.net) / 20)}px;background:${color};margin-right:2px;vertical-align:bottom;"></span>`;
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
    items.push(`<div class="opportunity">📉 <strong style="color:${unprofitableLine.line.color}">${unprofitableLine.line.name}</strong> est déficitaire (${Math.round(unprofitableLine.net).toLocaleString("fr-FR")} € net) — envisagez de la revoir ou de la supprimer.</div>`);
  }
  if (saturatedLine) {
    items.push(`<div class="opportunity">🚦 <strong style="color:${saturatedLine.line.color}">${saturatedLine.line.name}</strong> est saturée (${Math.round(saturatedLine.occupancy * 100)}% d'occupation) — un véhicule supplémentaire aiderait.</div>`);
  }
  if (underservedStop) {
    items.push(`<div class="opportunity">📍 <strong>${underservedStop.stop.name}</strong> a une forte demande non couverte (niveau de service ${Math.round(underservedStop.level * 100)}%) — envisagez une nouvelle ligne ou une extension.</div>`);
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
      return `<div class="overview-row"><span>${s.name}</span><span>${s.population.toLocaleString("fr-FR")} hab.</span><span style="color:${serviceLevelColor(level)}">${Math.round(level * 100)}%</span></div>`;
    }).join("");
  return `<div class="overview-header"><span>Arrêt</span><span>Population</span><span>Service</span></div>${rows}`;
}

export function createRenderer(canvas, state) {
  const ctx = canvas.getContext("2d");

  function drawCity(heatmap = null) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#d5dadd";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#c0c7cb";
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 50) {
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 50) {
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke();
    }

    // V2.2: render the network graph rather than treating roads as decoration.
    for (const road of state.city.roads) {
      const a = state.city.stops.find(s => s.id === road.a);
      const b = state.city.stops.find(s => s.id === road.b);
      // V8.0: a road under works is dashed and amber, regardless of type.
      const edge = state.network.edges.find(e => (e.a === road.a && e.b === road.b) || (e.a === road.b && e.b === road.a));
      const closed = edge && state.network.closedEdgeIds?.has(edge.id);
      ctx.strokeStyle = closed ? "#e0a83b" : (road.type === "arterial" ? "#aab2b7" : "#b9c0c4");
      ctx.lineWidth = road.type === "arterial" ? 8 : 4;
      if (closed) ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      if (closed) ctx.setLineDash([]);
    }

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

    for (const line of state.lines) {
      const ids = line.route?.nodeIds || [];
      if (ids.length < 2) continue;
      ctx.strokeStyle = line.color; ctx.lineWidth = 5; ctx.lineJoin = "round";
      // V13.0: a metro line tunnels directly between stops rather than
      // following visible roads — dashing it signals "underground" even
      // where its straight path crosses open ground with no road beneath.
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

    if (state.pendingStops.length) {
      ctx.strokeStyle = "#333"; ctx.setLineDash([8,6]); ctx.lineWidth = 4;
      ctx.beginPath();
      state.pendingStops.forEach((id,i) => {
        const s = state.city.stops.find(x => x.id === id);
        if (i === 0) ctx.moveTo(s.x,s.y); else ctx.lineTo(s.x,s.y);
      });
      ctx.stroke(); ctx.setLineDash([]);
    }

    for (const v of state.vehicles) {
      const p = vehiclePosition(state, v);
      if (!p) continue;
      const line = state.lines.find(l => l.id === v.lineId);
      const broken = v.brokenTicksLeft > 0;
      ctx.fillStyle = broken ? "#6b6f73" : line.color; ctx.fillRect(p.x-7,p.y-7,14,14);
      // V3.0: congested vehicles (slowed by traffic sharing their segment) get a red outline.
      // V8.0: a broken-down vehicle gets a distinct amber outline instead.
      ctx.strokeStyle = broken ? "#e0a83b" : (v.congestion ?? 1) < 0.85 ? "#e03b3b" : "#fff";
      ctx.lineWidth = 2; ctx.strokeRect(p.x-7,p.y-7,14,14);
    }

    for (const s of state.city.stops) {
      const selected = state.selectedStop === s.id;
      const pending = state.pendingStops.includes(s.id);
      const served = state.lines.some(l => l.stopIds.includes(s.id));
      ctx.beginPath(); ctx.arc(s.x,s.y,pending ? 15 : selected ? 13 : STOP_RADIUS,0,Math.PI*2);
      ctx.fillStyle = pending ? "#ffe082" : selected ? "#fff" : "#26333d"; ctx.fill();
      // V11.0: a served stop's ring reads its current service level at a
      // glance (red = weak, amber = ok, green = well served) instead of a
      // flat white outline for every stop regardless of how well it runs.
      ctx.strokeStyle = served ? serviceLevelColor(serviceLevel(state, s)) : "#fff";
      ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#172027"; ctx.font = "12px system-ui"; ctx.textAlign = "center";
      ctx.fillText(s.name,s.x,s.y-17);
      const waiting = Object.values(s.waitingByDestination || {}).reduce((a,v) => a + v, 0);
      if (waiting > 1) {
        ctx.fillStyle = "#a33"; ctx.font = "10px system-ui";
        ctx.fillText(Math.floor(waiting),s.x+17,s.y+4);
      }
    }
  }

  function render(options = {}) {
    drawCity(options.heatmap || null);
    const served = state.city.stops.filter(s => state.lines.some(l => l.stopIds.includes(s.id))).length;
    document.getElementById("money").textContent = Math.round(state.money).toLocaleString("fr-FR") + " €";
    document.getElementById("passengers").textContent = state.transported.toLocaleString("fr-FR");
    document.getElementById("satisfaction").textContent = Math.round(satisfaction(state)) + "%";
    document.getElementById("clock").textContent = formatTime(state.time);
    document.getElementById("cityName").textContent = state.city.name;
    document.getElementById("seedValue").textContent = state.city.seed;

    const pStats = passengerStats(state);
    // V3.0: real wait-time metric (waitStats) replaces the legacy, never-decremented
    // origin.waitingByDestination sum for the "Attente" indicator.
    const wStats = waitStats(state);
    // V4.0: cumulative revenue/expenses/net across all lines.
    const fin = networkFinancials(state);
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
        <div class="stat"><small>Abandons</small><strong>${wStats.abandonedCount}</strong></div>
        <div class="stat"><small>Service demande</small><strong>${state.totalDemand > 0 ? Math.round((state.totalArrived / state.totalDemand) * 100) : 0}%</strong></div>
        <div class="stat"><small>Demande générée</small><strong>${Math.round(state.totalGenerated).toLocaleString("fr-FR")}</strong></div>
        <div class="stat"><small>Recettes cumulées</small><strong>${Math.round(fin.income).toLocaleString("fr-FR")} €</strong></div>
        <div class="stat"><small>Dépenses cumulées</small><strong>${Math.round(fin.expenses).toLocaleString("fr-FR")} €</strong></div>
        <div class="stat"><small>Bilan net</small><strong style="color:${fin.net >= 0 ? "#4caf6a" : "#e05a5a"}">${fin.net >= 0 ? "+" : ""}${Math.round(fin.net).toLocaleString("fr-FR")} €</strong></div>
      </div>
      ${renderCashFlowTrend(state)}`;

    const linesEl = document.getElementById("lines");
    linesEl.innerHTML = state.lines.length ? state.lines.map(l => {
      const headway = lineHeadwayMinutes(state, l);
      const net = (l.income || 0) - (l.expenses || 0);
      // V11.0: occupancy tells you whether a line needs another vehicle
      // (near-full) or is oversized for its demand (mostly empty) — a
      // signal "X passagers transportés" never gave on its own.
      const occupancy = lineOccupancyRate(state, l);
      const occColor = occupancy == null ? "#999" : occupancy >= 0.85 ? "#e0a83b" : occupancy <= 0.2 ? "#999" : "#4caf6a";
      const lastVehicleId = l.vehicles[l.vehicles.length - 1];
      return `
      <div class="line-row">
        <div class="line-head"><strong style="color:${l.color}">${l.name}</strong><span class="pill">${l.riders} passagers</span></div>
        <div>${l.stopIds.map(id => state.city.stops.find(s=>s.id===id).name).join(" → ")}</div>
        <div class="muted">${l.vehicles.length} véhicule${l.vehicles.length > 1 ? "s" : ""}${headway ? ` · ~${Math.round(headway)} min d'intervalle` : ""}${occupancy != null ? ` · <span style="color:${occColor}">${Math.round(occupancy * 100)}% occupation</span>` : ""}</div>
        <div class="muted">+${Math.round(l.income).toLocaleString("fr-FR")} € recettes · -${Math.round(l.expenses || 0).toLocaleString("fr-FR")} € dépenses · <span style="color:${net >= 0 ? "#4caf6a" : "#e05a5a"}">${net >= 0 ? "+" : ""}${Math.round(net).toLocaleString("fr-FR")} € net</span></div>
        <div class="muted">Mode : ${vehicleMode(l.mode).name}</div>
        <div class="line-actions">
          <button type="button" class="small" data-buy-vehicle="${l.id}">+ véhicule (${vehicleMode(l.mode).purchaseCost.toLocaleString("fr-FR")} €)</button>
          <button type="button" class="small" data-extend-line="${l.id}">↔ Étendre la ligne</button>
          ${l.vehicles.length > 1 ? `<button type="button" class="small" data-sell-vehicle="${l.id}" data-vehicle-id="${lastVehicleId}">- véhicule (+${Math.round(vehicleMode(l.mode).purchaseCost * 0.5).toLocaleString("fr-FR")} €)</button>` : ""}
          <button type="button" class="small danger" data-delete-line="${l.id}">✕ Supprimer la ligne</button>
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
        .map(([id,n]) => ({ stop: state.city.stops.find(x=>x.id===id), n }))
        .filter(x => x.stop && x.n >= 0.5)
        .sort((a,b) => b.n-a.n)
        .slice(0,5);
      // V3.0: real agents actually waiting/transferring at this stop right now.
      // `od` below is the pending sub-1 demand pool per destination (how close
      // each OD pair is to spawning its next passenger), not a headcount.
      const waitingHere = state.passengers.filter(p =>
        p.currentStopId === s.id &&
        (p.state === PASSENGER_STATES.WAITING || p.state === PASSENGER_STATES.TRANSFERRING)
      ).length;
      // V11.0: same service-level reading that drives urban growth (growth.js
      // serviceLevel), surfaced here so the player can see *why* a stop is
      // growing fast or stagnating, instead of it only acting invisibly.
      const level = serviceLevel(state, s);
      stopEl.innerHTML = `<b>${s.name}</b><br>Population : ${s.population.toLocaleString("fr-FR")} · Emplois : ${s.jobs.toLocaleString("fr-FR")} · Commerces : ${s.commerce.toLocaleString("fr-FR")}<br>Densité : ${s.density.toLocaleString("fr-FR")} hab/km²<br>Niveau de service : <b style="color:${serviceLevelColor(level)}">${Math.round(level * 100)}%</b> (moteur de la croissance)<br>Passagers en attente ici : <b>${waitingHere}</b><br>Pression de demande (avant prochain passager) : ${od.length ? od.map(x=>`${x.stop.name} (${Math.round(x.n*100)}%)`).join(", ") : "aucune"}<br>Lignes : ${lines.length ? lines.map(l=>l.name).join(", ") : "aucune"}`;
    }

    document.getElementById("log").innerHTML = state.logs.map(x => `<div class="log-entry">${x}</div>`).join("");
    document.getElementById("opportunities").innerHTML = renderOpportunities(state);
    document.getElementById("cityOverview").innerHTML = renderCityOverview(state);

    const journalEl = document.getElementById("journal");
    if (journalEl) {
      const entries = state.journal || [];
      journalEl.innerHTML = entries.map(e => `<div class="journal-entry journal-${e.type}">${e.text}</div>`).join("");
    }
    const eventsEl = document.getElementById("eventPanel");
    if (eventsEl) {
      const events = eventSummary(state);
      eventsEl.innerHTML = events.length
        ? events.map(event => `<div class="event-row"><b>${event.icon} ${event.label}</b><span>${event.remainingDays} j · demande ×${event.demandMultiplier.toFixed(2)} · satisfaction ${event.satisfactionDelta >= 0 ? "+" : ""}${event.satisfactionDelta}</span></div>`).join("")
        : '<div class="muted">Aucun événement en cours.</div>';
    }

    const intermodalEl = document.getElementById("intermodalStats");
    if (intermodalEl) {
      const stats = intermodalStats(state);
      intermodalEl.innerHTML = `<div>Correspondances moyennes : ${stats.avgTransfersPerTrip.toFixed(2)}</div><div>Voyages avec correspondance : ${(stats.shareWithTransfer * 100).toFixed(1)}%</div><div>Temps de trajet moyen : ${stats.avgTravelMinutes.toFixed(0)} min</div>`;
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
      days.forEach((d, i) => { const x = (i + 0.5) * chart.width / Math.max(1, days.length); const h = Math.min(mid - 4, Math.abs(d.net) / max * (mid - 8)); c.fillStyle = d.net >= 0 ? "#4caf6a" : "#e05a5a"; c.fillRect(x - 5, d.net >= 0 ? mid - h : mid, 10, h); });
    }
  }

  function formatTime(minutes) {
    const h = Math.floor(minutes/60)%24, m = Math.floor(minutes%60);
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  }

  return { render };
}
