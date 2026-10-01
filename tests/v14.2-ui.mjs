import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, main, renderer, css, pkg] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/renderer.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/style.css', import.meta.url), 'utf8'),
  readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse)
]);

for (const id of ['map', 'toggleHeatmapBtn', 'heatmapLegend', 'intermodalStats', 'journal', 'financialChart', 'exportBtn', 'importFile']) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing UI id: ${id}`);
}
assert.match(html, /id="toggleHeatmapBtn"[^>]*aria-pressed="false"/);
assert.match(html, /canvas id="map"[^>]*aria-label=/);
assert.match(main, /function refreshUI\(\)/);
assert.equal((main.match(/rendererState\.current\.render/g) || []).length, 1);
assert.match(main, /setAttribute\("aria-pressed", String\(state\.showHeatmap\)\)/);
assert.match(renderer, /function render\(options = \{\}\)/);
assert.match(renderer, /heatmapLegend\.hidden = !active/);
assert.match(css, /#toggleHeatmapBtn\[aria-pressed="true"\]/);
assert.match(pkg.version, /^19\./);

console.log(JSON.stringify({ ok: true, version: pkg.version, checkedIds: 8 }));
