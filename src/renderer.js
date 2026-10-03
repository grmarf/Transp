import { STOP_RADIUS, vehiclePosition, satisfaction, lineHeadwayMinutes, networkFinancials, lineOccupancyRate, serviceLevel, networkOpportunities, intermodalStats } from "./engine.js";
import { vehicleMode } from "./vehicles.js";
import { eventSummary } from "./events.js";
import { progressionSummary } from "./progression.js";
import { contractSummary } from "./contracts.js";
import { latestReport } from "./reports.js";
import { seasonSummary } from "./seasons.js";
import { passengerStats, waitStats, PASSENGER_STATES } from "./passengers.js";
import { escapeHtml as h } from "./html.js";

const INK = "#1f2340";
const CREAM = "#fdf6e3";
const PAPER = "#fff8ec";
const SUN = "#ffd23f";
const ORANGE = "#ff8c42";
const CORAL = "#ef476f";
const SKY = "#4cc9f0";
const GRASS = "#7ac74f";
const ROAD_LIGHT = "#f0e7cd";
const ROAD_CLOSED = "#ffb347";

function serviceLevelColor(level) {
  if (level >= 0.6) return GRASS;
  if (level >= 0.3) return SUN;
  return CORAL;
}

function renderCashFlowTrend(state) {
  const days = state.dailyStats || [];
  if (!days.length) return "";
  const recent = days.slice(-7);
  const bars = recent.map(function (d) {
    const color = d.net >= 0 ? GRASS : CORAL;
    const hh = Math.min(28, 6 + Math.abs(d.net) / 100);
    return '<span style="display:inline-block;width:12px;height:' + hh + 'px;background:' + color + ';border:2px solid ' + INK + ';border-radius:3px;margin:0 2px;vertical-align:bottom"></span>';
  }).join("");
  const last = days[days.length - 1];
  const sign = last.net >= 0 ? "+" : "";
  const col = last.net >= 0 ? GRASS : CORAL;
  return '<div class="stat" style="margin-top:10px;"><small>Tendance 7 jours</small><br>' + bars + '<br><small>Dernier : <span style="color:' + col + ';font-weight:900">' + sign + Math.round(last.net).toLocaleString("fr-FR") + ' €</span></small></div>';
}

function renderOpportunities(state) {
  const o = networkOpportunities(state);
  if (!o.unprofitableLine && !o.saturatedLine && !o.underservedStop) {
    return '<div class="muted">Tout roule ! 🎉</div>';
  }
  const items = [];
  if (o.unprofitableLine) {
    items.push('<div class="opportunity">💸 <strong style="color:' + h(o.unprofitableLine.line.color) + '">' + h(o.unprofitableLine.line.name) + '</strong> perd de l\'argent (' + Math.round(o.unprofitableLine.net).toLocaleString("fr-FR") + ' €)</div>');
  }
  if (o.saturatedLine) {
    items.push('<div class="opportunity">🥵 <strong style="color:' + h(o.saturatedLine.line.color) + '">' + h(o.saturatedLine.line.name) + '</strong> est bondée (' + Math.round(o.saturatedLine.occupancy * 100) + '%)</div>');
  }
  if (o.underservedStop) {
    items.push('<div class="opportunity">🙋 Le quartier <strong>' + h(o.underservedStop.stop.name) + '</strong> réclame des bus !</div>');
  }
  return items.join("");
}

function renderCityOverview(state) {
  const rows = state.city.stops.slice().sort(function (a, b) { return b.population - a.population; }).map(function (s) {
    const level = serviceLevel(state, s);
    return '<div class="overview-row"><span>' + h(s.name) + '</span><span>' + s.population.toLocaleString("fr-FR") + '</span><span style="color:' + serviceLevelColor(level) + ';font-weight:900">' + Math.round(level * 100) + '%</span></div>';
  }).join("");
  return '<div class="overview-header"><span>Arrêt</span><span>Pop.</span><span>Service</span></div>' + rows;
}

export function createRenderer(canvas, state) {
  const ctx = canvas.getContext("2d");

  const camera = { x: 0, y: 0, zoom: 1, minZoom: 0.5, maxZoom: 3 };

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
  if (typeof requestAnimationFrame !== "undefined") {
    requestAnimationFrame(resizeCanvas);
  }

  function roundRect(x, y, w, hh, r) {
    const radius = Math.min(r, w / 2, hh / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.arcTo(x + w, y, x + w, y + radius, radius);
    ctx.lineTo(x + w, y + hh - radius);
    ctx.arcTo(x + w, y + hh, x + w - radius, y + hh, radius);
    ctx.lineTo(x + radius, y + hh);
    ctx.arcTo(x, y + hh, x, y + hh - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
  }

  function urbanNoise(x, y) {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  let urbanObstaclesCache = null;
  const roadPathCache = new Map();

  function urbanObstacles() {
    if (urbanObstaclesCache) return urbanObstaclesCache;
    const obstacles = [];
    const cell = 74;
    for (let x = -cell; x < 1000 + cell; x += cell) {
      for (let y = -cell; y < 650 + cell; y += cell) {
        const n = urbanNoise(x, y);
        if (n > .86) continue;
        const inset = 7 + n * 7;
        const w = cell - inset * 2;
        const h = cell - inset * 2;
        const buildingCount = 2 + Math.floor(n * 4);
        for (let building = 0; building < buildingCount; building++) {
          const bw = 9 + urbanNoise(x + building * 17, y) * 13;
          const bh = 8 + urbanNoise(x, y + building * 19) * 15;
          const bx = x + inset + 7 + urbanNoise(x + building, y + 4) * Math.max(8, w - bw - 14);
          const by = y + inset + 7 + urbanNoise(x + 4, y + building) * Math.max(8, h - bh - 14);
          obstacles.push({ x: bx, y: by, w: bw, h: bh });
        }
      }
    }
    urbanObstaclesCache = obstacles;
    return obstacles;
  }

  function routeAroundBuildings(a, b) {
    const key = [a.id, b.id].sort().join("|");
    if (roadPathCache.has(key)) {
      const cached = roadPathCache.get(key);
      return a.id < b.id ? cached : cached.slice().reverse();
    }
    const step = 20;
    const cols = 51;
    const rows = 34;
    const obstacles = urbanObstacles();
    const blocked = function (x, y, endpoint) {
      if (endpoint) return false;
      return obstacles.some(function (o) {
        return x >= o.x - 12 && x <= o.x + o.w + 12 && y >= o.y - 12 && y <= o.y + o.h + 12;
      });
    };
    const toNode = function (point) {
      return { x: Math.max(0, Math.min(cols - 1, Math.round(point.x / step))), y: Math.max(0, Math.min(rows - 1, Math.round(point.y / step))) };
    };
    const start = toNode(a);
    const goal = toNode(b);
    const id = function (x, y) { return y * cols + x; };
    const startId = id(start.x, start.y);
    const goalId = id(goal.x, goal.y);
    const open = [{ x: start.x, y: start.y, f: 0 }];
    const cameFrom = new Map();
    const cost = new Map([[startId, 0]]);
    const heuristic = function (x, y) { return Math.abs(x - goal.x) + Math.abs(y - goal.y); };
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    let found = false;
    while (open.length && open.length < 5000) {
      open.sort(function (left, right) { return left.f - right.f; });
      const current = open.shift();
      if (id(current.x, current.y) === goalId) { found = true; break; }
      directions.forEach(function (direction) {
        const nx = current.x + direction[0];
        const ny = current.y + direction[1];
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) return;
        const nextId = id(nx, ny);
        if (blocked(nx * step, ny * step, nextId === startId || nextId === goalId)) return;
        const moveCost = direction[0] && direction[1] ? 1.4 : 1;
        const nextCost = (cost.get(id(current.x, current.y)) || 0) + moveCost;
        if (nextCost >= (cost.get(nextId) ?? Infinity)) return;
        cost.set(nextId, nextCost);
        cameFrom.set(nextId, id(current.x, current.y));
        open.push({ x: nx, y: ny, f: nextCost + heuristic(nx, ny) });
      });
    }
    if (!found) return [a, b];
    const nodes = [];
    let currentId = goalId;
    while (currentId !== undefined) {
      nodes.unshift({ x: (currentId % cols) * step, y: Math.floor(currentId / cols) * step });
      currentId = cameFrom.get(currentId);
    }
    nodes[0] = { x: a.x, y: a.y };
    nodes[nodes.length - 1] = { x: b.x, y: b.y };
    const simplified = nodes.filter(function (point, index) {
      if (index === 0 || index === nodes.length - 1) return true;
      const previous = nodes[index - 1];
      const next = nodes[index + 1];
      return Math.sign(point.x - previous.x) !== Math.sign(next.x - point.x) || Math.sign(point.y - previous.y) !== Math.sign(next.y - point.y);
    });
    roadPathCache.set(key, a.id < b.id ? simplified : simplified.slice().reverse());
    return a.id < b.id ? simplified : simplified.slice().reverse();
  }

  function drawUrbanBase(left, top, viewW, viewH) {
    ctx.fillStyle = "#d7e2df";
    ctx.fillRect(left, top, viewW, viewH);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, viewW, viewH);
    ctx.clip();

    ctx.strokeStyle = "rgba(76, 201, 240, .26)";
    ctx.lineWidth = 42;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(left - 80, top + viewH * .72);
    ctx.bezierCurveTo(left + viewW * .2, top + viewH * .55, left + viewW * .62, top + viewH * .9, left + viewW + 80, top + viewH * .62);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 255, 255, .42)";
    ctx.lineWidth = 2;
    ctx.stroke();

    const cell = 74;
    const startX = Math.floor(left / cell) * cell - cell;
    const startY = Math.floor(top / cell) * cell - cell;
    for (let x = startX; x < left + viewW + cell; x += cell) {
      for (let y = startY; y < top + viewH + cell; y += cell) {
        const n = urbanNoise(x, y);
        const inset = 7 + n * 7;
        const w = cell - inset * 2;
        const h = cell - inset * 2;
        const park = n > .86;
        ctx.fillStyle = park ? "#a8c99a" : (n > .48 ? "#cbd8d0" : "#c4d2cd");
        roundRect(x + inset, y + inset, w, h, 8);
        ctx.fill();
        ctx.strokeStyle = park ? "rgba(42, 92, 70, .32)" : "rgba(31, 35, 64, .12)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (park) {
          ctx.fillStyle = "rgba(42, 92, 70, .42)";
          for (let tree = 0; tree < 4; tree++) {
            const tx = x + inset + 14 + urbanNoise(x + tree * 11, y + 3) * Math.max(10, w - 28);
            const ty = y + inset + 14 + urbanNoise(x + 7, y + tree * 13) * Math.max(10, h - 28);
            ctx.beginPath();
            ctx.arc(tx, ty, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          const buildingCount = 2 + Math.floor(n * 4);
          for (let building = 0; building < buildingCount; building++) {
            const bw = 9 + urbanNoise(x + building * 17, y) * 13;
            const bh = 8 + urbanNoise(x, y + building * 19) * 15;
            const bx = x + inset + 7 + urbanNoise(x + building, y + 4) * Math.max(8, w - bw - 14);
            const by = y + inset + 7 + urbanNoise(x + 4, y + building) * Math.max(8, h - bh - 14);
            ctx.fillStyle = urbanNoise(x + building * 5, y + building * 3) > .5 ? "#f3e5c7" : "#b6c4c2";
            roundRect(bx, by, bw, bh, 2);
            ctx.fill();
          }
        }
      }
    }
    ctx.restore();
  }

  function drawCity(heatmap) {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = canvas.clientWidth || canvas.width / dpr;
    const H = canvas.clientHeight || canvas.height / dpr;

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    const viewW = W / camera.zoom;
    const viewH = H / camera.zoom;
    const left = camera.x - viewW / 2;
    const top = camera.y - viewH / 2;

    drawUrbanBase(left, top, viewW, viewH);

    if (state.city && state.city.stops) {
      state.city.stops.forEach(function (stop) {
        const radius = Math.max(6, Math.sqrt(stop.population / 90));
        const density = Math.min(0.9, stop.population / 3500);
        ctx.fillStyle = "rgba(255, 210, 63, " + (0.15 + density * 0.35) + ")";
        ctx.beginPath();
        ctx.arc(stop.x, stop.y, radius, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    if (state.city && state.city.roads) {
      state.city.roads.forEach(function (road) {
        const a = state.city.stops.find(function (s) { return s.id === road.a; });
        const b = state.city.stops.find(function (s) { return s.id === road.b; });
        if (!a || !b) return;

        const edge = state.network && state.network.edges
          ? state.network.edges.find(function (e) {
              return (e.a === road.a && e.b === road.b) || (e.a === road.b && e.b === road.a);
            })
          : null;
        const closed = edge && state.network.closedEdgeIds && state.network.closedEdgeIds.has(edge.id);
        const width = road.type === "arterial" ? 14 : 9;
        const path = routeAroundBuildings(a, b);

        ctx.strokeStyle = "rgba(31, 35, 64, .38)";
        ctx.lineWidth = width + 5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        path.slice(1).forEach(function (point) { ctx.lineTo(point.x, point.y); });
        ctx.stroke();

        ctx.strokeStyle = closed ? ROAD_CLOSED : "#66747b";
        ctx.lineWidth = width;
        if (closed) ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        path.slice(1).forEach(function (point) { ctx.lineTo(point.x, point.y); });
        ctx.stroke();
        ctx.setLineDash([]);
        if (!closed) {
          ctx.strokeStyle = road.type === "arterial" ? "rgba(255, 231, 150, .85)" : "rgba(238, 244, 234, .72)";
          ctx.lineWidth = road.type === "arterial" ? 2 : 1.5;
          ctx.setLineDash(road.type === "arterial" ? [12, 10] : [6, 10]);
          ctx.beginPath();
          ctx.moveTo(path[0].x, path[0].y);
          path.slice(1).forEach(function (point) { ctx.lineTo(point.x, point.y); });
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });
    }

    if (Array.isArray(heatmap) && heatmap.length) {
      heatmap.forEach(function (segment) {
        if (!segment || !segment.a || !segment.b) return;
        ctx.strokeStyle = "rgba(239, 71, 111, " + Math.min(0.75, 0.2 + (segment.congestion || 0) * 0.6) + ")";
        ctx.lineWidth = 12 + Math.min(12, (segment.load || 0) * 2.4);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(segment.a.x, segment.a.y);
        ctx.lineTo(segment.b.x, segment.b.y);
        ctx.stroke();
      });
    }

    if (state.lines) {
      state.lines.forEach(function (line) {
        const ids = (line.route && line.route.nodeIds) || [];
        if (ids.length < 2) return;
        const nodes = ids.map(function (id) { return state.network.nodes.get(id); }).filter(Boolean);
        if (nodes.length < 2) return;

        ctx.strokeStyle = INK;
        ctx.lineWidth = 9;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        nodes.forEach(function (node, i) {
          if (i === 0) ctx.moveTo(node.x, node.y);
          else ctx.lineTo(node.x, node.y);
        });
        ctx.stroke();

        ctx.strokeStyle = line.color;
        ctx.lineWidth = 5;
        if (line.mode === "metro") ctx.setLineDash([2, 8]);
        else ctx.setLineDash([]);
        ctx.beginPath();
        nodes.forEach(function (node, i) {
          if (i === 0) ctx.moveTo(node.x, node.y);
          else ctx.lineTo(node.x, node.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }

    if (state.pendingStops && state.pendingStops.length) {
      const points = state.pendingStops.map(function (id) {
        return state.city.stops.find(function (s) { return s.id === id; });
      }).filter(Boolean);
      if (points.length >= 2) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 9;
        ctx.lineCap = "round";
        ctx.setLineDash([10, 10]);
        ctx.beginPath();
        points.forEach(function (s, i) {
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.stroke();

        ctx.strokeStyle = ORANGE;
        ctx.lineWidth = 5;
        ctx.beginPath();
        points.forEach(function (s, i) {
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    if (state.vehicles) {
      state.vehicles.forEach(function (v) {
        const p = vehiclePosition(state, v);
        if (!p) return;
        const line = state.lines.find(function (l) { return l.id === v.lineId; });
        if (!line) return;

        const broken = v.brokenTicksLeft > 0;
        const size = 18;
        const half = size / 2;

        ctx.fillStyle = "rgba(31, 35, 64, 0.25)";
        roundRect(p.x - half + 2, p.y - half + 3, size, size, 5);
        ctx.fill();

        ctx.fillStyle = broken ? "#9aa0b3" : line.color;
        roundRect(p.x - half, p.y - half, size, size, 5);
        ctx.fill();

        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.5;
        roundRect(p.x - half, p.y - half, size, size, 5);
        ctx.stroke();

        if (broken) {
          ctx.font = "12px system-ui";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#fff";
          ctx.fillText("🔧", p.x, p.y + 1);
        } else if ((v.congestion || 1) < 0.85) {
          ctx.fillStyle = CORAL;
          ctx.beginPath();
          ctx.arc(p.x + half - 2, p.y - half + 2, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      });
    }

    if (state.city && state.city.stops) {
      state.city.stops.forEach(function (s) {
        const selected = state.selectedStop === s.id;
        const pending = state.pendingStops && state.pendingStops.indexOf(s.id) >= 0;
        const served = state.lines && state.lines.some(function (l) { return l.stopIds.indexOf(s.id) >= 0; });

        const baseRadius = STOP_RADIUS;
        const radius = pending ? baseRadius + 6 : (selected ? baseRadius + 4 : baseRadius);

        ctx.fillStyle = "rgba(31, 35, 64, 0.3)";
        ctx.beginPath();
        ctx.arc(s.x + 2, s.y + 3, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = pending ? SUN : (selected ? "#ffffff" : PAPER);
        ctx.fill();

        ctx.strokeStyle = served ? serviceLevelColor(serviceLevel(state, s)) : INK;
        ctx.lineWidth = 3.5;
        ctx.stroke();

        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
        ctx.stroke();

        const fontSize = Math.max(10, 13 / camera.zoom);
        ctx.font = "800 " + fontSize + 'px "Nunito", system-ui, sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";

        const labelY = s.y - radius - 6;
        const textWidth = ctx.measureText(s.name).width;
        const padX = 6;
        const boxH = fontSize + 6;

        ctx.fillStyle = PAPER;
        roundRect(s.x - textWidth / 2 - padX, labelY - fontSize + 2, textWidth + padX * 2, boxH, 6);
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        roundRect(s.x - textWidth / 2 - padX, labelY - fontSize + 2, textWidth + padX * 2, boxH, 6);
        ctx.stroke();

        ctx.fillStyle = INK;
        ctx.fillText(s.name, s.x, labelY);

        const waiting = Object.values(s.waitingByDestination || {}).reduce(function (a, v) { return a + v; }, 0);
        if (waiting > 1) {
          const countX = s.x + radius + 4;
          const countY = s.y + radius - 4;
          const countText = String(Math.floor(waiting));
          const countFont = Math.max(9, 11 / camera.zoom);
          ctx.font = "900 " + countFont + 'px "Nunito", system-ui, sans-serif';
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
      });
    }

    ctx.restore();
  }

  function render(options = {}) {
    options = options || {};
    drawCity(options.heatmap || null);

    const served = state.city.stops.filter(function (s) {
      return state.lines.some(function (l) { return l.stopIds.indexOf(s.id) >= 0; });
    }).length;

    const moneyEl = document.getElementById("money");
    if (moneyEl) {
      moneyEl.textContent = Math.round(state.money).toLocaleString("fr-FR") + " €";
      if (moneyEl.parentElement) {
        moneyEl.parentElement.classList.toggle("is-critical", state.money <= 0);
      }
    }

    const passengersEl = document.getElementById("passengers");
    if (passengersEl) passengersEl.textContent = state.transported.toLocaleString("fr-FR");

    const satisfactionValue = satisfaction(state);
    const satisfactionEl = document.getElementById("satisfaction");
    if (satisfactionEl) {
      satisfactionEl.textContent = Math.round(satisfactionValue) + "%";
      if (satisfactionEl.parentElement) {
        satisfactionEl.parentElement.classList.toggle("is-critical", satisfactionValue < 40);
      }
    }

    const clockEl = document.getElementById("clock");
    if (clockEl) clockEl.textContent = formatTime(state.time);

    const cityNameEl = document.getElementById("cityNameInput");
    if (cityNameEl && document.activeElement !== cityNameEl && cityNameEl.value !== state.city.name) {
      cityNameEl.value = state.city.name;
    }

    const seedEl = document.getElementById("seedInput");
    if (seedEl && document.activeElement !== seedEl && seedEl.value !== state.city.seed) {
      seedEl.value = state.city.seed;
    }

    const pStats = passengerStats(state);
    const wStats = waitStats(state);
    const fin = networkFinancials(state);
    const dayIncome = fin.income - ((state.dailyBaseline && state.dailyBaseline.income) || 0);
    const dayExpenses = fin.expenses - ((state.dailyBaseline && state.dailyBaseline.expenses) || 0);
    const dayNet = dayIncome - dayExpenses;

    const networkStatsEl = document.getElementById("networkStats");
    if (networkStatsEl) {
      const netColor = fin.net >= 0 ? GRASS : CORAL;
      const dayClass = dayNet >= 0 ? "positive" : "negative";
      const stat = function (label, value) {
        return '<div class="stat"><small>' + label + '</small><strong>' + value + '</strong></div>';
      };
      networkStatsEl.innerHTML =
        '<div class="stat-grid">' +
          stat("Lignes", state.lines.length) +
          stat("Bus", state.vehicles.length) +
          stat("Arrêts", served + "/" + state.city.stops.length) +
          stat("Attente", Math.round(wStats.avgWaitMinutes) + " min") +
          stat("Transportés", state.totalArrived) +
          stat("Actifs", pStats.WAITING + pStats.BOARDING + pStats.ON_VEHICLE + pStats.TRANSFERRING) +
          stat("Routes", state.network.edges.length) +
          stat("Jour", (state.elapsedDays || 0) + 1) +
          stat("Abandons", state.totalAbandoned || 0) +
          stat("Service", (state.totalDemand > 0 ? Math.round((state.totalArrived / state.totalDemand) * 100) : 0) + "%") +
          stat("Demande", Math.round(state.totalGenerated).toLocaleString("fr-FR")) +
          stat("Recettes", Math.round(fin.income).toLocaleString("fr-FR") + " €") +
          stat("Dépenses", Math.round(fin.expenses).toLocaleString("fr-FR") + " €") +
          '<div class="stat"><small>Net total</small><strong style="color:' + netColor + '">' + (fin.net >= 0 ? "+" : "") + Math.round(fin.net).toLocaleString("fr-FR") + ' €</strong></div>' +
          '<div class="stat financial-highlight ' + dayClass + '"><small>💰 Aujourd\'hui · revenus / coûts / marge</small><strong>' + (dayIncome >= 0 ? "+" : "") + Math.round(dayIncome).toLocaleString("fr-FR") + ' / -' + Math.round(dayExpenses).toLocaleString("fr-FR") + ' / ' + (dayNet >= 0 ? "+" : "") + Math.round(dayNet).toLocaleString("fr-FR") + ' €</strong></div>' +
        '</div>' +
        renderCashFlowTrend(state);
    }

    const linesEl = document.getElementById("lines");
    if (linesEl) {
      if (!state.lines.length) {
        linesEl.innerHTML = '<div class="muted">Aucune ligne. Clique sur « ✏️ Nouvelle ligne » puis sur 2 arrêts sur la carte !</div>';
      } else {
        const rows = state.lines.map(function (l) {
          const headway = lineHeadwayMinutes(state, l);
          const net = (l.income || 0) - (l.expenses || 0);
          const occupancy = lineOccupancyRate(state, l);
          const occColor = occupancy == null ? "#999" : (occupancy >= 0.85 ? ORANGE : (occupancy <= 0.2 ? "#999" : GRASS));
          const lastVehicleId = l.vehicles[l.vehicles.length - 1];
          const stopNames = l.stopIds.map(function (id) {
            const s = state.city.stops.find(function (x) { return x.id === id; });
            return s ? h(s.name) : "?";
          }).join(" → ");
          const modeEmoji = l.mode === "metro" ? "🚇" : (l.mode === "tram" ? "🚊" : "🚌");
          const occLine = occupancy != null
            ? ' · <span style="color:' + occColor + ';font-weight:900">' + Math.round(occupancy * 100) + '%</span>'
            : "";
          const headwayLine = headway ? ' · ~' + Math.round(headway) + ' min' : "";
          const sellBtn = (l.vehicles.length > 1 && lastVehicleId != null)
            ? '<button type="button" class="small" data-sell-vehicle="' + h(l.id) + '" data-vehicle-id="' + h(lastVehicleId) + '">➖ Vendre (+' + Math.round(vehicleMode(l.mode).purchaseCost / 2).toLocaleString("fr-FR") + ' €)</button>'
            : "";
          return '<div class="line-row">' +
            '<div class="line-head"><strong style="color:' + h(l.color) + '">' + modeEmoji + ' ' + h(l.name) + '</strong><span class="pill">' + l.riders + ' 🧑</span></div>' +
            '<div style="margin-top:4px">' + stopNames + '</div>' +
            '<div class="muted">' + l.vehicles.length + ' véhicule' + (l.vehicles.length > 1 ? 's' : '') + headwayLine + occLine + '</div>' +
            '<div class="muted">+' + Math.round(l.income).toLocaleString("fr-FR") + ' € · -' + Math.round(l.expenses || 0).toLocaleString("fr-FR") + ' € · <span style="color:' + (net >= 0 ? GRASS : CORAL) + ';font-weight:900">' + (net >= 0 ? "+" : "") + Math.round(net).toLocaleString("fr-FR") + ' €</span></div>' +
            '<div class="line-actions">' +
              '<button type="button" class="small" data-buy-vehicle="' + h(l.id) + '">➕ Bus (' + vehicleMode(l.mode).purchaseCost.toLocaleString("fr-FR") + ' €)</button>' +
              '<button type="button" class="small" data-extend-line="' + h(l.id) + '">↔️ Prolonger</button>' +
              sellBtn +
              '<button type="button" class="small danger" data-delete-line="' + h(l.id) + '">🗑️ Supprimer</button>' +
            '</div>' +
          '</div>';
        }).join("");
        linesEl.innerHTML = rows;
      }
    }

    const stopEl = document.getElementById("stopInfo");
    if (stopEl) {
      if (!state.selectedStop) {
        stopEl.textContent = "Clique sur un arrêt sur la carte !";
      } else {
        const s = state.city.stops.find(function (x) { return x.id === state.selectedStop; });
        if (!s) {
          stopEl.textContent = "Clique sur un arrêt sur la carte !";
        } else {
          const sLines = state.lines.filter(function (l) { return l.stopIds.indexOf(s.id) >= 0; });
          const waitingHere = state.passengers.filter(function (p) {
            return p.currentStopId === s.id && (p.state === PASSENGER_STATES.WAITING || p.state === PASSENGER_STATES.TRANSFERRING);
          }).length;
          const level = serviceLevel(state, s);
          const linesStr = sLines.length ? '<br>🚌 Lignes : <b>' + sLines.map(function (l) { return h(l.name); }).join(", ") + '</b>' : "";
          stopEl.innerHTML = '<b style="font-size:1rem">📍 ' + h(s.name) + '</b><br>' +
            '👥 ' + s.population.toLocaleString("fr-FR") + ' hab. · 💼 ' + s.jobs.toLocaleString("fr-FR") + ' emplois · 🛍️ ' + s.commerce.toLocaleString("fr-FR") + ' commerces<br>' +
            '⭐ Service : <b>' + Math.round(level * 100) + '%</b> · ⏳ ' + waitingHere + ' en attente' +
            linesStr;
        }
      }
    }

    const logEl = document.getElementById("log");
    if (logEl) {
      logEl.innerHTML = state.logs.map(function (x) { return '<div class="log-entry">' + h(x) + '</div>'; }).join("");
    }

    const oppEl = document.getElementById("opportunities");
    if (oppEl) oppEl.innerHTML = renderOpportunities(state);

    const cityOvEl = document.getElementById("cityOverview");
    if (cityOvEl) cityOvEl.innerHTML = renderCityOverview(state);

    const journalEl = document.getElementById("journal");
    if (journalEl) {
      const entries = state.journal || [];
      journalEl.innerHTML = entries.map(function (e) {
        return '<div class="journal-entry journal-' + h(e.type) + '">' + h(e.text) + '</div>';
      }).join("");
    }

    const seasonEl = document.getElementById("seasonPanel");
    if (seasonEl) {
      const season = seasonSummary(state);
      seasonEl.innerHTML = '<div class="season-header"><b>' + h(season.icon) + ' ' + h(season.label) + '</b><span>Jour ' + season.dayInSeason + '/7</span></div>' +
        '<div class="season-effects" style="margin-top:6px">🚶 Demande ×' + season.demandMultiplier.toFixed(2) + ' · 💶 Tarif ×' + season.fareMultiplier.toFixed(2) + ' · 🏗️ Croissance ×' + season.growthMultiplier.toFixed(2) + '</div>';
    }

    const reportEl = document.getElementById("reportPanel");
    if (reportEl) {
      const report = latestReport(state);
      if (report) {
        reportEl.innerHTML = '<div class="report-header"><b>Jour ' + report.day + '</b><span class="' + (report.net >= 0 ? "positive" : "negative") + '">' + (report.net >= 0 ? "+" : "") + Math.round(report.net).toLocaleString("fr-FR") + ' €</span></div>' +
          '<div class="report-metrics"><div>💰 Revenus : ' + Math.round(report.income).toLocaleString("fr-FR") + ' €</div><div>💸 Dépenses : ' + Math.round(report.expenses).toLocaleString("fr-FR") + ' €</div><div>😊 Satisfaction : ' + Math.round(report.satisfaction) + '%</div><div>⏳ Attente : ' + Math.round(report.avgWait) + ' min</div><div>🏃 Abandons : ' + report.abandoned + '</div></div>';
      } else {
        reportEl.innerHTML = '<div class="muted">Ton premier rapport arrivera à la fin du jour 1.</div>';
      }
    }

    const contractsEl = document.getElementById("contractsPanel");
    if (contractsEl) {
      const coverage = state.city.stops.length
        ? state.lines.reduce(function (sum, line) { return sum + new Set(line.stopIds || []).size; }, 0) / state.city.stops.length
        : 0;
      const contracts = contractSummary(state, {
        satisfaction: satisfaction(state),
        transferShare: intermodalStats(state).shareWithTransfer,
        coverage: coverage,
      });
      if (contracts.length) {
        contractsEl.innerHTML = '<div class="muted">Renouvellement dans ' + contracts[0].remainingDays + ' jour(s)</div>' +
          contracts.map(function (c) {
            return '<div class="contract-row ' + c.status + '"><b>' + h(c.label) + '</b><span>' + c.progress + '%</span></div>';
          }).join("");
      } else {
        contractsEl.innerHTML = '<div class="muted">Les contrats arriveront au prochain jour.</div>';
      }
    }

    const progressionEl = document.getElementById("progressionPanel");
    if (progressionEl) {
      const transferShare = intermodalStats(state).shareWithTransfer;
      const progression = progressionSummary(state, { satisfaction: satisfaction(state), transferShare: transferShare });
      progressionEl.innerHTML = '<div class="progression-header"><b>🏅 ' + h(progression.rank) + '</b><span>⭐ ' + progression.reputation + ' · ' + progression.completed + '/' + progression.total + ' objectifs</span></div>';
    }

    const eventsEl = document.getElementById("eventPanel");
    if (eventsEl) {
      const events = eventSummary(state);
      if (events.length) {
        eventsEl.innerHTML = events.map(function (event) {
          return '<div class="event-row"><b>' + h(event.icon) + ' ' + h(event.label) + '</b><span>' + event.remainingDays + ' j · demande ×' + event.demandMultiplier.toFixed(2) + '</span></div>';
        }).join("");
      } else {
        eventsEl.innerHTML = '<div class="muted">Aucun événement en cours.</div>';
      }
    }

    const intermodalEl = document.getElementById("intermodalStats");
    if (intermodalEl) {
      const stats = intermodalStats(state);
      intermodalEl.innerHTML = '<div>🔁 Correspondances : ' + stats.avgTransfersPerTrip.toFixed(2) + '</div><div>🎫 Voyages avec correspondance : ' + (stats.shareWithTransfer * 100).toFixed(1) + '%</div>';
    }

    const heatmapLegend = document.getElementById("heatmapLegend");
    if (heatmapLegend) {
      const active = Array.isArray(options.heatmap) && options.heatmap.length > 0;
      heatmapLegend.hidden = !active;
      heatmapLegend.setAttribute("aria-hidden", String(!active));
      if (active) {
        const countEl = heatmapLegend.querySelector(".heatmap-count");
        if (countEl) {
          countEl.textContent = options.heatmap.length + " segment" + (options.heatmap.length > 1 ? "s" : "");
        }
      }
    }

    const chart = document.getElementById("financialChart");
    if (chart && chart.getContext) {
      const c = chart.getContext("2d");
      c.clearRect(0, 0, chart.width, chart.height);
      c.fillStyle = "#fff8ec";
      c.fillRect(0, 0, chart.width, chart.height);
      const days = (state.dailyStats || []).slice(-14);
      const max = Math.max(1, Math.max.apply(null, days.map(function (d) { return Math.abs(d.net); }).concat([1])));
      const mid = chart.height / 2;
      c.strokeStyle = INK;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, mid);
      c.lineTo(chart.width, mid);
      c.stroke();
      days.forEach(function (d, i) {
        const x = (i + 0.5) * chart.width / Math.max(1, days.length);
        const hh = Math.min(mid - 4, Math.abs(d.net) / max * (mid - 8));
        const barW = chart.width / Math.max(1, days.length) - 2;
        c.fillStyle = d.net >= 0 ? GRASS : CORAL;
        c.fillRect(x - barW / 2, mid - (d.net >= 0 ? hh : -hh), barW, hh);
        c.strokeStyle = INK;
        c.lineWidth = 1.5;
        c.strokeRect(x - barW / 2, mid - (d.net >= 0 ? hh : -hh), barW, hh);
      });
    }
  }

  function formatTime(minutes) {
    const hh = Math.floor(minutes / 60) % 24;
    const mm = Math.floor(minutes % 60);
    return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
  }

  return { render: render, camera: camera, resizeCanvas: resizeCanvas };
}

// === FIN DU FICHIER renderer.js ===
