// V28 — carrefours à 90°, arrêts de croisement, bâtiments sans superposition.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCity, mulberry32 } from '../src/city.js';
import { createState } from '../src/state.js';
import { createNetwork, ROAD_TYPES } from '../src/network.js';
import {
  ensureBuildingsState, seedInitialZones, spawnInitialBuildings, updateBuildings,
  rectsOverlap, rectClearOfRoads, segmentIntersectsRect
} from '../src/buildings.js';
import {
  computeCarrefours, orthogonaliseRoads, developCityCarrefours,
  segmentCross, CARREFOUR_STOP_MIN_GAP
} from '../src/carrefours.js';

const log = () => {};

// --- 1. Géométrie : croisement intérieur détecté, angle mesuré -------------
const cityA = {
  stops: [{ id: 'stop-1', x: 100, y: 300 }, { id: 'stop-2', x: 500, y: 300 }],
  roads: [
    { id: 'road-h', a: 'stop-1', b: 'stop-2', type: 'boulevard' },
    { id: 'road-d', start: { x: 200, y: 150 }, end: { x: 400, y: 450 }, type: 'street' }
  ]
};
const hits = computeCarrefours(cityA);
assert.equal(hits.length, 1, 'la diagonale croise le boulevard');
assert.ok(Math.abs(hits[0].x - 300) < 1 && Math.abs(hits[0].y - 300) < 1, 'croisement au point attendu');
// Diagonale atan2(300, 200) ≈ 56° de l'horizontale : loin des 90° visés.
assert.ok(Math.abs(hits[0].angle - 56) < 1.5, 'l\'angle aigu du croisement est mesuré (≈56°)');
// Les extrémités partagées ne comptent pas comme croisement.
assert.ok(!segmentCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }),
  'un croisement en extrémité commune n\'est pas un carrefour');

// --- 2. Redressement : la route n°2 pliée traverse à 90° -------------------
const bends = orthogonaliseRoads(cityA);
assert.ok(bends >= 1, 'le croisement oblique est redressé');
const bent = cityA.roads.find(r => r.id === 'road-d');
assert.ok(Array.isArray(bent.points) && bent.points.length === 5, 'la route pliée a un coude [A, X, P, Y, B]');
const P = bent.points[2];
assert.ok(Math.abs(P.x - 300) < 1 && Math.abs(P.y - 300) < 1, 'le coude passe par le croisement');
// Direction X→P puis P→Y : perpendiculaire au boulevard (horizontal).
const dir1 = { x: P.x - bent.points[1].x, y: P.y - bent.points[1].y };
const dir2 = { x: bent.points[3].x - P.x, y: bent.points[3].y - P.y };
const dot = dir1.x * 1 + dir1.y * 0; // produit scalaire avec l'horizontale
assert.ok(Math.abs(dot) < 1 && Math.abs(dir2.x) < 1, 'la traversée est verticale : carrefour à 90°');
assert.ok(dir1.y > 0 && dir2.y > 0, 'la route continue dans le même sens (bras orientés)');
// Extrémités préservées.
const first = bent.points[0], last = bent.points[bent.points.length - 1];
assert.equal(first.x, 200); assert.equal(first.y, 150);
assert.equal(last.x, 400); assert.equal(last.y, 450);
// Idempotence : déjà perpendiculaire → plus aucun pli.
assert.equal(orthogonaliseRoads(cityA), 0, 'un carrefour déjà à 90° n\'est pas retouché');

// --- 3. Arrêt de carrefour : posé, raccordé, borné ---------------------------
const report = developCityCarrefours(cityA, mulberry32(28));
// (croisement déjà à 90° après redressement : aucun pli, mais l'arrêt existe)
const carrefourStop = cityA.stops.find(s => s.id.startsWith('carrefour-'));
assert.ok(carrefourStop, 'un arrêt est posé sur le carrefour');
assert.ok(Math.hypot(carrefourStop.x - 300, carrefourStop.y - 300) < 1, 'l\'arrêt est sur le croisement');
assert.ok(carrefourStop.population > 0 && carrefourStop.jobs > 0, 'l\'arrêt de carrefour est peuplé');
assert.equal(carrefourStop.hasSpawnedSatellite, true, 'un carrefour n\'essime pas de quartier');
// Fusion réseau : la jonction devient le nœud de l'arrêt, 4 demi-arêtes.
cityA.network = createNetwork(cityA);
assert.ok(cityA.network.nodes.has(carrefourStop.id), 'l\'arrêt de carrefour est un nœud du réseau');
const links = cityA.network.adjacency.get(carrefourStop.id) || [];
assert.ok(links.length >= 3, `l'arrêt de carrefour est raccordé aux deux voiries (${links.length} liens)`);
// Pas d'arrêt de carrefour sur une voie rapide.
const cityHw = {
  stops: [{ id: 'stop-1', x: 100, y: 300 }, { id: 'stop-2', x: 500, y: 300 }],
  roads: [
    { id: 'road-hw', a: 'stop-1', b: 'stop-2', type: 'highway' },
    { id: 'road-d2', start: { x: 200, y: 150 }, end: { x: 400, y: 450 }, type: 'street' }
  ]
};
developCityCarrefours(cityHw, mulberry32(1));
assert.ok(!cityHw.stops.some(s => s.id.startsWith('carrefour-')), 'aucun arrêt sur un croisement de voie rapide');
// Distance minimale respectée entre arrêts.
for (const stop of cityA.stops) {
  for (const other of cityA.stops) {
    if (stop !== other) assert.ok(Math.hypot(stop.x - other.x, stop.y - other.y) >= CARREFOUR_STOP_MIN_GAP - 1,
      'les arrêts de carrefour ne se collent pas');
  }
}

// --- 4. Bâtiments : jamais sur la voirie, jamais superposés -----------------
const city = createCity('V28-CARREFOURS');
developCityCarrefours(city, mulberry32(city.numericSeed ^ 0xCA2E), {}, null, () => {});
const state = createState(city);
state.network = createNetwork(city);
ensureBuildingsState(state);
state.buildingsEnabled = true;
seedInitialZones(state, mulberry32(7), () => {});
spawnInitialBuildings(state, mulberry32(9), () => {});
for (let h = 1; h <= 48; h++) updateBuildings(state, mulberry32(1000 + h), h, log);
assert.ok(state.city.buildings.length >= 3, 'la ville construit des bâtiments');
const segments = [];
{
  const stopsById = new Map(city.stops.map(s => [s.id, s]));
  for (const road of city.roads) {
    const pts = (road.points && road.points.length >= 2) ? road.points
      : (stopsById.get(road.a) && stopsById.get(road.b)
        ? [stopsById.get(road.a), stopsById.get(road.b)] : null);
    if (!pts) continue;
    for (let i = 0; i < pts.length - 1; i++) segments.push({ a: pts[i], b: pts[i + 1], road });
  }
}
for (const b of state.city.buildings) {
  for (const seg of segments) {
    const half = ((ROAD_TYPES[seg.road.type] || {}).width || 8) / 2 + 0.5;
    assert.ok(!segmentIntersectsRect(seg.a, seg.b, {
      x: b.x - half, y: b.y - half, w: b.w + 2 * half, h: b.h + 2 * half
    }), `le bâtiment ${b.id} ne déborde pas sur la voirie`);
  }
  assert.ok(rectClearOfRoads(state, b), `le bâtiment ${b.id} respecte le gabarit de voirie`);
}
for (let i = 0; i < state.city.buildings.length; i++) {
  for (let j = i + 1; j < state.city.buildings.length; j++) {
    assert.ok(!rectsOverlap(state.city.buildings[i], state.city.buildings[j], 1.9),
      'deux bâtiments ne se superposent jamais');
  }
}
// Les montées en densité respectent le même gabarit.
for (const b of state.city.buildings) {
  assert.ok(b.w <= 38 && b.h <= 38, 'footprint de bâtiment borné');
}

// --- 5. Câblage UI ----------------------------------------------------------
const mainjs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const rendererjs = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(mainjs.includes('developCityCarrefours(city,'), 'le boot aménage les carrefours de la ville générée');
assert.ok(mainjs.includes('developCityCarrefours(state.city, rng, { road }'), 'le tracé joueur aménage aussi ses carrefours');
assert.ok(rendererjs.includes('buildingPopAt'), 'les bâtiments ont une animation pop au rendu');
assert.ok(rendererjs.includes('carrefour-'), 'les plaques de carrefour sont dessinées');
assert.ok(rendererjs.includes('easeOutBack'), 'le rebond pop est implémenté');
// V28.2 — l'anti-cache est versionné mais ne fige plus le numéro : chaque
// bump (?v=29, ?v=30…) reste valide tant que les deux assets portent une
// version explicite et identique.
const vMain = (html.match(/src\/main\.js\?v=(\d+)/g) || []).join('');
const vCss = (html.match(/src\/style\.css\?v=(\d+)/g) || []).join('');
assert.ok(vMain.length >= 1 && vCss.length >= 1, 'anti-cache des assets versionné');
assert.ok(new Set([vMain.match(/\d+/)[0], vCss.match(/\d+/)[0]]).size === 1,
  'main.js et style.css partagent le même numéro de version');

console.log(JSON.stringify({
  ok: true,
  bends,
  carrefourStops: cityA.stops.filter(s => s.id.startsWith('carrefour-')).length,
  buildings: state.city.buildings.length,
  stopsOnBoot: city.stops.filter(s => s.id.startsWith('carrefour-')).length
}));
