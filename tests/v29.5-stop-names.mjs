import { readFileSync } from "node:fs";
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
import { fileURLToPath } from "node:url";
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
import { dirname, join } from "node:path";
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g

nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
const read = (p) => readFileSync(join(root, p), "utf8");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g

nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
const failures = [];
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
function check(label, condition) {
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
  if (condition) console.log("ok - " + label);
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
  else failures.push(label);
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
}
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g

nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
const index = read("index.html");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("index.html : bouton toggleStopNamesBtn présent", index.includes('id="toggleStopNamesBtn"'));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("index.html : bouton stylé map-overlay-btn", /class="map-overlay-btn"[^>]*id="toggleStopNamesBtn"|id="toggleStopNamesBtn"[^>]*class="map-overlay-btn"/.test(index));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("index.html : 6 boutons d'overlay", (index.match(/map-overlay-btn/g) || []).length === 6);
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("index.html : anti-cache bumpé v46 (plus de v45)", !index.includes("?v=45") && (index.match(/\?v=46/g) || []).length >= 3);
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g

nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
const main = read("src/main.js");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("main.js : bouton branché via bindTap", main.includes('bindTap(document.getElementById("toggleStopNamesBtn")'));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("main.js : bascule showStopNames (défaut = affiché)", main.includes("state.showStopNames = !(state.showStopNames !== false)"));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("main.js : aria-pressed suit l'état affiché", main.includes('String(state.showStopNames !== false)'));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g

nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
const renderer = read("src/renderer.js");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("renderer.js : l'étiquette est gardée par showStopNames", renderer.includes("state.showStopNames !== false"));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("renderer.js : le nom est dessiné sous la garde (LOD inclus)", /if \(state\.showStopNames !== false && camera\.zoom >= 0\.55\) \{[\s\S]{0,2000}?ctx\.fillText\(s\.name, s\.x, labelY\);/.test(renderer));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("renderer.js : la pastille d'attente reste hors de la garde", /ctx\.restore\(\);\s*\n\s*\}\s*\n\s*const waiting =/.test(renderer));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g

nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
if (failures.length) {
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
  console.error("ÉCHEC — " + failures.length + " vérification(s) :");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
  failures.forEach((f) => console.error("  - " + f));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
  process.exit(1);
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
}
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
console.log("ok - v29.5 : noms d'arrêts masquables câblés de bout en bout");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
