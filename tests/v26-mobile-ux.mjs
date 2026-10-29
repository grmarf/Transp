// V26 — refonte mobile : panneau coulissant, gestes tactiles et finitions PWA.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main, renderer, css] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/style.css', import.meta.url), 'utf8')
]);

// --- P1 : bottom sheet + cibles tactiles -------------------------------
assert.match(html, /id="sheetHandle"/, 'poignée du panneau coulissant présente');
assert.match(html, /id="dashboardBody"/, 'corps du tableau de bord isolé pour le défilement');
assert.match(html, /aria-controls="dashboardBody"/, 'poignée liée au panneau (aria-controls)');
assert.match(css, /\.sheet-handle/, 'styles de la poignée du panneau');
assert.match(css, /\.dashboard\.sheet-open/, 'état ouvert du panneau coulissant');
assert.match(css, /position:\s*fixed/, 'panneau fixé en bas d\'écran sur mobile');
assert.match(css, /min-height:\s*44px/, 'cibles tactiles d\'au moins 44 px');
assert.match(css, /touch-action:\s*none/, 'la carte doit capter les gestes sans défilement de page');
assert.match(css, /safe-area-inset-bottom/, 'zones sûres (encoche) respectées');
assert.match(css, /prefers-reduced-motion/, 'mouvement réduit honoré');

// --- P2 : gestes ---------------------------------------------------------
assert.match(main, /pinchState/, 'pincement à deux doigts suivi (pinch-zoom)');
assert.match(main, /activePointers/, 'suivi multi-pointeurs pour le pincement');
assert.match(main, /lastTap/, 'double-tap détecté');
assert.match(main, /navigator\.vibrate/, 'retour haptique au doigt');
assert.match(main, /zoomAtScreenPoint/, 'zoom centré sur le point écran (doigt ou molette)');

// --- P3 : DPR plafonné + installation PWA -------------------------------
assert.match(renderer, /Math\.min\(2,\s*window\.devicePixelRatio/,
  'le ratio de pixels du canvas est plafonné à 2');
assert.match(html, /id="installBtn"/, 'bouton d\'installation PWA présent');
assert.match(main, /beforeinstallprompt/, 'bannière d\'installation native branchée');

// --- Invariant v14.2-ui : toujours exactement un appel de rendu direct ---
assert.equal((main.match(/rendererState\.current\.render/g) || []).length, 1,
  'v14.2-ui : un seul appel rendererState.current.render dans main.js');

console.log(JSON.stringify({
  ok: true,
  sheet: true,
  pinch: true,
  doubleTap: true,
  haptics: true,
  dprCap: 2
}));