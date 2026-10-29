// V27.1 — ergonomie mobile : la barre flottante ne doit plus etre
// mangee par les groupes V27 ni recouverte par le bottom sheet V26 (<= 700 px),
// et le bouton Terminer doit rester atteignable en tete de barre.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

// 1. La barre flottante reste une seule ligne defilante (<= 959 px).
assert.ok(css.includes('@media (max-width: 959px)'), 'la media query mobile existe');
assert.ok(css.includes('flex-wrap: nowrap;') && css.includes('overflow-x: auto;'), 'la barre flottante est nowrap + defilable');
assert.ok(css.includes('.floating-toolbar .tool-group {') && css.includes('position: fixed;'), 'les groupes deviennent des panneaux contextuels fixes');

// 2. « Terminer » en tete : jamais hors ecran en mode ligne.
assert.ok(css.includes('#finishLineBtn:not([hidden]) { order: -1; }'), 'le bouton Terminer passe en tete de la barre');

// 3. Sur <= 700 px, la barre passe au-dessus du bottom sheet V26.
assert.ok(css.includes('@media (max-width: 700px)'), 'la media query du bottom sheet existe');
assert.ok(css.includes('.floating-toolbar { bottom: 66px; z-index: 130; }'), 'la barre flotte au-dessus de la poignee du tableau de bord');

// 4. En-tete allegre : tagline masquee, stats sur une ligne.
assert.ok(css.includes('.tagline { display: none; }'), 'la tagline est masquee sur mobile');
assert.ok(css.includes('.stats {') && css.includes('.stat-chip { flex: 0 0 auto; }'), 'les statistiques tiennent sur une ligne defilante');

// 5. Non-regression desktop (>= 960 px) et regles historiques.
assert.ok(css.includes('@media (min-width: 960px)'), 'le layout desktop >= 960 px est intact');
assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length, 'les accolades du CSS sont equilibrees');
assert.ok(css.includes('#toggleHeatmapBtn[aria-pressed="true"]'), 'la regle heatmap v14.2 est intacte');
assert.ok(css.includes('.building-panel'), 'les styles du panneau bâtiment V27 sont intacts');

console.log(JSON.stringify({ ok: true, suite: 'v27-mobile-ergonomy' }));

