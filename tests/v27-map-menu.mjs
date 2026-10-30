// V27.5 — menu en cascade dans la carte : chaque niveau affiche
// exactement 3 boutons, un clic remplace le trio, ✕ revient à std.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainjs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

// 1. Le conteneur du menu existe dans la barre flottante.
assert.ok(html.includes('id="mapMenu"'), 'conteneur du menu présent dans la barre');

// 2. Extraire la configuration et vérifier le contrat 3 boutons/menu.
const cfgMatch = mainjs.match(/const MAP_MENU = \{[\s\S]*?\n\};/);
assert.ok(cfgMatch, 'MAP_MENU défini dans main.js');
const MAP_MENU = (new Function('return ' + cfgMatch[0].replace('const MAP_MENU = ', '')))();
const levels = Object.keys(MAP_MENU);
assert.ok(levels.includes('std'), 'le niveau std existe');
for (const level of levels) {
  assert.equal(MAP_MENU[level].length, 3, `le menu "${level}" affiche exactement 3 boutons`);
}

// 3. Navigation : chaque goto pointe vers un niveau défini.
for (const level of levels) {
  for (const item of MAP_MENU[level]) {
    if (item.goto) assert.ok(MAP_MENU[item.goto], `navigation "${level} → ${item.goto}" définie`);
  }
}

// 4. Les actions pilotent des contrôles réels du DOM.
for (const level of levels) {
  for (const item of MAP_MENU[level]) {
    if (item.act) assert.ok(html.includes('id="' + item.act + '"'), `cible d'action présente : ${item.act}`);
    if (item.select) {
      assert.ok(html.includes('id="' + item.select + '"'), `select piloté présent : ${item.select}`);
      assert.ok(html.includes('value="' + item.value + '"'), `option ${item.value} disponible dans ${item.select}`);
    }
  }
}

// 5. La croix ramène à std ; les actions reviennent à std.
assert.ok(mainjs.includes('mapMenuLevel !== "std"'), 'la croix n\'apparaît qu\'hors de std');
assert.ok(mainjs.includes('back.textContent = "✕";'), 'bouton croix ✕');
assert.ok(mainjs.includes('bindTap(back, function () { setMapMenu("std"); });'), 'la croix revient à std');
assert.ok(mainjs.includes('setMapMenu("std");'), 'retour à std câblé');
const NL = String.fromCharCode(10);
assert.ok(mainjs.includes('setMapMenu("std");' + NL + '    if (state.pendingRoadPoint)'), 'Échap ramène aussi le menu à std');

// 6. Les contrôles historiques restent branchés (non-régression tests/smock).
for (const id of ['newLineBtn', 'resetZoomBtn', 'voirieBtn', 'urbanismeBtn', 'buildRoadBtn',
  'removeRoadBtn', 'upgradeRoadBtn', 'oneWayRoadBtn', 'undoRoadBtn', 'redoRoadBtn',
  'roadTypeSelect', 'zoneBtn', 'unzoneBtn', 'inspectBtn', 'zoneTypeSelect', 'modeSelect']) {
  assert.ok(html.includes('id="' + id + '"'), `contrôle historique conservé : ${id}`);
}
assert.ok(mainjs.includes('.floating-toolbar > button:not(#finishLineBtn)'), '« Terminer » garde sa visibilité propre');
assert.ok(css.includes('.floating-toolbar [hidden] { display: none !important; }'), 'les contrôles cachés le restent');

console.log(JSON.stringify({ ok: true, suite: 'v27-map-menu', levels: levels.length }));


