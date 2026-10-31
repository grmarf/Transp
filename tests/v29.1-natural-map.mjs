// V29.1 — carte naturelle et menu auto-réparant.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const renderer = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');
const mainjs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// 1. Fond de carte : plus d'îlots carrés décoratifs (générés par bruit,
// ils ne correspondaient à rien) ; les parcs organiques restent.
assert.ok(!renderer.includes('type: "block"'), 'plus d\'îlots carrés décoratifs');
assert.ok(renderer.includes('drawOrganicPark'), 'les parcs organiques restent');

// 2. Voiries générées : directes (plus de détours A* en escalier),
// coins arrondis aux angles (plis de carrefour naturels).
assert.ok(!renderer.includes('routeAroundBuildings'), 'plus de détours décoratifs en escalier');
assert.ok(!renderer.includes('urbanObstacles'), 'plus d\'obstacles décoratifs');
assert.ok(renderer.includes('ctx.arcTo('), 'coins de voiries arrondis');

// 3. Menu auto-réparant : barre reconstruite si le shell est périmé,
// boutons historiques réaffichés si l'initialisation échoue.
assert.ok(mainjs.includes('toolbar.className = "floating-toolbar";'),
  'barre flottante reconstruite si absente');
assert.ok(mainjs.includes('boutons historiques réaffichés'),
  'secours si l\'initialisation du menu échoue');

// 4. Anti-cache : les trois références d'assets partagent la même version,
// bumpée à chaque livraison (v30 puis v31).
const versions = [...html.matchAll(/\?v=(\d+)/g)].map((m) => m[1]);
assert.ok(versions.length >= 3, 'références d\'assets versionnées');
assert.equal(new Set(versions).size, 1, 'tous les assets partagent la même version');
assert.ok(Number(versions[0]) >= 31, 'anti-cache bumpé au-delà de v30');

console.log(JSON.stringify({ ok: true, suite: 'v29.1-natural-map', assetVersion: versions[0] }));
