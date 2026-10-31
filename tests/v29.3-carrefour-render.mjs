// V29.3 — carrefours lisibles (plaques giratoires aux croisements).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCity, mulberry32 } from '../src/city.js';
import { developCityCarrefours, computeCarrefours } from '../src/carrefours.js';
import { createNetwork, validateNetwork } from '../src/network.js';

const renderer = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// 1. V29.6 — croisements simples : les plaques giratoires systématiques
// (V29.3) rendaient la carte illisible ; elles disparaissent complètement.
assert.ok(!renderer.includes('computeCarrefours'),
  'V29.6 : le renderer ne calcule plus de plaques');
assert.ok(!renderer.includes('ensureCarrefourCrossings'),
  'V29.6 : plus de plaque giratoire dessinée à chaque croisement');
assert.ok(!renderer.includes('Îlot central pointillé'),
  'V29.6 : plus de mini rond-point décoratif');

// 2. Anti-cache bumpé à v32 et homogène.
const versions = [...html.matchAll(/\?v=(\d+)/g)].map((m) => m[1]);
assert.equal(new Set(versions).size, 1, 'tous les assets partagent la même version');
assert.ok(Number(versions[0]) >= 32, 'anti-cache bumpé (v32)');

// 3. Fonctionnel : les croisements existent sur une ville saine.
{
  const city = createCity('V29.3-CARREFOURS');
  developCityCarrefours(city, mulberry32(city.numericSeed ^ 0xCA2E), {}, null, () => {});
  const crossings = computeCarrefours(city);
  assert.ok(Array.isArray(crossings), 'computeCarrefours renvoie une liste');
  const network = createNetwork(city);
  const violations = validateNetwork(network, city, {
    maxEdgeLength: Math.hypot(city.width || 1000, city.height || 650)
  });
  assert.deepStrictEqual(violations, [], 'graphe sain : ' + JSON.stringify(violations));
  console.log(JSON.stringify({ ok: true, suite: 'v29.3-carrefour-render', crossings: crossings.length }));
}

console.log('v29.3-carrefour-render : 3 blocs vérifiés');
