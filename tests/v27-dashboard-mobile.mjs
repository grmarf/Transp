// V27.4 — tableau de bord utilisable sur smartphone : vue plein écran
// dédiée, barre d'outils retirée pendant la consultation, accordéon exclusif.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const mainjs = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// 1. Ouvert = panneau plein écran (dvh + repli vh), pas un coin d'écran.
assert.ok(css.includes('.dashboard.sheet-open {'), "la vue ouverte a ses règles dédiées");
assert.ok(css.includes('height: 100dvh;'), "plein écran en unités dynamiques (barre d'URL)");
assert.ok(css.includes('height: 100vh;'), 'repli vh pour les anciens navigateurs');
assert.ok(css.includes('.dashboard.sheet-open .sheet-handle'), "la poignée devient un en-tête collant");

// 2. La barre flottante ne recouvre plus le panneau ouvert.
assert.ok(css.includes('body.sheet-open .floating-toolbar {'), "la barre est ciblée pendant la consultation");
assert.ok(css.includes('visibility: hidden;') && css.includes('pointer-events: none;'),
  "elle est masquée et non cliquable quand le tableau de bord est ouvert");

// 3. Bascule JS cohérente.
assert.ok(mainjs.includes('document.body.classList.toggle("sheet-open", open);'),
  "le corps porte la classe sheet-open");
assert.ok(html.includes('id="sheetHandleLabel"'), "libellé de poignée isolé");
assert.ok(mainjs.includes('"✕ Fermer"'), 'la poignée propose Fermer quand le panneau est ouvert');

// 4. Accordéon exclusif sur mobile, inchangé sur desktop.
assert.ok(mainjs.includes('window.matchMedia("(max-width: 700px)").matches'),
  "l'exclusivité ne s'applique que sur smartphone");
assert.ok(mainjs.includes('if (other !== tab) other.open = false;'),
  "ouvrir un onglet referme les autres");

// 5. Non-régression : le repli 85vh de V27.2 et lautomatisme V27.2 restent.
assert.ok(css.includes('.dashboard { max-height: 85vh; }'), "la règle V27.2 est intacte");
assert.ok(mainjs.includes('tabs[0].open = true'), "le premier onglet s'ouvre toujours automatiquement");

console.log(JSON.stringify({ ok: true, suite: 'v27-dashboard-mobile' }));



