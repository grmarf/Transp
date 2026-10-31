import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const failures = [];
function check(label, condition) {
  if (condition) console.log("ok - " + label);
  else failures.push(label);
}

const index = read("index.html");
check("index.html : bouton toggleStopNamesBtn présent", index.includes('id="toggleStopNamesBtn"'));
check("index.html : bouton stylé map-overlay-btn", /class="map-overlay-btn"[^>]*id="toggleStopNamesBtn"|id="toggleStopNamesBtn"[^>]*class="map-overlay-btn"/.test(index));
check("index.html : 6 boutons d'overlay", (index.match(/map-overlay-btn/g) || []).length === 6);
check("index.html : anti-cache bumpé v36 (plus de v35)", !index.includes("?v=35") && (index.match(/\?v=36/g) || []).length >= 3);

const main = read("src/main.js");
check("main.js : bouton branché via bindTap", main.includes('bindTap(document.getElementById("toggleStopNamesBtn")'));
check("main.js : bascule showStopNames (défaut = affiché)", main.includes("state.showStopNames = !(state.showStopNames !== false)"));
check("main.js : aria-pressed suit l'état affiché", main.includes('String(state.showStopNames !== false)'));

const renderer = read("src/renderer.js");
check("renderer.js : l'étiquette est gardée par showStopNames", renderer.includes("state.showStopNames !== false"));
check("renderer.js : le nom est dessiné sous la garde (LOD inclus)", /if \(state\.showStopNames !== false && camera\.zoom >= 0\.55\) \{[\s\S]{0,2000}?ctx\.fillText\(s\.name, s\.x, labelY\);/.test(renderer));
check("renderer.js : la pastille d'attente reste hors de la garde", /ctx\.restore\(\);\s*\n\s*\}\s*\n\s*const waiting =/.test(renderer));

if (failures.length) {
  console.error("ÉCHEC — " + failures.length + " vérification(s) :");
  failures.forEach((f) => console.error("  - " + f));
  process.exit(1);
}
console.log("ok - v29.5 : noms d'arrêts masquables câblés de bout en bout");
