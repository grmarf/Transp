import {
  STOP_RADIUS,
  vehiclePosition,
  satisfaction,
  lineHeadwayMinutes,
  networkFinancials,
  lineOccupancyRate,
  serviceLevel,
  networkOpportunities,
  intermodalStats,
} from "./engine.js";
import { vehicleMode } from "./vehicles.js";
import { eventSummary } from "./events.js";
import { progressionSummary } from "./progression.js";
import { contractSummary } from "./contracts.js";
import { latestReport } from "./reports.js";
import { seasonSummary } from "./seasons.js";
import { passengerStats, waitStats, PASSENGER_STATES } from "./passengers.js";
import { escapeHtml as h } from "./html.js";

// Palette cartoon alignée avec le CSS
const INK = "#1f2340";
const CREAM = "#fdf6e3";
const PAPER = "#fff8ec";
const SUN = "#ffd23f";
const ORANGE = "#ff8c42";
const CORAL = "#ef476f";
const SKY = "#4cc9f0";
const GRASS = "#7ac74f";
const PLUM = "#9b5de5";
const ROAD_LIGHT = "#f0e7cd";
const ROAD_DARK = "#d9cfb0";
const ROAD_CLOSED = "#ffb347";

// V11.0 — feu tricolore façon jeu : vert / jaune / rouge saturés
function serviceLevelColor(level) {
  if (level >= 0.6) return GRASS;
  if (level >= 0.3) return SUN;
  return CORAL;
}

// V11.0 — tendance financière façon petites barres arc-en-ciel
function renderCashFlowTrend(state) {
  const days = state.dailyStats || [];
  if (!days.length) return "";
  const recent = days.slice(-7);
  const bars = recent.map(d => {
    const color = d.net >= 0 ? GRASS : CORAL;
    const hh = Math.min(28, 6 + Math.abs(d.net) / 100);
    return `<span title="${h(`Jour ${d.day} : ${d.net >= 0 ? "+" : ""}${Math.round(d.net).toLocaleString("fr-FR")} €`)}" style="display:inline-block;width:12px;height:${hh}px;background:${color};border:2px solid ${INK};border-radius:3px;margin:0 2px;vertical-align:bottom" aria-hidden="true"></span>`;
  }).join("");
  const last = days[days.length - 1];
  return `<div class="stat" style="margin-top:10px;"><small>Tendance 7 jours</small><br>${bars}<br><small>Dernier : <span style="color:${last.net >= 0 ? GRASS : CORAL};font-weight:900">${last.net >= 0 ? "+" : ""}${Math.round(last.net).toLocaleString("fr-FR")} €</span></small></div>`;
}

// V12.0 — panneau d'idées avec emojis forts
function renderOpportunities(state) {
  const { unprofitableLine, saturatedLine, underservedStop } = networkOpportunities(state);
  if (!unprofitableLine && !saturatedLine && !underservedStop) {
    return '<div class="muted">Tout roule ! 🎉</div>';
  }
  const items = [];
  if (unprofitableLine) {
    items.push(`<div class="opportunity">💸 <strong style="color:${h(unprofitableLine.line.color)}">${h(unprofitableLine.line.name)}</strong> perd de l'argent (${Math.round(unprofitableLine.net).toLocaleString("fr-FR")} €)</div>`);
  }
  if (saturatedLine) {
    items.push(`<div class="opportunity">🥵 <strong style="color:${h(saturatedLine.line.color)}">${h(saturatedLine.line.name)}</strong> est bondée (${Math.round(saturatedLine.occupancy * 100)}%)</div>`);
  }
  if (underservedStop) {
    items.push(`<div class="opportunity">🙋 Le quartier <strong>${h(underservedStop.stop.name)}</strong> réclame des bus ! (service ${Math.round(underservedStop.level * 100)}%)</div>`);
  }
  return items.join("");
}

// V12.0 — tableau de la ville, une ligne par arrêt
function renderCityOverview(state) {
  const rows = [...state.city.stops]
    .sort((a, b) => b.population - a.population)
    .map(s => {
      const level = serviceLevel(state, s);
      return `<div class="overview-row"><span>${h(s.name)}</span><span>${s.population.toLocaleString("fr-FR")}</span><span style="color:${h(serviceLevelColor(level))};font-weight:900">${Math.round(level * 100)}%</span></div>`;
    }).join("");
  return `<div class="overview-header"><span>Arrêt</span><span>Pop.</span><span>Service</span></div>${rows}`;
}

export function createRenderer(canvas, state) {
  const ctx = canvas.getContext("2d");

  // Camera state — x/y = coordonnées MONDE du CENTRE de l'écran.
  const camera = {
    x: 0,
    y: 0,
    zoom: 1,
    minZoom: 0.5,
    maxZoom: 3,
  };

  // ----- DPR / resize -----
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(resizeCanvas).observe(canvas);
  }
  // Force une passe de resize après le premier layout garanti
  if (typeof requestAnimationFrame !== "undefined") {
    requestAnimationFrame(() => resizeCanvas());
  }

  function drawCity(heatmap = null) {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = canvas.clientWidth || canvas.width / dpr;
    const H = canvas.clientHeight || canvas.height / dpr;

    ctx.save();
    // Transform canonique
    ctx.translate(W / 2, H / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    const viewW = W / camera.zoom;
    const viewH = H / camera.zoom;
    const left = camera.x - viewW / 2;
    const top = camera.y - viewH / 2;

    // Fond crème façon plateau
    ctx.fillStyle = CREAM;
    ctx.fillRect(left, top, viewW, viewH);

    // Petits points de fond (motif "papier à points") — dessinés en monde
    if (camera.zoom > 0.7) {
      const dotStep = 40;
      const dotR = 1.2;
      ctx.fillStyle = "rgba(31, 35, 64, 0.08)";
      const startX = Math.floor(left / dotStep) * dotStep;
      const startY = Math.floor(top / dotStep) * dotStep;
      for (let x = startX; x <= left + viewW; x += dotStep) {
        for (let y = startY; y <= top + viewH; y += dotStep) {
          ctx.beginPath();
          ctx.arc(x, y, dotR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Grille subtile à fort zoom
    if (camera.zoom > 1.4) {
      ctx.strokeStyle = "rgba(31, 35, 64, 0.08)";
      ctx.lineWidth = 1 / camera.zoom;
      const step = 50;
      const startX = Math.floor(left / step) * step;
      const endX = left + viewW;
      for (let x = startX; x <= endX; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + viewH);
        ctx.stroke();
      }
      const startY = Math.floor(top / step) * step;
      const endY = top + viewH;
      for (let y = startY; y <= endY; y += step) {
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left + viewW, y);
        ctx.stroke();
      }
    }

    // Blocs urbains — disques pastel sous les arrêts
    if (state.city?.stops) {
      for (const stop of state.city.stops) {
        const radius = Math.max(6, Math.sqrt(stop.population / 90));
        const density = Math.min(0.9, stop.population / 3500);
        ctx.fillStyle = `rgba(255, 210, 63, ${0.15 + density * 0.35})`;
        ctx.beginPath();
        ctx.arc(stop.x, stop.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Routes — façon jeu de plateau : contour épais + remplissage crème
    if (state.city?.roads) {
      for (const road of state.city.roads) {
        const a = state.city.stops.find(s => s.id === road.a);
        const b = state.city.stops.find(s => s.id === road.b);
        if (!a || !b) continue;

        const edge = state.network?.edges?.find(
          e => (e.a === road.a && e.b === road.b) || (e.a === road.b && e.b === road.a)
        );
        const closed = edge && state.network.closedEdgeIds?.has(edge.id);

        const width = road.type === "arterial" ? 10 : 6;

        // Contour noir
        ctx.strokeStyle = INK;
        ctx.lineWidth = width + 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();

        // Remplissage
        ctx.strokeStyle = closed ? ROAD_CLOSED : ROAD_LIGHT;
        ctx.lineWidth = width;
        if (closed) {
          ctx.setLineDash([8, 8]);
        }
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (closed) ctx.setLineDash([]);
      }
    }

    // Heatmap (overlay cartoon)
    if (Array.isArray(heatmap) && heatmap.length) {
      for (const segment of heatmap) {
        if (!segment?.a || !segment?.b) continue;
        ctx.save();
        ctx.strokeStyle = `rgba(239, 71, 111, ${Math.min(0.75, 0.2 + (segment.congestion || 0) * 0.6)})`;
        ctx.lineWidth = 12 + Math.min(12, (segment.load || 0) * 2.4);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(segment.a.x, segment.a.y);
        ctx.lineTo(segment.b.x, segment.b.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Lignes de transport — épaisses avec contour
    if (state.lines) {
      for (const line of state.lines) {
        const ids = line.route?.nodeIds || [];
        if (ids.length < 2) continue;
        const nodes = ids.map(id => state.network.nodes.get(id)).filter(Boolean);
        if (nodes.length < 2) continue;

        // Contour
        ctx.strokeStyle = INK;
        ctx.lineWidth = 9;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.setLineDash([]);
        ctx.beginPath();
        nodes.forEach((node, i) => {
          if (i === 0) ctx.moveTo(node.x, node.y);
          else ctx.lineTo(node.x, node.y);
        });
        ctx.stroke();

        // Couleur
        ctx.strokeStyle = line.color;
        ctx.lineWidth = 5;
        if (line.mode === "metro") {
          ctx.setLineDash([2, 8]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.beginPath();
        nodes.forEach((node, i) => {
          if (i === 0) ctx.moveTo(node.x, node.y);
          else ctx.lineTo(node.x, node.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Arrêts en attente — pointillés orange vif
    if (state.pendingStops?.length) {
      const points = state.pendingStops
        .map(id => state.city.stops.find(s => s.id === id))
        .filter(Boolean);
      if (points.length >= 2) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 9;
        ctx.lineCap = "round";
        ctx.setLineDash([10, 10]);
        ctx.beginPath();
        points.forEach((s, i) => {
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.stroke();

        ctx.strokeStyle = ORANGE;
        ctx.lineWidth = 5;
        ctx.beginPath();
        points.forEach((s, i) => {
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Véhicules — carrés arrondis avec contour et ombre
    if (state.vehicles) {
      for (const v of state.vehicles) {
        const p = vehiclePosition(state, v);
        if (!p) continue;
        const line = state.lines.find(l => l.id === v.lineId);
        if (!line) continue;

        const broken = v.brokenTicksLeft > 0;
        const size = 18;
        const half = size / 2;

        // Ombre
        ctx.fillStyle = "rgba(31, 35, 64, 0.25)";
        roundRect(p.x - half + 2, p.y - half + 3, size, size, 5);
        ctx.fill();

        // Corps
        ctx.fillStyle = broken ? "#9aa0b3" : line.color;
        roundRect(p.x - half, p.y - half, size, size, 5);
        ctx.fill();

        // Contour
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.5;
        roundRect(p.x - half, p.y - half, size, size, 5);
        ctx.stroke();

        // Indicateur de panne ou congestion
        if (broken) {
          ctx.font = "12px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#fff";
          ctx.fillText("🔧", p.x, p.y + 1);
        } else if ((v.congestion ?? 1) < 0.85) {
          ctx.fillStyle = CORAL;
          ctx.beginPath();
          ctx.arc(p.x + half - 2, p.y - half + 2, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }

    // Arrêts — gros points pastel
    if (state.city?.stops) {
      for (const s of state.city.stops) {
        const selected = state.selectedStop === s.id;
        const pending = state.pendingStops?.includes(s.id);
        const served = state.lines?.some(l => l.stopIds.includes(s.id));

        const baseRadius = STOP_RADIUS;
        const radius = pending ? baseRadius + 6 : selected ? baseRadius + 4 : baseRadius;

        // Ombre
        ctx.fillStyle = "rgba(31, 35, 64, 0.3)";
        ctx.beginPath();
        ctx.arc(s.x + 2, s.y + 3, radius, 0, Math.PI * 2);
        ctx.fill();

        // Corps
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = pending ? SUN : selected ? "#ffffff" : PAPER;
        ctx.fill();

        // Contour de service (vert/jaune/rouge)
        ctx.strokeStyle = served ? serviceLevelColor(serviceLevel(state, s)) : INK;
        ctx.lineWidth = 3.5;
        ctx.stroke();

        // Anneau interne noir
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
        ctx.stroke();

        // Nom de l'arrêt avec fond crème pour lisibilité
        const fontSize = Math.max(10, 13 / camera.zoom);
        ctx.font = `800 ${fontSize}px "Nunito", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";

        const labelY = s.y - radius - 6;
        const textWidth = ctx.measureText(s.name).width;
        const padX = 6;
        const padY = 4;
        const boxH = fontSize + 6;

        // Fond de l'étiquette
        ctx.fillStyle = PAPER;
        roundRect(
          s.x - textWidth / 2 - padX,
          labelY - fontSize + 2,
          textWidth + padX * 2,
          boxH,
          6
        );
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        roundRect(
          s.x - textWidth / 2 - padX,
          labelY - fontSize + 2,
          textWidth + padX * 2,
          boxH,
          6
        );
        ctx.stroke();

        // Texte
        ctx.fillStyle = INK;
        ctx.fillText(s.name, s.x, labelY);

        // Compteur d'attente en pastille
        const waiting = Object.values(s.waitingByDestination || {}).reduce((a, v) => a + v, 0);
        if (waiting > 1) {
          const countX = s.x + radius + 4;
          const countY = s.y + radius - 4;
          const countText = String(Math.floor(waiting));
          const countFont = Math.max(9, 11 / camera.zoom);
          ctx.font = `900 ${countFont}px "Nunito", system-ui, sans-serif`;
          const tw = ctx.measureText(countText).width;
          const cr = countFont * 0.9;

          ctx.fillStyle = CORAL;
          ctx.beginPath();
          ctx.arc(countX + tw / 2, countY, cr, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = INK;
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.fillStyle = "#fff";
          ctx.textBaseline = "middle";
          ctx.fillText(countText, countX + tw / 2, countY + 0.5);
          ctx.textBaseline = "alphabetic";
        }
      }
    }

    ctx.restore();
  }

  // Petit utilitaire de rectangle arrondi (fallback si pas de roundRect natif)
  function roundRect(x, y, w, h, r) {
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.arcTo(x + w, y, x + w, y + radius, radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
    ctx.lineTo(x + radius, y + h);
    ctx.arcTo(x, y + h, x, y + h - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
  }

  // ----- Panneau latéral + rendu global -----

  function render(options = {}) {
    drawCity(options.heatmap || null);

    const served = state.city.stops.filter(s =>
      state.lines.some(l => l.stopIds.includes(s.id))
    ).length;

    const moneyEl = document.getElementById("money");
    if (moneyEl) {
      moneyEl.textContent = Math.round(state.money).toLocaleString("fr-FR") + " €";
      moneyEl.parentElement?.classList.toggle("is-critical", state.money <= 0);
    }

    const passengersEl = document.getElementById("passengers");
    if (passengersEl) passengersEl.textContent = state.transported.toLocaleString("fr-FR");

    const satisfactionValue = satisfaction(state);
    const satisfactionEl = document.getElementById("satisfaction");
    if (satisfactionEl) {
      satisfactionEl.textContent = Math.round(satisfactionValue) + "%";
      satisfactionEl.parentElement?.classList.toggle("is-critical", satisfactionValue < 40);
    }

    const clockEl = document.getElementById("clock");
    if (clockEl) clockEl.textContent = formatTime(state.time);

    const cityNameEl = document.getElementById("cityName");
    if (cityNameEl) cityNameEl.textContent = state.city.name;

    const seedEl = document.getElementById("seedInput");
    if (seedEl) seedEl.value = state.city.seed;

    const pStats = passengerStats(state);
    const wStats = waitStats(state);
    const fin = networkFinancials(state);
    const dayIncome = fin.income - (state.dailyBaseline?.income || 0);
    const dayExpenses = fin.expenses - (state.dailyBaseline?.expenses || 0);
    const dayNet = dayIncome - dayExpenses;

    const networkStatsEl = document.getElementById("networkStats");
    if (networkStatsEl) {
      networkStatsEl.innerHTML = `
        <div class="stat-grid">
          <div class="stat"><small>Lignes</small><strong>${state.lines.length}</strong></div>
          <div class="stat"><small>Bus</small><strong>${state.vehicles.length}</strong></div>
          <div class="stat"><small>Arrêts</small><strong>${served}/${state.city.stops.length}</strong></div>
          <div class="stat"><small>Attente</small><strong>${Math.round(wStats.avgWaitMinutes)} min</strong></div>
          <div class="stat"><small>Transportés</small><strong>${state.totalArrived}</strong></div>
          <div class="stat"><small>Actifs</small><strong>${pStats.WAITING + pStats.BOARDING + pStats.ON_VEHICLE + pStats.TRANSFERRING}</strong></div>
          <div class="stat"><small>Routes</small><strong>${state.network.edges.length}</strong></div>
          <div class="stat"><small>Jour</small><strong>${(state.elapsedDays || 0) + 1}</strong></div>
          <div class="stat"><small>Abandons</small><strong>${state.totalAbandoned || 0}</strong></div>
          <div class="stat"><small>Service</small><strong>${state.totalDemand > 0 ? Math.round((state.totalArrived / state.totalDemand) * 100) : 0}%</strong></div>
          <div class="stat"><small>Demande</small><strong>${Math.round(state.totalGenerated).toLocaleString("fr-FR")}</strong></div>
          <div class="stat"><small>Recettes</small><strong>${Math.round(fin.income).toLocaleString("fr-FR")} €</strong></div>
          <div class="stat"><small>Dépenses</small><strong>${Math.round(fin.expenses).toLocaleString("fr-FR")} €</strong></div>
          <div class="stat"><small>Net total</small><strong style="color:${h(fin.net >= 0 ? GRASS : CORAL)}">${fin.net >= 0 ? "+" : ""}${Math.round(fin.net).toLocaleString("fr-FR")} €</strong></div>
          <div class="stat financial-highlight ${dayNet >= 0 ? "positive" : "negative"}"><small>💰 Aujourd'hui · revenus / coûts / marge</small><strong>${dayIncome >= 0 ? "+" : ""}${Math.round(dayIncome).toLocaleString("fr-FR")} / -${Math.round(dayExpenses).toLocaleString("fr-FR")} / ${dayNet >= 0 ? "+" : ""}${Math.round(dayNet).toLocaleString("fr-FR")} €</strong></div>
        </div>
        ${renderCashFlowTrend(state)}`;
    }

  
