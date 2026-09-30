import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createNetwork, routeLine } from '../src/network.js';
import { createState } from '../src/state.js';
import { createLine, finishLine, economy, networkFinancials } from '../src/engine.js';
import { updateVehicles, VEHICLE_OPEX_PER_HOUR, FARE_BASE_LEG } from '../src/vehicles.js';

const city = createCity('V4-ECONOMY');
const state = createState(city);
state.network = createNetwork(city);
const log = () => {};
const [a, b, c] = city.stops.slice(0, 3).map(s => s.id);

createLine(state);
state.pendingStops = [a, b, c];
assert.equal(finishLine(state, log, routeLine), true);
const line = state.lines[0];
assert.equal(line.expenses, 0, "une ligne neuve part avec des dépenses à 0");

// --- Revenu par tronçon (y compris correspondance) ------------------------
// Un passager qui a déjà parcouru un premier tronçon sur `line` doit faire
// gagner de l'argent à `line` en arrivant à sa correspondance, pas seulement
// au terminus final d'une autre ligne.
const transferPassenger = {
  id: 999, originId: a, destinationId: c, currentStopId: a, state: 'WAITING',
  // The 2nd leg deliberately references a line that has no vehicle here, so
  // the passenger can't be instantly re-boarded onto the same vehicle —
  // it should genuinely wait at `b` for its (nonexistent, in this focused
  // test) connecting line.
  itinerary: [{ lineId: line.id, from: a, to: b }, { lineId: line.id + 999, from: b, to: c }],
  legIndex: 0, vehicleId: null, createdAt: state.time, waitedMinutes: 0, arrivedAt: null
};
state.passengers.push(transferPassenger);

const vehicle = state.vehicles[0];
const routeIds = line.route.nodeIds;
const beforeB = routeIds.findIndex((id, i) => routeIds[(i + 1) % routeIds.length] === b);
vehicle.onboard.push(transferPassenger.id);
transferPassenger.state = 'ON_VEHICLE';
transferPassenger.vehicleId = vehicle.id;

const incomeBefore = line.income;
vehicle.routeIndex = beforeB; vehicle.progress = 0.99; vehicle.speed = 1;
updateVehicles(state);

assert.equal(transferPassenger.state, 'WAITING', "après le 1er tronçon, le passager attend sa correspondance");
assert.equal(transferPassenger.legIndex, 1);
assert.ok(line.income > incomeBefore, "la ligne doit être payée pour ce tronçon, même sans arrivée finale");
assert.ok(line.income - incomeBefore >= FARE_BASE_LEG, "le tarif perçu doit au moins couvrir la base par tronçon");

// --- Dépenses par ligne, proportionnelles au nombre de véhicules ----------
const hours = 1;
economy(state); // 1 véhicule, congestion neutre (1) par défaut ici -> coût nominal
const cost1 = line.expenses;
assert.ok(cost1 > 0);

state.vehicles.push({ ...vehicle, id: 999999, congestion: 1 });
line.vehicles.push(999999);
economy(state);
const cost2 = line.expenses - cost1;
assert.ok(cost2 > cost1 * 1.5, "2 véhicules doivent coûter sensiblement plus cher qu'1 seul");

// --- Bilan cohérent avec la somme des lignes ------------------------------
const fin = networkFinancials(state);
assert.equal(fin.income, line.income);
assert.equal(fin.expenses, line.expenses);
assert.equal(fin.net, line.income - line.expenses);

console.log(JSON.stringify({
  ok: true,
  transferFare: Number((line.income - incomeBefore).toFixed(2)),
  opexOneVehicle: Number(cost1.toFixed(2)),
  opexTwoVehicles: Number((cost1 + cost2).toFixed(2)),
  financials: { income: Number(fin.income.toFixed(2)), expenses: Number(fin.expenses.toFixed(2)), net: Number(fin.net.toFixed(2)) }
}));
