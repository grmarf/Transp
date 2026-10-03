import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createState } from '../src/state.js';
import { createNetwork, routeLine } from '../src/network.js';
import { createLine, finishLine, dailyStaffCost, satisfaction, wageSatisfactionDelta } from '../src/engine.js';
import { CAMPAIGNS, activeCampaigns, campaignDemandMultiplier, finishExpiredCampaigns, startCampaign } from '../src/advertising.js';

const city = createCity('V22-ECONOMY');
const state = createState(city);
state.network = createNetwork(city);
state.advertisingEnabled = true;

// Campagnes : lancement, coût, multiplicateur, unicité.
assert.equal(campaignDemandMultiplier(state), 1, 'aucune campagne → pas de boost');
const moneyBefore = state.money;
const campaign = startCampaign(state, 'city', () => {});
assert.ok(campaign, 'campagne citadine lancée');
assert.equal(state.money, moneyBefore - CAMPAIGNS.city.cost, 'la campagne est débitée');
assert.ok(Math.abs(campaignDemandMultiplier(state) - 1.3) < 1e-9, 'demande ×1,30 pendant la campagne');
assert.equal(activeCampaigns(state).length, 1);
assert.equal(startCampaign(state, 'local', () => {}), null, 'une seule campagne à la fois');

// Expiration : fin, historique et cooldown.
state.elapsedDays = CAMPAIGNS.city.durationDays + 1;
const logs = [];
assert.equal(finishExpiredCampaigns(state, logs.push.bind(logs)), 1);
assert.equal(activeCampaigns(state).length, 0);
assert.equal(logs.length, 1, 'la fin de campagne est journalisée');
assert.ok(state.campaignCooldownUntil > state.elapsedDays, 'cooldown après expiration');
assert.equal(campaignDemandMultiplier(state), 1, 'retour à la normale après expiration');
assert.equal(state.campaignHistory.length, 1, 'la campagne expirée entre dans l\'historique');

// Salaires : coût quotidien de personnel proportionnel au niveau salarial.
const [a, b] = city.stops.slice(0, 2).map(s => s.id);
createLine(state);
state.pendingStops = [a, b];
assert.equal(finishLine(state, () => {}, routeLine, 'bus'), true);
const base = dailyStaffCost({ ...state, wageLevel: 1 });
assert.ok(base > 0, 'un véhicule actif coûte du personnel');
assert.ok(Math.abs(dailyStaffCost({ ...state, wageLevel: 1.2 }) - base * 1.2) < 1e-9, 'salaires ×1,2 = coût ×1,2');
assert.ok(Math.abs(dailyStaffCost({ ...state, wageLevel: 0.8 }) - base * 0.8) < 1e-9, 'salaires ×0,8 = coût ×0,8');

// Satisfaction : les salaires pèsent jusqu'à ±5 points.
assert.equal(wageSatisfactionDelta({ wageLevel: 1 }), 0);
assert.equal(wageSatisfactionDelta({ wageLevel: 0.8 }), -5);
assert.equal(wageSatisfactionDelta({ wageLevel: 1.2 }), 5);
const neutral = satisfaction(state);
state.wageLevel = 0.8;
assert.ok(satisfaction(state) < neutral, 'salaires bas → satisfaction en baisse');

console.log(JSON.stringify({ ok: true, staffCost: Math.round(base), campaigns: Object.keys(CAMPAIGNS).length }));
