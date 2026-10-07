import assert from 'node:assert/strict';
import {
  createCity,
  addSatelliteStop,
  mulberry32,
  STOP_NAME_CATALOG_SIZE,
  DISTRICT_NAME_CATALOG_SIZE
} from '../src/city.js';
import { createNetwork } from '../src/network.js';

assert.ok(STOP_NAME_CATALOG_SIZE >= 900, 'le catalogue des arrêts doit être au moins 30 fois plus grand');
assert.ok(DISTRICT_NAME_CATALOG_SIZE >= 360, 'le catalogue des quartiers doit être au moins 30 fois plus grand');

for (let i = 0; i < 20; i++) {
  const city = createCity(`V24-NAMES-${i}`);
  const degree = new Map(city.stops.map(stop => [stop.id, 0]));
  for (const road of city.roads) {
    if (road.a) degree.set(road.a, (degree.get(road.a) || 0) + 1);
    if (road.b) degree.set(road.b, (degree.get(road.b) || 0) + 1);
  }
  assert.ok([...degree.values()].every(value => value <= 3), 'une carte initiale dépasse trois routes à un arrêt');
  const network = createNetwork(city);
  assert.ok([...network.adjacency.values()].every(links => links.length <= 3), 'le réseau reconstruit dépasse trois routes à un arrêt');
  assert.match(city.name, /^Ville /);
  assert.equal(/\d{6,}/.test(city.name), false, 'le seed ne doit plus être injecté dans le nom de ville');
}

const city = createCity('V24-GROWTH');
const rng = mulberry32(city.numericSeed);
for (let i = 0; i < 8; i++) {
  const parent = city.stops[i % city.stops.length];
  parent.population = 10000;
  const stop = addSatelliteStop(city, parent, rng);
  const degree = new Map(city.stops.map(item => [item.id, 0]));
  for (const road of city.roads) {
    if (road.a) degree.set(road.a, (degree.get(road.a) || 0) + 1);
    if (road.b) degree.set(road.b, (degree.get(road.b) || 0) + 1);
  }
  assert.ok([...degree.values()].every(value => value <= 3), `la croissance dépasse trois routes après ${stop.id}`);
}

console.log(JSON.stringify({
  ok: true,
  stopNameCatalog: STOP_NAME_CATALOG_SIZE,
  districtNameCatalog: DISTRICT_NAME_CATALOG_SIZE,
  checkedMaps: 20,
  checkedSatellites: 8
}));
