// V27.1 — ergonomie mobile : la barre flottante ne doit plus être mangée
// par les groupes V27 ni recouverte par le bottom sheet V26 (≤ 700 px),
// et « ✅ Terminer » doit rester atteignable en tête de barre.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

// 1. La barre flottante reste une seule ligne défilante (≤ 959 px).
assert.match(css, /@media \(max-width: 959px\)[\s\S]*?\.floating-toolbar\s*\{[\s\S]*?flex-wrap:\s*nowrap[\s\S]*?overflow-x:\s*auto/, 'la barre flottante est nowrap + défilable');
assert.match(css, /@media \(max-width: 959px\)[\s\S]*?\.tool-group\s*\{[\s\S]*?position:\s*fixed/, 'les groupes deviennent des panneaux contextuels');

// 2. « ✅ Terminer » en tête : jamais hors écran en mode ligne.
assert.match(css, /#finishLineBtn:not\(\[hidden\]\)\s*\{\s*order:\s*-1/, '« Terminer » passe en tête de la barre');

// 3. Sur ≤ 700 px, la barre passe au-dessus du bottom sheet V26.
assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.floating-toolbar\s*\{[\s\S]*?bottom:\s*66px[\s\S]*?z-index:\s*130/, 'la barre flotte au-dessus de la poignée du tableau de bord');

// 4. En-tête allégé : tagline masquée, stats sur une ligne.
assert.match(css, /@media \(max-width: 959px\)[\s\S]*?\.tagline\s*\{\s*display:\s*none/, 'la tagline est masquée sur mobile');
assert.match(css, /@media \(max-width: 959px\)[\s\S]*?\.stats\s*\{[\s\S]*?flex-wrap:\s*nowrap/, 'les statistiques tiennent sur une ligne');

// 5. Non-régression desktop (≥ 960 px) : la media query desktop reste la
//    dernière qui redéfinit .toolbar button (flex 0 0 auto, nowrap).
assert.match(css, /@media \(min-width: 960px\)/, 'le layout desktop ≥ 960 px est intact');

// 6. Équilibre des accolades (le CSS reste parsable).
assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length, 'les accolades du CSS sont équilibrées');

console.log(JSON.stringify({ ok: true, suite: 'v27-mobile-ergonomy' }));

