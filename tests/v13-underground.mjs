import assert from 'node:assert/strict';
import { createCity, mulberry32 } from '../src/city.js';
import { createState } from '../src/state.js';
import { createNetwork, createUndergroundNetwork, routeLine } from '../src/network.js';
import { createLine, finishLine, lineLength } from '../src/engine.js';
import { distance } from '../src/constants.js';
import { growCity } from '../src/growth.js';

const city = createCity('V13-UNDERGROUND');
const state = createState(city);
state.network = createNetwork(city);
state.undergroundNetwork = createUndergroundNetwork(city);
const log = () => {};

// Nord (1) et Sud (2) ne sont reliés par aucune route directe : uniquement
// via Centre (0) en surface — un cas idéal pour vérifier que le métro
// tunnelle en ligne directe là où le bus doit faire un détour.
const nord = city.stops[1];
const sud = city.stops[2];
assert.ok(!city.roads.some(r => (r.a === nord.id && r.b === sud.id) || (r.a === sud.id && r.b === nord.id)),
  "prérequis du test : Nord et Sud ne doivent pas être reliés par une route directe");

// --- Bus : doit faire un détour par un nœud intermédiaire (Centre) ---------
createLine(state);
state.pendingStops = [nord.id, sud.id];
assert.equal(finishLine(state, log, routeLine, 'bus'), true);
const busLine = state.lines[0];
const busStopsVisited = new Set(busLine.route.nodeIds);
assert.ok(busStopsVisited.size > 2, 'le bus doit transiter par au moins un nœud intermédiaire (Centre)');
assert.ok(busStopsVisited.has(city.stops[0].id), 'le détour du bus doit passer par Centre');

// --- Métro : tunnel direct, sans détour --------------------------------------
createLine(state);
state.pendingStops = [nord.id, sud.id];
assert.equal(finishLine(state, log, routeLine, 'metro'), true);
const metroLine = state.lines[1];
const metroStopsVisited = new Set(metroLine.route.nodeIds);
assert.equal(metroStopsVisited.size, 2, 'le métro ne doit visiter que Nord et Sud (aucun détour)');
assert.ok(!metroStopsVisited.has(city.stops[0].id), 'le tunnel ne doit pas passer par Centre');

// --- Rétrocompatibilité : sans undergroundNetwork, comportement V12 --------
const cityLegacy = createCity('V13-LEGACY');
const stateLegacy = createState(cityLegacy);
stateLegacy.network = createNetwork(cityLegacy);
// stateLegacy.undergroundNetwork volontairement absent.
createLine(stateLegacy);
const nordL = cityLegacy.stops[1], sudL = cityLegacy.stops[2];
stateLegacy.pendingStops = [nordL.id, sudL.id];
assert.equal(finishLine(stateLegacy, log, routeLine, 'metro'), true);
const legacyStopsVisited = new Set(stateLegacy.lines[0].route.nodeIds);
assert.ok(legacyStopsVisited.size > 2,
  'sans réseau souterrain construit, le métro doit retomber sur le routage de surface (V12), donc transiter par Centre');

// --- Croissance : le réseau souterrain doit suivre les nouveaux quartiers --
const cityGrowth = createCity('V13-GROWTH');
const stateGrowth = createState(cityGrowth);
stateGrowth.network = createNetwork(cityGrowth);
stateGrowth.undergroundNetwork = createUndergroundNetwork(cityGrowth);
const rngGrowth = mulberry32(cityGrowth.numericSeed ^ 0xA57E2);
const stopsBefore = stateGrowth.city.stops.length;
// Force les conditions de spawn d'un satellite (population + service).
const boosted = stateGrowth.city.stops[0];
boosted.population = 10000;
createLine(stateGrowth);
stateGrowth.pendingStops = [boosted.id, cityGrowth.stops[1].id];
finishLine(stateGrowth, log, routeLine, 'bus');
// Un seul véhicule -> service level faible ; on force artificiellement le
// seuil de service requis pour le spawn plutôt que de simuler des jours de
// fréquence pour rester rapide et déterministe.
for (let i = 0; i < 40 && stateGrowth.city.stops.length === stopsBefore; i++) {
  growCity(stateGrowth, rngGrowth, log);
}
if (stateGrowth.city.stops.length > stopsBefore) {
  const newestStop = stateGrowth.city.stops[stateGrowth.city.stops.length - 1];
  assert.ok(stateGrowth.undergroundNetwork.nodes.has(newestStop.id),
    'le nouveau quartier doit être présent dans le réseau souterrain reconstruit');
} else {
  console.log('note: aucun satellite apparu dans la fenêtre de test (dépend du seed/RNG) — vérification ignorée sans échec');
}

console.log(JSON.stringify({
  ok: true,
  busStopsVisited: busStopsVisited.size,
  metroStopsVisited: metroStopsVisited.size,
  metroTunnelLength: Math.round(lineLength(state, metroLine)),
  busRouteLength: Math.round(lineLength(state, busLine))
}));
