// V27 · Bâtiments & urbanisme — UI / HUD (statique, Node pur).
// Vérifie que la phase 9 (UI : zonage, inspection, overlays, demande)
// est bien branchée sans casser les invariants des tests antérieurs.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const html = read("index.html");
const mainJs = read("src/main.js");
const rendererJs = read("src/renderer.js");
const css = read("src/style.css");
const pkg = JSON.parse(read("package.json"));

let failures = 0;
function check(label, ok) {
  console.log((ok ? "  ✅ " : "  ❌ ") + label);
  if (!ok) failures += 1;
}

// ── 1 · Nouveaux contrôles UI présents ─────────────────────────────────
const ids = [
  "urbanismeBtn", "urbanismeGroup", "zoneBtn", "unzoneBtn", "inspectBtn",
  "zoneTypeSelect", "toggleLandValueBtn", "toggleZonesBtn",
  "demandBars", "buildingPanel"
];
for (const id of ids) check("index.html contient #" + id, html.includes('id="' + id + '"'));

check("zoneTypeSelect propose les 4 types de zone",
  ["residential", "commercial", "industrial", "service"]
    .every((t) => html.includes('value="' + t + '"')));
check("buildingPanel est caché par défaut", /<div id="buildingPanel"[^>]*hidden/.test(html));

// ── 2 · Branchement main.js ────────────────────────────────────────────
check("main.js importe buildings.js", /from "\.\/buildings\.js"/.test(mainJs));
check("boot active buildingsEnabled", /state\.buildingsEnabled = true/.test(mainJs));
check("boot appelle ensureBuildingsState(state)", /ensureBuildingsState\(state\)/.test(mainJs));
check("clickMap gère le mode zone", /zoneMode === "zone"/.test(mainJs));
check("clickMap gère le dézonage", /zoneMode === "unzone"/.test(mainJs));
check("clickMap gère l'inspection", /zoneMode === "inspect"/.test(mainJs));
check("Échap quitte le mode urbanisme", /zoneMode = null/.test(mainJs));
check("panneau bâtiment avec démolition", /data-building-demolish/.test(mainJs));
check("barres de demande mises à jour dans refreshUI", /updateDemandBars\(\)/.test(mainJs));

// Invariant v14.2-ui : exactement un appel de rendu par frame dans main.js.
const renderCalls = mainJs.match(/rendererState\.current\.render/g) || [];
check("exactement 1 rendererState.current.render dans main.js", renderCalls.length === 1);

// ── 3 · Rendu Canvas ───────────────────────────────────────────────────
check("renderer dessine la heatmap de valeur foncière", /state\.showLandValue/.test(rendererJs));
check("renderer dessine les zones", /state\.showZones \|\| state\.zoneMode/.test(rendererJs));
check("renderer dessine les bâtiments abandonnés en grisé", /abandoned/.test(rendererJs));
check("renderer surligne le bâtiment sélectionné", /selectedBuildingId/.test(rendererJs));

// ── 4 · Styles ─────────────────────────────────────────────────────────
for (const cls of [".building-panel", ".building-panel-head", ".building-panel-stats",
  ".building-panel-close", ".building-panel-warn", ".demand-item", ".demand-mini", ".demand-label"]) {
  check("style.css définit " + cls, css.includes(cls));
}
check("heatmap de congestion intacte (v14.2)", css.includes(".heatmap-legend"));

// ── 5 · État & version ────────────────────────────────────────────────
const stateJs = read("src/state.js");
check("state expose showLandValue / showZones / zoneMode", /showLandValue/.test(stateJs) && /showZones/.test(stateJs) && /zoneMode/.test(stateJs));
check("state expose selectedBuildingId", /selectedBuildingId/.test(stateJs));
check("version 23.x", /^23\./.test(pkg.version));

if (failures > 0) {
  console.error("v27-buildings-ui : " + failures + " échec(s)");
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, suite: "v27-buildings-ui" }));
