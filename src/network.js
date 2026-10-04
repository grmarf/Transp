/** V2.2 — Network Core
 * Builds a deterministic graph from the city's road infrastructure and provides
 * shortest-path routing between stops. The transport lines remain user-defined;
 * the network decides how vehicles travel between their consecutive stops.
 */

import { distance } from "./constants.js";

export function createNetwork(city) {
  const nodes = new Map(city.stops.map(s => [s.id, {
    id: s.id,
    x: s.x,
    y: s.y,
    name: s.name
  }]));

  const edges = [];
  const adjacency = new Map(city.stops.map(s => [s.id, []]));

  for (const road of city.roads) {
    const a = nodes.get(road.a || road.startStopId);
    const b = nodes.get(road.b || road.endStopId);
    if (!a || !b) continue;
    const weight = distance(a, b);
    const edge = { id: `road-${edges.length + 1}`, a: a.id, b: b.id, type: road.type, weight };
    edges.push(edge);
    adjacency.get(a.id).push({ to: b.id, edge, weight });
    adjacency.get(b.id).push({ to: a.id, edge, weight });
  }

  return {
    version: "2.2",
    nodes,
    edges,
    adjacency,
    pathCache: new Map()
  };
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
 *
 * Concrètement, `nodeIds` contient l'aller complet (a→…→c) suivi du retour
 * miroir (c→…→a) moins le dernier nœud, puisque la boucle `% ids.length`
 * du moteur ramène naturellement au point de départ.
 *
 * Exemple : [a, x, b, y, c] → [a, x, b, y, c, y, b, x]
 *   Parcours du véhicule : a → x → b → y → c → y → b → x → (retour à a)
 *   Arrêts visités : a, b, c, b, a — chaque arrêt 2× par cycle sauf les
 *   terminus, ce qui multiplie mécaniquement les occasions de montée.
 *
 * Deux longueurs sont exposées :
 *   - `totalLength` : longueur du trajet simple (a→c), utilisée pour le
 *     calcul du coût de création de la ligne (inchangé pour le joueur).
 *   - `cycleLength` : longueur du cycle complet (aller + retour), utilisée
 *     par lineHeadwayMinutes() dans vehicles.js pour calculer l'intervalle.
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

  // --- 2. Retour miroir : c → b → a (sans dupliquer le point de départ) ---
  // forward = [a, …, b, …, c]
  // backward = [c, …, b, …, a]
  // backward.slice(1, -1) = […, b, …] : on enlève c (déjà à la fin de
  // forward) et a (atteint par la boucle du moteur, pas besoin de le
  // répéter dans nodeIds).
  const backward = forward.slice().reverse().slice(1, -1);
  const nodeIds = forward.concat(backward);

  // --- 3. Longueurs ---
  // oneWayLength = a→c (aller simple, sert au coût de création de ligne)
  // cycleLength = oneWayLength × 2 (aller + retour, sert à l'intervalle)
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

// V6.0 — grafts a new node onto an existing one (used when a satellite
// district appears). A single new edge is enough since satellites are
// leaf branches; clearing the path cache keeps routing correct even
// though, in practice, a leaf addition can't shorten any existing path.
export function addNetworkNode(network, id, x, y, parentId) {
  if (network.nodes.has(id)) return;
  const parent = network.nodes.get(parentId);
  if (!parent) return;

  network.nodes.set(id, { id, x, y, name: id });
  network.adjacency.set(id, []);

  const weight = distance(parent, { x, y });
  const edge = { id: `road-${network.edges.length + 1}`, a: parentId, b: id, type: "secondary", weight };
  network.edges.push(edge);
  network.adjacency.get(parentId).push({ to: id, edge, weight });
  network.adjacency.get(id).push({ to: parentId, edge, weight });
  network.pathCache.clear();
}

// V13.0 — underground network: a metro tunnel doesn't need existing roads,
// so metro lines route through a fully independent, complete graph over
// the city's stops (every pair of stops has a direct tunnel edge) instead
// of the surface road graph above. A direct edge is always the shortest
// path between any two nodes here (triangle inequality on straight-line
// distances), so shortestPath/routeLine work on it completely unchanged —
// no separate pathfinding code needed for tunnels.
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
    }
  }
  return count;
}

// === FIN DU FICHIER network.js ===
