// V25 — estimation du coût d'une ligne candidate, panneau Flotte et
// persistance du coût investi (line.costEstimate).
import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createState } from '../src/state.js';
import { createNetwork, routeLine } from '../src/network.js';
import { finishLine, estimateLineCost } from '../src/engine.js';
import { fleetPanelHtml } from '../src/renderer.js';
import { serializeState, validateSavePayload } from '../src/persistence.js';

const city = createCity('v25-fleet-seed');
const state = createState(city, null);
state.network = createNetwork(city);
const [a, b] = city.stops.slice(0, 2).map(s => s.id);

// 1. L'estimation correspond au montant exactement facturé par finishLine.
const estimated = estimateLineCost(state, [a, b], 'bus');
assert.ok(Number.isFinite(estimated) && estimated >= 800,
  "l'estimation inclut la base de 800 €");
const before = state.money;
assert.equal(finishLine(state, () => {}, routeLine, 'bus'), true, 'création de ligne bus');
assert.equal(before - state.money, estimated,
  'le coût facturé par finishLine doit correspondre à l’estimation');
assert.equal(state.lines[0].costEstimate, estimated,
  'la ligne porte son coût investi (costEstimate)');

// 2. L'infrastructure par mode est bien prise en compte : métro > tram > bus.
const state2 = createState(city, null);
state2.network = state.network;
const bus = estimateLineCost(state2, [a, b], 'bus');
const tram = estimateLineCost(state2, [a, b], 'tram');
const metro = estimateLineCost(state2, [a, b], 'metro');
assert.ok(bus < tram && tram < metro,
  `bus (${bus}) < tram (${tram}) < métro (${metro}) attendus`);

// 3. Sans réseau disponible, l'estimation retombe sur les distances directes.
const bare = createState(city, null);
const fallback = estimateLineCost(bare, [a, b], 'bus');
assert.ok(Number.isFinite(fallback) && fallback >= 800,
  'l’estimation sans réseau reste une valeur exploitable');

// 4. Panneau Flotte : vide, puis renseigné, puis véhicule en panne.
const emptyHtml = fleetPanelHtml(createState(city, null));
assert.match(emptyHtml, /Aucun véhicule/, 'panneau vide explicité');
const html = fleetPanelHtml(state);
assert.ok(html.includes('Ligne 1'), 'le panneau rattache le véhicule à sa ligne');
assert.match(html, /0\/35/, 'occupation instantanée affichée');
assert.match(html, /En service/, 'état nominal affiché');
state.vehicles[0].brokenTicksLeft = 5;
const brokenHtml = fleetPanelHtml(state);
assert.match(brokenHtml, /En panne/, 'panne signalée dans le panneau');
assert.match(brokenHtml, /1 en panne/, 'résumé de flotte avec compte de pannes');
state.vehicles[0].brokenTicksLeft = 0;

// 5. Persistance : costEstimate survit à un aller-retour et reste validé.
const payload = serializeState(state);
const round = validateSavePayload(JSON.parse(JSON.stringify(payload)));
assert.equal(round.state.lines[0].costEstimate, estimated,
  'costEstimate conservé par la sauvegarde');
const tampered = JSON.parse(JSON.stringify(payload));
tampered.state.lines[0].costEstimate = -5;
assert.throws(() => validateSavePayload(tampered), /costEstimate/,
  'un costEstimate invalide doit être rejeté');

console.log(JSON.stringify({
  ok: true,
  estimatedCost: estimated,
  costs: { bus, tram, metro },
  vehicles: state.vehicles.length
}));
