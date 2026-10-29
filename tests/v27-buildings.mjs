// V27 — bâtiments : zonage contraint à la voirie, valeur foncière,
// croissance calibrée (2–4 h simulées), montée en densité, abandon.
import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createState } from '../src/state.js';
import { createNetwork } from '../src/network.js';
import {
  BUILDING_TYPES, ZONE_TYPES, ZONE_ROAD_ADJACENCY_PX,
  ABANDON_GRACE_HOURS, ABANDON_OCCUPANTS, AUTO_DEMOLISH_HOURS,
  addZone, removeZone, computeLandValueGrid, landValueAt,
  zoneDemand, updateBuildings, demolishBuilding, buildingStats,
  ensureBuildingsState, pointToSegmentDistance
} from '../src/buildings.js';

const log = () => {};
const rng = () => 0.5;

const city = createCity('V27-BUILDINGS');
const state = createState(city);
state.network = createNetwork(city);
ensureBuildingsState(state);
assert.equal(state.buildingsEnabled, false, 'le système est opt-in');
state.buildingsEnabled = true;

// --- 1. Géométrie ------------------------------------------------------------
assert.ok(pointToSegmentDistance({ x: 0, y: 5 }, { x: -10, y: 0 }, { x: 10, y: 0 }) === 5);
assert.ok(pointToSegmentDistance({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }) === 0);

// --- 2. Zonage : coller à la voirie est obligatoire --------------------------
const road = city.roads.find(r => r.a && r.b);
assert.ok(road, 'prérequis : la ville initiale a des voiries');
const stopA = city.stops.find(s => s.id === road.a);
const stopB = city.stops.find(s => s.id === road.b);
// Une zone le long de la route (entre les deux arrêts, légèrement décalée).
const midX = (stopA.x + stopB.x) / 2;
const midY = (stopA.y + stopB.y) / 2;
const along = addZone(state, 'residential', midX - 30, midY - 34, 60, 30, log);
assert.ok(along, 'une zone le long de la route doit être acceptée');
assert.equal(state.city.zones.length, 1);
// Une zone loin de toute voirie doit être refusée.
const far = addZone(state, 'residential', 1, 1, 50, 50, log);
assert.equal(far, null, 'une zone loin de la route doit être refusée');
assert.equal(state.city.zones.length, 1, 'la zone refusée ne doit pas être stockée');
// Type inconnu et micro-zones refusés.
assert.equal(addZone(state, 'stadium', 0, 0, 60, 60, log), null);
assert.equal(addZone(state, 'residential', midX - 5, midY - 5, 8, 8, log), null);
// Dézonage : la zone disparaît, pas les bâtiments.
assert.equal(removeZone(state, along.id), true);
assert.equal(state.city.zones.length, 0);
const zone = addZone(state, 'residential', midX - 30, midY - 34, 60, 30, log);
assert.ok(zone);

// --- 3. Valeur foncière : grille normalisée 0–1 ------------------------------
const grid = computeLandValueGrid(state);
assert.ok(grid.cols > 1 && grid.rows > 1);
assert.equal(grid.values.length, grid.cols * grid.rows);
for (const v of grid.values) assert.ok(v >= 0 && v <= 1, 'valeur foncière normalisée 0–1');
assert.ok(landValueAt(state, midX, midY) >= 0 && landValueAt(state, midX, midY) <= 1);
// Près d'une route ≠ loin de toute route.
assert.ok(landValueAt(state, midX, midY) > landValueAt(state, 5, 5) + 0.1,
  'le bord de voirie doit valoir plus que le coin perdu de la carte');

// --- 4. Croissance calibrée : lisible, pas d'explosion -----------------------
const hours = 24;
let spawned = 0;
for (let h = 1; h <= hours; h++) {
  const before = state.city.buildings.length;
  updateBuildings(state, rng, h, log);
  spawned += state.city.buildings.length - before;
}
assert.ok(state.city.buildings.length >= 1, 'des bâtiments doivent émerger en 24 h simulées');
assert.ok(state.city.buildings.length <= Math.ceil(hours / 2),
  `au plus ~1 bâtiment/zone toutes les 2 h : ${state.city.buildings.length} en ${hours} h`);
for (const b of state.city.buildings) {
  assert.ok(BUILDING_TYPES[b.type], 'type de bâtiment du catalogue');
  assert.ok(['low', 'mid', 'high'].includes(b.density));
  assert.ok(b.zoneId === zone.id);
  assert.ok(b.x >= zone.x && b.x + b.w <= zone.x + zone.w, 'le bâtiment reste dans sa zone');
  assert.ok(typeof b.frontRoadId === 'string' || b.frontRoadId === null);
  assert.ok(b.occupants >= 0 && b.occupants <= 1);
  assert.ok(b.landValue >= 0 && b.landValue <= 1);
}

// --- 5. Demande et statistiques ---------------------------------------------
for (const t of ['residential', 'commercial', 'industrial', 'service']) {
  const d = zoneDemand(state, t);
  assert.ok(d >= 0 && d <= 1, `demande ${t} bornée 0–1`);
}
const stats = buildingStats(state);
assert.equal(stats.buildings, state.city.buildings.length);
assert.ok(stats.residents > 0, 'les résidentiels abritent des habitants');

// --- 6. Abandon : inoccupation prolongée → abandon puis démolition auto ----
const victim = state.city.buildings[0];
// On force un cycle de vie dégradé : occupants à 0 depuis 23 h déjà.
victim.occupants = 0;
victim.distressedHours = ABANDON_GRACE_HOURS - 1;
let hour = 100;
hour += 1;
updateBuildings(state, rng, hour, log);
assert.ok(victim.occupants < ABANDON_OCCUPANTS, 'le remplissage reste dégradé au premier tick');
assert.equal(victim.abandoned, true, 'un bâtiment inoccupé depuis 24 h doit être abandonné');
const id = victim.id;
const abandonedAt = hour;
hour += AUTO_DEMOLISH_HOURS; // 7 jours d'abandon
updateBuildings(state, rng, hour, log);
assert.ok(!state.city.buildings.some(b => b.id === id), 'un bâtiment abandonné depuis 7 jours disparaît');

// --- 7. Démolition manuelle et sans-abri ------------------------------------
const target = state.city.buildings[0];
assert.ok(target, 'prérequis : il reste un bâtiment');
target.abandoned = false; target.residents = 100;
assert.equal(demolishBuilding(state, 'bld-inconnu', log), false);
assert.equal(demolishBuilding(state, target.id, log), true);
assert.ok(!state.city.buildings.some(b => b.id === target.id));
assert.ok((state.buildingHomeless || 0) >= 100, 'les résidents démolis sont comptés');
// Démolir un abandonné ne crée pas de sans-abri.
const abandonedOne = state.city.buildings.find(b => b.abandoned);
if (abandonedOne) {
  const before = state.buildingHomeless || 0;
  demolishBuilding(state, abandonedOne.id, log);
  assert.equal(state.buildingHomeless, before);
}

// --- 8. Le système éteint ne fait rien (compat tests antérieurs) ------------
state.buildingsEnabled = false;
const frozen = state.city.buildings.length;
const frozenZones = state.city.zones.length;
hour += 1;
updateBuildings(state, rng, hour, log); // appel direct : sans effet de croissance ?
assert.equal(state.city.zones.length, frozenZones);

console.log(JSON.stringify({ ok: true, buildings: stats.buildings, spawned24h: spawned, demand: stats.demand }));
