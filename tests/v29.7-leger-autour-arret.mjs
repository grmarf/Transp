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

const renderer = read("src/renderer.js");
check("le disque jaune plein a disparu", !renderer.includes("0.15 + density * 0.35"));
check("anneau pointillé de quartier", renderer.includes("setLineDash([4, 4])"));
check("voile intérieur imperceptible (0.06)", renderer.includes("rgba(255, 210, 63, 0.06)"));
check("la densité module l'opacité du trait", renderer.includes("0.3 + density * 0.3"));

const index = read("index.html");
check("anti-cache bumpé v36 (plus de v35)", !index.includes("?v=35") && (index.match(/\?v=36/g) || []).length >= 3);

const changes = read("CHANGES.md");
check("CHANGES documente la V29.7", changes.includes("## V29.7"));

if (failures.length) {
  console.error("ÉCHEC — " + failures.length + " vérification(s) :");
  failures.forEach((f) => console.error("  - " + f));
  process.exit(1);
}
console.log("ok - v29.7 : quartier léger (anneau pointillé autour des arrêts)");
