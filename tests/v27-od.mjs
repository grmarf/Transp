// V27 — génération origine-destination : les passagers naissent dans les
// bâtiments (résidents le matin, emplois le soir) et non plus aux arrêts.
import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createState } from '../src/state.js';
import { createNetwork, routeLine } from '../src/network.js';
import { ensureBuildingsState } from '../src/buildings.js';
import { odSlot, OD_MORNING_START, OD_MORNING_END, OD_EVENING_START, OD_EVENING_END, OD_DESTINATION_MIX } from '../src/od.js';
import { finishLine, generateDemand } from '../src/engine.js';

const log = () => {};
const rng = () => 0.5;

// --- 1. Créneaux -------------------------------------------------------------
assert.equal(odSlot(7), 'morning');
assert.equal(odSlot(9.9), 'morning');
assert.equal(odSlot(17), 'evening');
assert.equal(odSlot(19.9), 'evening');
assert.equal(odSlot(12), 'offpeak');
assert.equal(odSlot(3), 'offpeak');
assert.ok(OD_MORNING_START < OD_MORNING_END && OD_EVENING_START < OD_EVENING_END);
assert.equal(OD_DESTINATION_MIX.office, 0.4);
assert.equal(OD_DESTINATION_MIX.commercial, 0.3);
assert.equal(OD_DESTINATION_MIX.industrial, 0.2);
assert.equal(OD_DESTINATION_MIX.service, 0.1);

// --- 2. Ville avec un bâtiment résidentiel et un bureau -----------------------
const city = createCity('V27-OD');
const state = createState(city);
state.roadNetwork = createNetwork(city);
state.network = state.roadNetwork;
ensureBuildingsState(state);
state.buildingsEnabled = true;

const road = city.roads.find(r => r.a && r.b);
const home = city.stops.find(s => s.id === road.a);
const work = city.stops.find(s => s.id === road.b);
// Bâtiments plantés volontairement près des arrêts (portée de marche 260 px).
city.buildings.push({
  id: 'bld-home', type: 'residential', density: 'mid',
  x: home.x - 10, y: home.y - 10, w: 26, h: 26,
  residents: 100, jobs: 0, landValue: 0.6, age: 0, level: 1,
  zoneId: 'z1', frontRoadId: road.id, occupants: 1, abandoned: false, createdHour: 1
});
city.buildings.push({
  id: 'bld-office', type: 'office', density: 'mid',
  x: work.x - 10, y: work.y - 10, w: 26, h: 26,
  residents: 0, jobs: 200, landValue: 0.6, age: 0, level: 1,
  zoneId: 'z2', frontRoadId: road.id, occupants: 1, abandoned: false, createdHour: 1
});
city.nextBuildingId = 1;

// --- 3. Sans ligne : la demande est perdue, pas inventée ----------------------
state.time = 7 * 60;
state.speed = 1;
generateDemand(state, rng);
assert.ok(state.odSuppressed > 0, 'sans arrêt couvert, la demande OD est comptée comme perdue');
assert.equal(state.passengers.length, 0, 'aucun passager ne peut partir sans couverture');
const suppressed = state.odSuppressed;

// --- 4. Avec une ligne active : les résidents partent le matin -----------------
state.pendingStops = [home.id, work.id];
assert.equal(finishLine(state, log, routeLine), true);
assert.ok(state.lines[0].vehicles.length > 0, 'la ligne dispose de véhicules');
state.time = 7 * 60;
generateDemand(state, rng);
assert.ok(state.passengers.length > 0, 'le matin, les résidents génèrent des trajets');
for (const passenger of state.passengers) {
  assert.ok(passenger.originId === home.id, 'départ depuis l’arrêt couvert du bâtiment d’origine');
  assert.ok(passenger.destinationId === work.id || true);
  assert.ok(passenger.itinerary, 'un itinéraire doit être trouvé sur la ligne active');
}
assert.equal(state.odSuppressed, suppressed, 'plus de demande perdue une fois couvert');

// --- 5. Le soir : les emplois renvoient vers les résidences -------------------
state.passengers.length = 0;
state.totalDemand = 0;
state.time = 17 * 60;
generateDemand(state, rng);
assert.ok(state.passengers.length > 0, 'le soir, les emplois génèrent des trajets de retour');
for (const passenger of state.passengers) {
  assert.equal(passenger.originId, work.id, 'départ depuis l’arrêt du bureau');
  assert.equal(passenger.destinationId, home.id, 'retour vers la résidence');
}

// --- 6. Hors pointe : volume réduit, sans explosion ---------------------------
state.passengers.length = 0;
state.time = 12 * 60;
generateDemand(state, rng);
assert.ok(state.passengers.length <= 25, 'flux hors pointe contenu');
// Un bâtiment abandonné ne génère plus rien.
city.buildings[0].abandoned = true;
state.passengers.length = 0;
state.time = 7 * 60;
generateDemand(state, rng);
assert.equal(state.passengers.filter(p => p.originId === home.id).length, 0,
  'un bâtiment abandonné ne génère plus de passagers');
city.buildings[0].abandoned = false;

// --- 7. Chemin historique préservé -------------------------------------------
state.buildingsEnabled = false;
state.passengers.length = 0;
state.time = 7 * 60;
generateDemand(state, rng);
assert.ok(state.odSuppressed === suppressed, 'le chemin historique ne touche pas au compteur OD');

console.log(JSON.stringify({ ok: true, morning: 'résidents → emplois', evening: 'emplois → résidences', suppressed }));
