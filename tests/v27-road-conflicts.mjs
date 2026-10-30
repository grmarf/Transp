// V27.3 — dette §7 : collision bâtiment↔route au tracé, expropriation des
// ruines, et congestion pondérée par la capacité de la voirie.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCity } from '../src/city.js';
import { createState } from '../src/state.js';
import { createNetwork } from '../src/network.js';
import { ensureBuildingsState } from '../src/buildings.js';
import {
  segmentIntersectsRect, traceBlockedBuildings, expropriateAbandonedAlongTrace
} from '../src/buildings.js';
import { congestionFactor } from '../src/vehicles.js';

// --- 1. Géométrie segment/rectangle ------------------------------------------
const rect = { x: 100, y: 100, w: 60, h: 40 };
assert.equal(segmentIntersectsRect({ x: 0, y: 120 }, { x: 300, y: 120 }, rect), true,
  'un segment qui traverse le rectangle le détecte');
assert.equal(segmentIntersectsRect({ x: 0, y: 60 }, { x: 300, y: 60 }, rect), false,
  'un segment qui passe à côté ne touche pas');
assert.equal(segmentIntersectsRect({ x: 120, y: 115 }, { x: 130, y: 125 }, rect), true,
  'une extrémité intérieure compte comme collision');
assert.equal(segmentIntersectsRect({ x: 90, y: 90 }, { x: 115, y: 115 }, rect), true,
  'franchir un coin du rectangle compte');
assert.equal(segmentIntersectsRect({ x: 80, y: 105 }, { x: 95, y: 135 }, rect), false,
  'un segment qui frôle sans entrer ne bloque pas');

// --- 2. Collision au tracé ----------------------------------------------------
const city = createCity('V27-CONFLICTS');
const state = createState(city);
state.network = createNetwork(city);
ensureBuildingsState(state);
state.buildingsEnabled = true;
const victim = { id: 'bld-block', type: 'residential', density: 'low',
  x: 200, y: 200, w: 40, h: 30, residents: 50, jobs: 0, landValue: 0.5,
  age: 1, level: 1, zoneId: 'z', frontRoadId: null, occupants: 1,
  abandoned: false, createdHour: 1 };
const ruin = { ...victim, id: 'bld-ruin', x: 400, y: 200, residents: 0, jobs: 0, abandoned: true, occupants: 0 };
city.buildings.push(victim, ruin);
const through = { a: { x: 100, y: 215 }, b: { x: 500, y: 215 } };
const blocked = traceBlockedBuildings(state, through.a, through.b);
assert.equal(blocked.length, 1, 'le bâtiment occupé bloque le tracé');
assert.equal(blocked[0].id, 'bld-block');
const beside = traceBlockedBuildings(state, { x: 100, y: 100 }, { x: 500, y: 100 });
assert.equal(beside.length, 0, 'aucun blocage hors trajectoire');

// --- 3. Expropriation des ruines ----------------------------------------------
const homelessBefore = state.buildingHomeless || 0;
const expropriated = expropriateAbandonedAlongTrace(state, through.a, through.b, () => {});
assert.equal(expropriated, 1, 'la ruine abandonnée est expropriée');
assert.ok(!city.buildings.some(b => b.id === 'bld-ruin'), 'la ruine disparaît');
assert.equal(state.buildingHomeless, homelessBefore, 'exproprier une ruine ne crée pas de sans-abri');
assert.ok(city.buildings.some(b => b.id === 'bld-block'), "le bâtiment occupé survit à l'expropriation");
// Idempotence : plus rien à exproprier sur ce tracé.
assert.equal(expropriateAbandonedAlongTrace(state, through.a, through.b, () => {}), 0);

// --- 4. Congestion pondérée par la capacité de voirie --------------------------
const street = congestionFactor(5, 400);
const highway = congestionFactor(5, 2000);
assert.ok(street < highway, 'une voie rapide sature moins vite qu\'une rue à trafic égal');
assert.ok(Math.abs(street - 1 / (1 + 4 * 0.18)) < 1e-12, 'la rue reste la référence historique');
assert.ok(highway <= 1 && street > 0, 'congestion bornée ]0, 1]');
// Sans capacité renseignée : comportement historique (rue).
assert.equal(congestionFactor(5), street, 'capacité absente = référence rue');

// --- 5. Câblage UI : le tracé joueur vérifie la collision ----------------------
const mainjs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert.ok(mainjs.includes('traceBlockedBuildings(state, start, end)'), 'le tracé joueur contrôle la collision');
assert.ok(mainjs.includes('expropriateAbandonedAlongTrace(state, start, end, log);'), 'les ruines sont expropriées au commit');
assert.ok(mainjs.includes('Tracé impossible : il traverse'), 'le refus est expliqué au joueur');

console.log(JSON.stringify({ ok: true, blocked: blocked.length, expropriated, street: Number(street.toFixed(3)), highway: Number(highway.toFixed(3)) }));


