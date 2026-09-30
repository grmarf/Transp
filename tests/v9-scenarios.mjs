import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createState, INITIAL_MONEY } from '../src/state.js';
import { findScenario, scenarioProgress, evaluateScenario, SCENARIOS } from '../src/scenarios.js';

// --- Rétrocompatibilité : createState(city) seul, inchangé -----------------
const cityPlain = createCity('V9-PLAIN');
const statePlain = createState(cityPlain);
assert.equal(statePlain.money, INITIAL_MONEY);
assert.equal(statePlain.scenario, null);

// --- Un scénario ajuste l'argent de départ ---------------------------------
const crise = findScenario('crise-infrastructure');
const cityCrise = createCity('V9-CRISE');
const stateCrise = createState(cityCrise, crise);
assert.equal(stateCrise.money, crise.startingMoney);
assert.equal(stateCrise.scenario.status, 'active');
assert.equal(stateCrise.scenario.name, crise.name);

// Tous les scénarios du catalogue doivent être trouvables par id.
for (const s of SCENARIOS) assert.equal(findScenario(s.id).id, s.id);
assert.equal(findScenario('inconnu').id, SCENARIOS[0].id, 'id inconnu -> scénario par défaut');

// --- Victoire : objectif "transported" -------------------------------------
const premiersPas = findScenario('premiers-pas');
const s1 = createState(createCity('V9-WIN'), premiersPas);
s1.totalArrived = premiersPas.objective.target;
evaluateScenario(s1, () => {}, { net: 0, currentSatisfaction: 100 });
assert.equal(s1.scenario.status, 'won');
assert.equal(scenarioProgress(s1, { net: 0 }), 1);

// Une fois le statut fixé, une réévaluation ne doit plus rien changer.
s1.totalArrived = 0;
evaluateScenario(s1, () => {}, { net: 0, currentSatisfaction: 100 });
assert.equal(s1.scenario.status, 'won', "le statut d'un scénario terminé ne doit plus bouger");

// --- Échec : délai dépassé (objectif "netBalance") -------------------------
const expansion = findScenario('expansion-express');
const s2 = createState(createCity('V9-LOSE-TIMEOUT'), expansion);
s2.elapsedDays = expansion.durationDays;
evaluateScenario(s2, () => {}, { net: 100, currentSatisfaction: 100 }); // très en dessous de la cible
assert.equal(s2.scenario.status, 'lost');

// --- Échec immédiat : objectif "satisfaction" violé ------------------------
const s3 = createState(createCity('V9-LOSE-SAT'), crise);
evaluateScenario(s3, () => {}, { net: 0, currentSatisfaction: crise.objective.target - 1 });
assert.equal(s3.scenario.status, 'lost');

// --- Bac à sable : pas d'objectif, jamais de statut gagné/perdu ------------
const sandbox = findScenario('sandbox');
const s4 = createState(createCity('V9-SANDBOX'), sandbox);
assert.equal(scenarioProgress(s4, { net: 0 }), null);
s4.elapsedDays = 9999;
evaluateScenario(s4, () => {}, { net: -999999, currentSatisfaction: 0 });
assert.equal(s4.scenario === null || s4.scenario.status === 'active', true);

console.log(JSON.stringify({ ok: true, scenarios: SCENARIOS.length, wonExample: s1.scenario.status, lostTimeout: s2.scenario.status, lostSatisfaction: s3.scenario.status }));
