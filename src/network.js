/** V27 — Network Core
 * Builds a deterministic graph from the city's road infrastructure and provides
 * shortest-path routing between stops. The transport lines remain user-defined;
 * the network decides how vehicles travel between their consecutive stops.
 *
 * V27 — refonte « Construction de routes » :
 *  - routes typées (street / avenue / boulevard / highway) avec capacité,
 *    limitation de vitesse et coût de construction ;
 *  - arêtes-polylignes : chaque route porte une liste de points (courbes V1 =
 *    chaînes de segments droits) ;
 *  - jonctions automatiques : deux routes qui se croisent géométriquement
 *    obtiennent un nœud de jonction partagé, sans action du joueur — les
 *    nœuds du graphe ne sont plus uniquement des arrêts ;
 *  - sens unique : une arête oneWay n'est traversable que de from → to.
 *
 * Les ids historiques (local/secondary/arterial) restent acceptés en lecture
 * (roadType() les mappe) : les anciens appels de test continuent de fonctionner.
 */

import { distance } from "./constants.js";

export const ROAD_TYPES = {
  street:    { id: "street",    name: "Rue",            lanes: 1, width: 8,  speed: 0.85, speedLimit: 40,  capacity: 400,  costPerPixel: 0.45, allowStops: true,  tramPossible: false, color: "#6B7889" },
  avenue:    { id: "avenue",    name: "Avenue",         lanes: 1, width: 13, speed: 1.1,  speedLimit: 60,  capacity: 800,  costPerPixel: 0.7,  allowStops: true,  tramPossible: true,  color: "#5A6577" },
  boulevard: { id: "boulevard", name: "Boulevard",      lanes: 2, width: 19, speed: 1.35, speedLimit: 70,  capacity: 1200, costPerPixel: 1.15, allowStops: false, tramPossible: true,  color: "#4A5568" },
  highway:   { id: "highway",   name: "Voie rapide",    lanes: 2, width: 24, speed: 1.6,  speedLimit: 100, capacity: 2000, costPerPixel: 1.8,  allowStops: false, tramPossible: false, color: "#39424E" }
};

// Alias historiques V22 : les routes générées avant la V27 restent lisibles.
const LEGACY_ROAD_TYPES = { local: "street", secondary: "avenue", arterial: "boulevard" };

export function roadType(type) {
  if (ROAD_TYPES[type]) return ROAD_TYPES[type];
  const mapped = LEGACY_ROAD_TYPES[type];
  if (mapped) return ROAD_TYPES[mapped];
  return ROAD_TYPES.street;
}

/** Coût de construction d'une route (€) pour une longueur de polyline donnée. */
export function roadConstructionCost(type, lengthPx) {
  return Math.max(25, Math.round((lengthPx || 0) * roadType(type).costPerPixel));
}

/** Longueur d'une polyline [{x,y}...]. */
export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/**
 * Points d'une route, normalisés. Une route peut être :
 *  - reliée à deux arrêts (a/b ou startStopId/endStopId) ;
 *  - libre (start/end) ;
 *  - une polyline explicite (points) — V27.
 * Les anciennes routes sans points recoivent la droite [départ, arrivée].
 */
export function roadPoints(road, stopsById = null) {
  if (Array.isArray(road.points) && road.points.length >= 2) return road.points;
  const a = stopsById && road.a ? stopsById.get(road.a) : null;
  const b = stopsById && road.b ? stopsById.get(road.b) : null;
  const start = a || road.start || (road.startStopId && stopsById ? stopsById.get(road.startStopId) : null);
  const end = b || road.end || (road.endStopId && stopsById ? stopsById.get(road.endStopId) : null);
  if (start && end) return [{ x: start.x, y: start.y }, { x: end.x, y: end.y }];
  return null;
}

/** Intersection stricte de deux segments [p1,p2] × [p3,p4], ou null. */
function segmentIntersection(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denominator = d1x * d2y - d1y * d2x;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denominator;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + d1x * t, y: p1.y + d1y * t };
}

function near(a, b, tolerance = 1) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
}

/**
 * V27 — création du réseau : arrêts + jonctions géométriques + waypoints.
 * Le graphe est reconstruit à partir de city.roads à chaque appel (le patron
 * historique du dépôt) : supprimer une route supprime mécaniquement ses nœuds
 * exclusifs, donc aucun nœud orphelin ne peut survivre.
 */
export function createNetwork(city) {
  const stopsById = new Map(city.stops.map(s => [s.id, s]));

  // --- 1. Polylines normalisées des routes ------------------------------
  const roads = (city.roads || []).map((road, roadIndex) => {
    const points = roadPoints(road, stopsById);
    // Correction : les voiries sans id (routes générées pliées en carrefour à
    // 90°) produisaient des waypoints « waypoint-undefined-N » qui fusionnaient
    // entre routes différentes (le test d'id court-circuite le test de
    // position) : arêtes parasites traversant la carte. Uid stable par voirie.
    return points ? { road, uid: road.id || `road-${roadIndex + 1}`, points } : null;
  }).filter(Boolean);

  // --- 2. Nœuds : arrêts d'abord ------------------------------------------
  const nodes = new Map();
  const nodeAt = new Map(); // clé "x|y" arrondie → id, pour fusionner les nœuds confondus
  const registerNode = (id, x, y, name, kind) => {
    if (nodes.has(id)) return id;
    const key = `${Math.round(x * 10)}|${Math.round(y * 10)}`;
    const existing = nodeAt.get(key);
    if (existing && near(nodes.get(existing), { x, y })) return existing;
    nodes.set(id, { id, x, y, name: name || id, kind: kind || "waypoint" });
    nodeAt.set(key, id);
    return id;
  };
  for (const stop of city.stops) {
    registerNode(stop.id, stop.x, stop.y, stop.name, "stop");
  }

  let junctionCount = 0;
  let waypointCount = 0;
  const makeJunctionNode = (x, y) => {
    const key = `${Math.round(x * 10)}|${Math.round(y * 10)}`;
    const existing = nodeAt.get(key);
    if (existing && near(nodes.get(existing), { x, y })) return existing;
    junctionCount += 1;
    return registerNode(`junction-${junctionCount}`, x, y, "Jonction", "junction");
  };
  const makeWaypointNode = (uid, index, x, y) => {
    waypointCount += 1;
    return registerNode(`waypoint-${uid}-${index}`, x, y, null, "waypoint");
  };

  // --- 3. Waypoints intérieurs des polylignes -----------------------------
  // (un point intermédiaire devient un nœud du graphe : les arrêts/segments
  // suivants peuvent s'y accrocher, et le rendu suit exactement la polyline.)
  const roadNodeSequences = roads.map(({ road, uid, points }) => {
    const seq = points.map((point, index) => {
      if (index === 0 || index === points.length - 1) return { point, interior: false };
      return { point, interior: true };
    });
    return { road, uid, points, seq };
  });

  // --- 4. Jonctions : intersections entre paires de routes ----------------
  // Deux routes qui se croisent géométriquement partagent un nœud de jonction.
  // Les croisements proches d'un nœud existant (arrêt, waypoint) fusionnent
  // dans ce nœud plutôt que de créer un doublon.
  const junctionsOnSegment = new Map(); // "roadIndex:segIndex" → [{x,y,t}]
  for (let i = 0; i < roadNodeSequences.length; i++) {
    for (let j = i + 1; j < roadNodeSequences.length; j++) {
      const a = roadNodeSequences[i];
      const b = roadNodeSequences[j];
      for (let si = 0; si < a.points.length - 1; si++) {
        for (let sj = 0; sj < b.points.length - 1; sj++) {
          const hit = segmentIntersection(a.points[si], a.points[si + 1], b.points[sj], b.points[sj + 1]);
          if (!hit) continue;
          const keyA = `${i}:${si}`;
          const keyB = `${j}:${sj}`;
          if (!junctionsOnSegment.has(keyA)) junctionsOnSegment.set(keyA, []);
          if (!junctionsOnSegment.has(keyB)) junctionsOnSegment.set(keyB, []);
          junctionsOnSegment.get(keyA).push(hit);
          junctionsOnSegment.get(keyB).push(hit);
        }
      }
    }
  }

  // --- 5. Séquences de nœuds par route (points + jonctions + waypoints) ----
  const roadEdgePlans = roadNodeSequences.map(({ road, uid, points, seq }, index) => {
    const nodeIds = [];
    for (let s = 0; s < points.length; s++) {
      const entry = seq[s];
      if (entry.interior) {
        nodeIds.push(makeWaypointNode(uid, s, points[s].x, points[s].y));
      } else {
        // Extrémités : accrochées à l'arrêt si la route en désigne un.
        const stopId = s === 0 ? (road.a || road.startStopId) : (road.b || road.endStopId);
        if (stopId && stopsById.has(stopId) && near(stopsById.get(stopId), points[s], 1)) {
          nodeIds.push(stopId);
        } else {
          const nodeId = makeWaypointNode(uid, s, points[s].x, points[s].y);
          nodeIds.push(nodeId);
        }
      }
      // Jonctions tombant sur ce segment (entre s et s+1).
      const hits = (junctionsOnSegment.get(`${index}:${s}`) || [])
        .slice()
        .sort((p, q) => Math.hypot(p.x - points[s].x, p.y - points[s].y) - Math.hypot(q.x - points[s].x, q.y - points[s].y));
      for (const hit of hits) {
        nodeIds.push(makeJunctionNode(hit.x, hit.y));
      }
    }
    return { road, nodeIds };
  });

  // --- 6. Arêtes ------------------------------------------------------------
  const edges = [];
  const adjacency = new Map(city.stops.map(s => [s.id, []]));
  const ensureAdjacency = (id) => { if (!adjacency.has(id)) adjacency.set(id, []); };
  const degree = new Map(city.stops.map(s => [s.id, 0]));

  for (const { road, nodeIds } of roadEdgePlans) {
    const spec = roadType(road.type);
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const aId = nodeIds[i];
      const bId = nodeIds[i + 1];
      if (aId === bId) continue;
      const a = nodes.get(aId);
      const b = nodes.get(bId);
      if (!a || !b) continue;
      // Règle historique préservée : un ARRET ne peut pas recevoir plus de
      // trois routes (les jonctions libres n'ont pas de plafond).
      // V28 — un arrêt de carrefour porte les 4 demi-arêtes de son croisement :
      // il échappe au plafond (ce n'est pas un arrêt de quartier).
      const isStop = (id) => stopsById.has(id) && !String(id).startsWith("carrefour-");
      if (isStop(aId) && (degree.get(aId) || 0) >= 3) continue;
      if (isStop(bId) && (degree.get(bId) || 0) >= 3) continue;
      const length = distance(a, b);
      const edge = {
        id: `edge-${edges.length + 1}`,
        roadId: road.id || null,
        a: aId,
        b: bId,
        type: spec.id,
        lanes: road.lanes || spec.lanes,
        speed: spec.speed,
        speedLimit: road.speedLimit || spec.speedLimit,
        capacity: road.capacity || spec.capacity,
        oneWay: road.oneWay === true,
        allowStops: road.allowStops ?? spec.allowStops,
        weight: length / spec.speed,
        length
      };
      edges.push(edge);
      if (isStop(aId)) degree.set(aId, (degree.get(aId) || 0) + 1);
      if (isStop(bId)) degree.set(bId, (degree.get(bId) || 0) + 1);
      ensureAdjacency(aId);
      ensureAdjacency(bId);
      adjacency.get(aId).push({ to: bId, edge, weight: edge.weight });
      if (!edge.oneWay) adjacency.get(bId).push({ to: aId, edge, weight: edge.weight });
    }
  }

  // --- 7. Jonctions dérivées (rendu des carrefours/feux) -------------------
  const junctions = [];
  for (const [nodeId, links] of adjacency) {
    if (links.length < 2) continue;
    const types = new Set(links.map(link => link.edge.type));
    const majorCount = links.filter(link => link.edge.type === "boulevard" || link.edge.type === "highway").length;
    const signal = majorCount >= 2 || (majorCount >= 1 && types.has("avenue"));
    junctions.push({ id: `junction-${nodeId}`, nodeId, roadTypes: [...types], signal, phase: "green-main" });
  }
  city.junctions = junctions;

  return {
    version: "27.0",
    nodes,
    edges,
    adjacency,
    junctions,
    pathCache: new Map()
  };
}

/** V27 — arête entre deux nœuds adjacents (sens unique respecté). */
export function edgeBetween(network, fromId, toId) {
  const links = network.adjacency.get(fromId) || [];
  return links.find(link => link.to === toId)?.edge || null;
}

// V8.0 — respected by shortestPath/routeLine (routeLine calls shortestPath,
// so it needs no change itself) and by countComponents' connectivity check.
function isEdgeClosed(network, edge) {
  return network.closedEdgeIds?.has(edge.id) ?? false;
}

export function shortestPath(network, fromId, toId) {
  if (fromId === toId) return [fromId];
  // V8.0: while any road is closed for works, bypass the cache entirely —
  // cached entries don't know about closures, and this network is small
  // enough that recomputing every time is cheap. Normal (no-disruption)
  // pathfinding is unaffected and still cached as before.
  const hasClosures = (network.closedEdgeIds?.size ?? 0) > 0;
  const key = `${fromId}>${toId}`;
  if (!hasClosures && network.pathCache.has(key)) return [...network.pathCache.get(key)];

  const dist = new Map();
  const prev = new Map();
  const open = new Set(network.nodes.keys());
  for (const id of open) dist.set(id, Infinity);
  dist.set(fromId, 0);

  while (open.size) {
    let current = null;
    let best = Infinity;
    for (const id of open) {
      const d = dist.get(id);
      if (d < best) { best = d; current = id; }
    }
    if (current === null || best === Infinity) break;
    open.delete(current);
    if (current === toId) break;

    for (const link of network.adjacency.get(current) || []) {
      if (!open.has(link.to) || isEdgeClosed(network, link.edge)) continue;
      const candidate = best + link.weight;
      if (candidate < dist.get(link.to)) {
        dist.set(link.to, candidate);
        prev.set(link.to, current);
      }
    }
  }

  if (!prev.has(toId)) return null;
  const path = [toId];
  let cursor = toId;
  while (cursor !== fromId) {
    cursor = prev.get(cursor);
    if (!cursor) return null;
    path.push(cursor);
  }
  path.reverse();
  if (!hasClosures) network.pathCache.set(key, path);
  return [...path];
}

/**
 * V21.0 — Route d'une ligne : ALLER-RETOUR.
 * Avant : [a, b, c] donnait une boucle fermée a→b→c→a (retour à vide).
 * Maintenant : [a, b, c] donne a→b→c→b→a (aller chargé, retour chargé).
 */
export function routeLine(network, stopIds) {
  if (!Array.isArray(stopIds) || stopIds.length < 2) return null;

  // --- 1. Aller simple : a → b → c ---
  const forward = [];
  let oneWayLength = 0;

  for (let i = 0; i < stopIds.length - 1; i++) {
    const from = stopIds[i];
    const to = stopIds[i + 1];
    const path = shortestPath(network, from, to);
    if (!path) return null;

    if (i === 0) forward.push(...path);
    else forward.push(...path.slice(1));

    for (let j = 1; j < path.length; j++) {
      const na = network.nodes.get(path[j - 1]);
      const nb = network.nodes.get(path[j]);
      if (na && nb) oneWayLength += distance(na, nb);
    }
  }

  // --- 2. Retour miroir : c → b → a ---
  const backward = forward.slice().reverse().slice(1, -1);
  const nodeIds = forward.concat(backward);

  // --- 3. Longueurs ---
  const cycleLength = oneWayLength * 2;

  return {
    nodeIds,
    totalLength: oneWayLength,
    cycleLength,
    legs: stopIds.map((from, i) => ({
      from,
      to: stopIds[(i + 1) % stopIds.length],
      path: shortestPath(network, from, stopIds[(i + 1) % stopIds.length])
    }))
  };
}

// V23 — le tram peut disposer de voies indépendantes de la voirie.
export function createTramNetwork(city) {
  const tracks = city.tramTracks || [];
  const nodes = new Map(city.stops.map(s => [s.id, { id: s.id, x: s.x, y: s.y, name: s.name }]));
  const adjacency = new Map(city.stops.map(s => [s.id, []]));
  const edges = [];
  for (const track of tracks) {
    const ids = track.stopIds || (track.a && track.b ? [track.a, track.b] : []);
    for (let i = 0; i < ids.length - 1; i++) {
      const a = nodes.get(ids[i]);
      const b = nodes.get(ids[i + 1]);
      if (!a || !b) continue;
      const weight = distance(a, b);
      const edge = { id: track.id || `tram-track-${edges.length + 1}`, a: a.id, b: b.id,
        type: "tram-track", weight, length: weight, allowStops: true };
      edges.push(edge);
      adjacency.get(a.id).push({ to: b.id, edge, weight });
      adjacency.get(b.id).push({ to: a.id, edge, weight });
    }
  }
  return { version: "23.0-tram", nodes, edges, adjacency, pathCache: new Map(), independent: true };
}

// V6.0/V24/V27 — helpers for extending the surface graph as the city grows.
export function addNetworkEdge(network, aId, bId, type = "avenue") {
  if (aId === bId || !network.nodes.has(aId) || !network.nodes.has(bId)) return null;
  const duplicate = network.edges.find(edge =>
    (edge.a === aId && edge.b === bId) || (edge.a === bId && edge.b === aId));
  if (duplicate) return duplicate;
  if ((network.adjacency.get(aId)?.length || 0) >= 3 || (network.adjacency.get(bId)?.length || 0) >= 3) return null;
  const a = network.nodes.get(aId);
  const b = network.nodes.get(bId);
  const spec = roadType(type);
  const length = distance(a, b);
  const edge = { id: `edge-${network.edges.length + 1}`, roadId: null, a: aId, b: bId, type: spec.id,
    lanes: spec.lanes, speed: spec.speed, speedLimit: spec.speedLimit, capacity: spec.capacity,
    oneWay: false, allowStops: spec.allowStops, length,
    weight: length / spec.speed };
  network.edges.push(edge);
  network.adjacency.get(aId).push({ to: bId, edge, weight: edge.weight });
  network.adjacency.get(bId).push({ to: aId, edge, weight: edge.weight });
  network.pathCache.clear();
  return edge;
}
export function addNetworkNode(network, id, x, y, parentId) {
  if (network.nodes.has(id)) return;
  if (!network.nodes.has(parentId)) return;
  network.nodes.set(id, { id, x, y, name: id });
  network.adjacency.set(id, []);
  addNetworkEdge(network, parentId, id, "avenue");
  network.junctions = network.junctions || [];
}
// V13.0 — underground network: a metro tunnel doesn't need existing roads.
export function createUndergroundNetwork(city) {
  const nodes = new Map(city.stops.map(s => [s.id, { id: s.id, x: s.x, y: s.y, name: s.name }]));
  const adjacency = new Map(city.stops.map(s => [s.id, []]));
  const edges = [];

  const stops = city.stops;
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      const a = stops[i];
      const b = stops[j];
      const weight = distance(a, b);
      const edge = { id: `tunnel-${edges.length + 1}`, a: a.id, b: b.id, type: "tunnel", weight };
      edges.push(edge);
      adjacency.get(a.id).push({ to: b.id, edge, weight });
      adjacency.get(b.id).push({ to: a.id, edge, weight });
    }
  }

  return { version: "13.0-underground", nodes, edges, adjacency, pathCache: new Map() };
}

export function networkStats(network) {
  const connected = [...network.nodes.keys()].filter(id => (network.adjacency.get(id) || []).length > 0).length;
  return {
    nodes: network.nodes.size,
    edges: network.edges.length,
    connectedNodes: connected,
    components: countComponents(network)
  };
}

/**
 * Composantes connexes, en ignorant le sens des arêtes : une ville coupée en
 * deux l'est quel que soit le sens de circulation de ses rues, et les travaux
 * (V8) se refusent à créer une coupure même en présence de sens uniques.
 */
export function countComponents(network) {
  const seen = new Set();
  let count = 0;
  for (const start of network.nodes.keys()) {
    if (seen.has(start)) continue;
    count++;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const id = stack.pop();
      for (const link of network.adjacency.get(id) || []) {
        if (!seen.has(link.to) && !isEdgeClosed(network, link.edge)) {
          seen.add(link.to);
          stack.push(link.to);
        }
      }
      // Traversée inverse : les voisins qui pointent vers id via un oneWay.
      for (const [otherId, links] of network.adjacency) {
        if (seen.has(otherId)) continue;
        for (const link of links) {
          if (link.to === id && !isEdgeClosed(network, link.edge)) {
            seen.add(otherId);
            stack.push(otherId);
            break;
          }
        }
      }
    }
  }
  return count;
}

// === FIN DU FICHIER network.js ===

