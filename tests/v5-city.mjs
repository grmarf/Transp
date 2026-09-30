import assert from 'node:assert/strict';
import { createCity, mulberry32 } from '../src/city.js';
import { createState } from '../src/state.js';
import { generateDemand } from '../src/engine.js';

const city = createCity('V5-CITY');

// --- Attributs de ville ----------------------------------------------------
for (const s of city.stops) {
  assert.ok(Number.isFinite(s.population) && s.population > 0, `${s.name}: population manquante`);
  assert.ok(Number.isFinite(s.jobs) && s.jobs > 0, `${s.name}: emplois manquants`);
  assert.ok(Number.isFinite(s.commerce) && s.commerce > 0, `${s.name}: commerces manquants`);
  assert.equal(s.density, Math.round(s.population / 3), 'densité = population / surface fixe du quartier');
}

// Même seed -> même ville (déterminisme, exigence du projet).
const cityAgain = createCity('V5-CITY');
assert.deepEqual(
  city.stops.map(s => [s.population, s.jobs, s.commerce]),
  cityAgain.stops.map(s => [s.population, s.jobs, s.commerce]),
  'une même seed doit reproduire les mêmes population/emplois/commerces'
);

// Le centre-ville / gare (fort en emplois+commerces) doit rester plus
// attractif que les quartiers résidentiels purs, conformément aux archétypes.
const centre = city.stops.find(s => s.name === 'Centre');
const nord = city.stops.find(s => s.name === 'Nord');
assert.ok(centre.jobs > nord.jobs, 'le Centre doit offrir plus d\'emplois qu\'un quartier résidentiel');
assert.ok(nord.population > centre.population, 'un quartier résidentiel doit loger plus d\'habitants que le Centre');

// --- Demande pilotée par population/emplois/commerces, selon l'heure ------
const state = createState(city);

state.time = 8 * 60; // heure de pointe -> l'emploi doit dominer l'attractivité
const rngA = mulberry32(city.numericSeed ^ 0x1);
for (let i = 0; i < 40; i++) generateDemand(state, rngA);
assert.ok(state.passengers.length > 0, 'des trajets doivent être générés en heure de pointe');

// Repartir d'une ville neuve pour une comparaison propre en heure creuse.
const cityOffPeak = createCity('V5-CITY');
const stateOffPeak = createState(cityOffPeak);
stateOffPeak.time = 13 * 60; // heure creuse -> le commerce doit dominer
const rngB = mulberry32(cityOffPeak.numericSeed ^ 0x1);
for (let i = 0; i < 40; i++) generateDemand(stateOffPeak, rngB);
assert.ok(stateOffPeak.passengers.length > 0, 'des trajets doivent aussi être générés en heure creuse');

console.log(JSON.stringify({
  ok: true,
  centre: { population: centre.population, jobs: centre.jobs, commerce: centre.commerce, density: centre.density },
  passengersRush: state.passengers.length,
  passengersOffPeak: stateOffPeak.passengers.length
}));
