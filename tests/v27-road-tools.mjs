// V27 — outils joueur de voirie : tracé multi-points, démolition avec
// remboursement, amélioration, sens unique, undo/redo. Vérification
// statique du câblage UI (index.html) et de la logique (main.js).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main, renderer] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer.js', import.meta.url), 'utf8')
]);

// --- 1. Barre d'outils voirie ----------------------------------------------
for (const id of ['buildRoadBtn', 'removeRoadBtn', 'upgradeRoadBtn', 'oneWayRoadBtn', 'undoRoadBtn', 'redoRoadBtn', 'roadTypeSelect']) {
  assert.match(html, new RegExp(`id="${id}"`), `id manquant dans la barre d'outils : ${id}`);
}
// Le sélecteur de type expose les 4 types V27 et plus les alias historiques.
for (const type of ['street', 'avenue', 'boulevard', 'highway']) {
  assert.match(html, new RegExp(`value="${type}"`), `type de route absent du select : ${type}`);
}
assert.ok(!/value="local"|value="secondary"|value="arterial"/.test(html),
  'les alias historiques ne doivent plus être proposés au joueur');

// --- 2. Outil de tracé multi-points ------------------------------------------
assert.ok(main.includes('function snappedTracePoint('), 'le snapping doit être factorisé');
assert.match(main, /snappedTracePoint\(p,\s*anchor,\s*e\)/, 'le clic de tracé passe par le snapping');
assert.ok(main.includes('Math.PI / 4'), 'le snap Shift doit contraindre à des multiples de 45°');
assert.ok(main.includes('points: [{ x: start.x, y: start.y }, { x: end.x, y: end.y }]'),
  'chaque segment construit porte sa polyline explicite');
assert.ok(main.includes('roadConstructionCost('), 'le coût passe par roadConstructionCost');
assert.ok(main.includes('state.pendingRoadPoint = end;'),
  'le tracé enchaîne depuis le point posé (commit immédiat par segment)');
assert.ok(main.includes('function endRoadTrace()'), 'terminaison du tracé factorisée');

// --- 3. Clavier / souris -----------------------------------------------------
assert.ok(main.includes('e.key === "Escape"'), 'Échap annule le tracé en cours');
assert.ok(main.includes('e.key === "Enter"'), 'Entrée termine le tracé');
assert.ok(main.includes('dblclick'), 'le double-clic termine le tracé');

// --- 4. Démolition / amélioration / sens unique ------------------------------
assert.ok(main.includes('Math.round((nearestRoad.cost || 0) * 0.3)'), 'remboursement de 30 % à la démolition');
assert.ok(main.includes('state.roadEditMode === "upgrade"'), 'mode amélioration');
assert.ok(main.includes('state.roadEditMode === "oneWay"'), 'mode sens unique');
assert.ok(main.includes('costPerPixel - roadType(fromType).costPerPixel'),
  'le coût d\'amélioration est la différence de coût au pixel');

// --- 5. Undo / redo ----------------------------------------------------------
assert.ok(main.includes('function undoRoadAction()'), 'undo');
assert.ok(main.includes('function redoRoadAction()'), 'redo');
assert.ok(main.includes('const ROAD_UNDO_MAX = 20'), 'pile d\'annulation d\'au moins 10 niveaux');
assert.ok(main.includes('state.roadRedoStack = [];'), 'une nouvelle action vide le redo');

// --- 6. Aperçu rendu ---------------------------------------------------------
assert.ok(renderer.includes('state.roadTrace'), 'le rendu consomme l\'aperçu de tracé');
assert.ok(renderer.includes('budget insuffisant'), 'l\'aperçu signale un budget insuffisant');
assert.ok(renderer.includes('road.points.length >= 2'), 'les routes-joueur à polyline sont dessinées telles quelles');

// --- 7. Invariants historiques ----------------------------------------------
assert.equal((main.match(/rendererState\.current\.render/g) || []).length, 1,
  'exactement un appel de rendu par frame reste requis');

console.log(JSON.stringify({ ok: true, tools: ['build', 'remove', 'upgrade', 'oneWay', 'undo', 'redo'] }));
