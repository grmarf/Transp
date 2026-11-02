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
const renderer = read("src/renderer.js");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("le disque jaune plein a disparu", !renderer.includes("0.15 + density * 0.35"));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("anneau pointillé de quartier", renderer.includes("setLineDash([4, 4])"));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("voile intérieur imperceptible (0.06)", renderer.includes("rgba(255, 210, 63, 0.06)"));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("la densité module l'opacité du trait", renderer.includes("0.3 + density * 0.3"));
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g

nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
const index = read("index.html");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("anti-cache bumpé v46 (plus de v45)", !index.includes("?v=45") && (index.match(/\?v=46/g) || []).length >= 3);
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g

nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
const changes = read("CHANGES.md");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
check("CHANGES documente la V29.7", changes.includes("## V29.7"));
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
console.log("ok - v29.7 : quartier léger (anneau pointillé autour des arrêts)");
nti-cache bumpé v45 (plus de v44)/anti-cache bumpé v46 (plus de v45)/g
