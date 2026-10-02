import assert from 'node:assert/strict';
import { createCity } from '../src/city.js';
import { createState } from '../src/state.js';
import { createNetwork, routeLine } from '../src/network.js';
import { createLine, finishLine, economy, networkFinancials } from '../src/engine.js';
import { updateVehicles } from '../src/vehicles.js';

const city = createCity('V20-ECONOMY-TELEMETRY');
const state = createState(city);
state.network = createNetwork(city);
const logs = [];
const [a, b] = city.stops.slice(0, 2).map(stop => stop.id);
createLine(state);
state.pendingStops = [a, b];
assert.equal(finishLine(state, logs.push.bind(logs), routeLine, 'bus'), true);
const line = state.lines[0];
const vehicle = state.vehicles[0];
const passenger = { id: 9001, originId: a, destinationId: b, currentStopId: a, state: 'ON_VEHICLE',
  itinerary: [{ lineId: line.id, from: a, to: b }], legIndex: 0, vehicleId: vehicle.id,
  createdAt: state.time, waitedMinutes: 0, arrivedAt: null, transfersDone: 0, travelMinutes: 0 };
state.passengers.push(passenger);
vehicle.onboard.push(passenger.id);
const beforeMoney = state.money;
const routeIndex = line.route.nodeIds.findIndex((id, index) => line.route.nodeIds[(index + 1) % line.route.nodeIds.length] === b);
vehicle.routeIndex = routeIndex;
vehicle.progress = 0.99;
vehicle.speed = 1;
updateVehicles(state, () => 1, logs.push.bind(logs));
assert.equal(passenger.state, 'ARRIVED');
assert.ok(line.income > 0, 'un passager livré doit créditer la ligne');
assert.ok(state.money > beforeMoney, 'un passager livré doit créditer la trésorerie');
assert.ok(logs.some(message => message.includes('passagers')), 'la recette doit être journalisée');
const income = line.income;
economy(state, logs.push.bind(logs));
assert.ok(line.expenses > 0, 'le coût horaire doit être débité');
assert.ok(logs.some(message => message.includes('entretien')), 'le coût doit être journalisé');
const financials = networkFinancials(state);
assert.equal(financials.net, income - line.expenses);
console.log(JSON.stringify({ ok: true, fare: Number(income.toFixed(2)), expenses: Number(line.expenses.toFixed(2)), net: Number(financials.net.toFixed(2)) }));
